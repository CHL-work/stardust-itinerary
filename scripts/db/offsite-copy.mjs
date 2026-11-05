// Daily off-site copy (D-083): one consistent snapshot of the database is restored into a second
// PostgreSQL server as a dated database, every table's row count is checked against that snapshot,
// and only the newest verified copies are kept. The public instance uses a Neon free-plan project,
// so a usable copy survives even if the cluster and its Cloud Storage backups (same cloud project)
// are lost.
//
//   DATABASE_DIRECT_URL            source administrator connection (required)
//   STARDUST_OFFSITE_DATABASE_URL  maintenance database on the off-site server; when unset the job
//                                  does nothing. Its role needs CREATEDB. TLS is always verified,
//                                  except sslmode=disable on a loopback test server.
//   STARDUST_OFFSITE_KEEP          verified copies kept after a run (default 3, at most 14)
//   STARDUST_OFFSITE_MAX_MB        storage budget for all copies together (default 500)
//   STARDUST_OFFSITE_PREFIX        copy name prefix (default "stardust"): <prefix>_YYYYMMDD_HHMMSS
//   PGSSLROOTCERT                  CA bundle for the restore tool (default: the system's roots)
// Usage: node scripts/db/offsite-copy.mjs
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { libpqEnvironment, run } from "./backup.mjs";

export const VERIFIED_MARKER = "stardust-offsite-copy v1 verified ";
export const STALE_UNVERIFIED_MS = 2 * 60 * 60 * 1000;
const DEFAULT_KEEP = 3;
const MAX_KEEP = 14;
const DEFAULT_MAX_MB = 500;
const prefixPattern = /^[a-z][a-z0-9]{0,19}$/u;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const applicationName = "stardust-offsite-copy";

function wholeNumber(raw, fallback, min, max, name) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/u.test(raw.trim())) throw new Error(`${name} must be a whole number`);
  const value = Number(raw.trim());
  if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

export function offsiteOptions(env = process.env) {
  const prefix = env.STARDUST_OFFSITE_PREFIX?.trim() || "stardust";
  if (!prefixPattern.test(prefix)) throw new Error("STARDUST_OFFSITE_PREFIX must be a short lowercase word");
  return {
    prefix,
    keep: wholeNumber(env.STARDUST_OFFSITE_KEEP, DEFAULT_KEEP, 1, MAX_KEEP, "STARDUST_OFFSITE_KEEP"),
    budgetBytes: wholeNumber(env.STARDUST_OFFSITE_MAX_MB, DEFAULT_MAX_MB, 10, 1_000_000, "STARDUST_OFFSITE_MAX_MB") * 1024 * 1024,
  };
}

/** `stardust_20261105_190012`: the UTC start time, so names sort by age. */
export function copyDatabaseName(prefix, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "").replace("T", "_");
  return `${prefix}_${stamp}`;
}

/** The start time encoded in a copy's name, or null for any database that is not a copy. */
export function copyCreatedAt(prefix, name) {
  const match = /^([a-z][a-z0-9]*)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/u.exec(name);
  if (!match || match[1] !== prefix) return null;
  const [, , year, month, day, hour, minute, second] = match.map(Number);
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(at.getTime()) || copyDatabaseName(prefix, at) !== name ? null : at;
}

export function copyMarker(details) {
  return VERIFIED_MARKER + JSON.stringify(details);
}

export function isVerifiedComment(comment) {
  return typeof comment === "string" && comment.startsWith(VERIFIED_MARKER);
}

const newestFirst = (left, right) => right.createdAt.getTime() - left.createdAt.getTime();

/**
 * Before a restore: drop unverified copies older than two hours (interrupted runs), then the oldest
 * verified copies while the new copy would not fit the budget. The newest verified copy is never
 * dropped here, so a failed run always leaves the last good copy in place; when even that leaves no
 * room, nothing verified is dropped and the run fails.
 */
export function planBeforeCopy(copies, { sourceBytes, budgetBytes, now = new Date() }) {
  const stale = [];
  const remaining = [];
  for (const copy of copies) {
    if (!copy.verified && now.getTime() - copy.createdAt.getTime() >= STALE_UNVERIFIED_MS) stale.push(copy.name);
    else remaining.push(copy);
  }
  const verified = remaining.filter((copy) => copy.verified).sort(newestFirst);
  let used = remaining.reduce((sum, copy) => sum + copy.bytes, 0);
  const room = [];
  while (verified.length > 1 && used + sourceBytes > budgetBytes) {
    const oldest = verified.pop();
    room.push(oldest.name);
    used -= oldest.bytes;
  }
  const fits = used + sourceBytes <= budgetBytes;
  return { drop: fits ? [...stale, ...room] : stale, fits };
}

/** After a verified restore: the verified copies beyond the newest `keep`. */
export function planAfterCopy(copies, { keep }) {
  return copies.filter((copy) => copy.verified).sort(newestFirst).slice(keep).map((copy) => copy.name);
}

/** The off-site server from its URL. TLS with certificate checks is required off loopback. */
export function targetConnection(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("STARDUST_OFFSITE_DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("STARDUST_OFFSITE_DATABASE_URL must be a postgresql:// URL");
  const host = url.hostname.replace(/^\[(.*)\]$/u, "$1");
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!host || !user || !password || !database) throw new Error("STARDUST_OFFSITE_DATABASE_URL needs a host, user, password and database");
  const sslmode = url.searchParams.get("sslmode") ?? "verify-full";
  if (!["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(sslmode)) throw new Error("STARDUST_OFFSITE_DATABASE_URL has an unknown sslmode");
  if (sslmode === "disable" && !loopbackHosts.has(host)) throw new Error("the off-site copy needs TLS: sslmode=disable is only for a loopback test server");
  return {
    host,
    port: Number(url.port || 5432),
    user,
    password,
    database,
    tls: sslmode !== "disable",
    channelBinding: url.searchParams.get("channel_binding") === "require",
  };
}

/** Same server and database as the source: copying into itself is always a mistake. */
export function isSourceDatabase(target, sourceConnectionString) {
  const source = new URL(sourceConnectionString);
  const sourceHost = source.searchParams.get("host") || source.hostname.replace(/^\[(.*)\]$/u, "$1");
  return sourceHost === target.host
    && Number(source.port || 5432) === target.port
    && decodeURIComponent(source.pathname.replace(/^\//u, "")) === target.database;
}

export function clientConfig(target, database = target.database) {
  return {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database,
    ssl: target.tls ? { rejectUnauthorized: true, servername: target.host } : false,
    enableChannelBinding: target.channelBinding,
    connectionTimeoutMillis: 30_000,
    application_name: applicationName,
  };
}

/** libpq settings for the restore tool: the password stays out of process arguments. */
export function targetEnvironment(target, database, base = {}, rootCertificates = undefined) {
  const env = {
    ...base,
    PGHOST: target.host,
    PGPORT: String(target.port),
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGDATABASE: database,
    PGAPPNAME: applicationName,
    PGCONNECT_TIMEOUT: "30",
  };
  if (target.tls) {
    env.PGSSLMODE = "verify-full";
    env.PGSSLROOTCERT = rootCertificates || "system";
  } else {
    env.PGSSLMODE = "disable";
  }
  if (target.channelBinding) env.PGCHANNELBINDING = "require";
  return env;
}

/** Only what the PostgreSQL tools need: neither tool sees the other side's credentials. */
export function toolEnvironment(env = process.env) {
  const names = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TZ", "SystemRoot"];
  return Object.fromEntries(names.filter((name) => env[name] !== undefined).map((name) => [name, env[name]]));
}

/** Rows that differ: a table missing from the copy, or a different count. */
export function countMismatches(source, copy) {
  return Object.entries(source)
    .filter(([table, count]) => copy[table] !== count)
    .map(([table, count]) => `${table}: ${count} in the source, ${copy[table] ?? "missing"} in the copy`);
}

/** The first line of a tool's error only: later lines can quote the failing command or row. */
export function toolFailure(step, error) {
  const message = String(error?.message ?? error).split(/\r?\n/u)[0].slice(0, 240);
  return new Error(`${step} failed: ${message}`);
}

function watch(client) {
  client.on("error", (error) => console.error(JSON.stringify({ offsiteCopy: "connection error", message: error.message })));
  return client;
}

async function connect(config, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = watch(new pg.Client(config));
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      // A suspended serverless compute can take a few seconds to start.
      if (attempt < attempts) await sleep(2_000 * attempt);
    }
  }
  throw new Error(`could not connect to ${config.database}: ${lastError?.message ?? "unknown error"}`);
}

async function userTables(client) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, c.relname AS name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\\_%'
     ORDER BY 1, 2`);
  return rows;
}

async function countRows(client, tables) {
  const counts = {};
  for (const { schema, name } of tables) {
    const key = `${schema}.${name}`;
    try {
      const { rows } = await client.query(`SELECT count(*)::bigint AS count FROM ${client.escapeIdentifier(schema)}.${client.escapeIdentifier(name)}`);
      counts[key] = String(rows[0].count);
    } catch (error) {
      // A missing table or schema in the copy is reported as a mismatch.
      if (error?.code !== "42P01" && error?.code !== "3F000") throw error;
    }
  }
  return counts;
}

async function listCopies(admin, prefix) {
  const { rows } = await admin.query(`
    SELECT d.datname AS name,
           pg_catalog.shobj_description(d.oid, 'pg_database') AS comment,
           pg_catalog.pg_database_size(d.oid)::bigint AS bytes
      FROM pg_catalog.pg_database d
     WHERE d.datname LIKE $1`, [`${prefix}\\_%`]);
  return rows.flatMap((row) => {
    const createdAt = copyCreatedAt(prefix, row.name);
    return createdAt ? [{ name: row.name, createdAt, verified: isVerifiedComment(row.comment), bytes: Number(row.bytes) }] : [];
  });
}

async function dropCopy(admin, prefix, name) {
  if (!copyCreatedAt(prefix, name)) throw new Error("refusing to drop a database that is not an off-site copy");
  await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)}`);
}

async function dropAll(admin, prefix, names, dropped, skipped) {
  for (const name of names) {
    try {
      await dropCopy(admin, prefix, name);
      dropped.push(name);
    } catch (error) {
      // Someone may be connected to an old copy; the next run tries again.
      skipped.push(name);
      console.error(JSON.stringify({ offsiteCopy: "could not drop an old copy", database: name, message: error.message }));
    }
  }
}

async function main() {
  const targetUrl = process.env.STARDUST_OFFSITE_DATABASE_URL?.trim();
  if (!targetUrl) {
    console.log(JSON.stringify({ offsiteCopy: "not configured" }));
    return;
  }
  const sourceUrl = process.env.DATABASE_DIRECT_URL;
  if (!sourceUrl) throw new Error("DATABASE_DIRECT_URL is required");
  const { prefix, keep, budgetBytes } = offsiteOptions();
  const target = targetConnection(targetUrl);
  if (copyCreatedAt(prefix, target.database)) throw new Error("the off-site maintenance database must not be named like a copy");
  if (isSourceDatabase(target, sourceUrl)) throw new Error("the off-site copy must not target the source database");
  const tools = toolEnvironment();

  const work = await mkdtemp(path.join(os.tmpdir(), "stardust-offsite-"));
  try {
    // One snapshot for the dump and the row counts, so the check compares like with like.
    const dump = path.join(work, "database.dump");
    const source = watch(new pg.Client({ connectionString: sourceUrl, application_name: applicationName }));
    await source.connect();
    let snapshot;
    try {
      await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      const { rows: [exported] } = await source.query("SELECT pg_catalog.pg_export_snapshot() AS id, now() AS at, pg_catalog.pg_database_size(current_database())::bigint AS bytes");
      const tables = await userTables(source);
      const counts = await countRows(source, tables);
      const { rows: [migrations] } = await source.query("SELECT count(*)::int AS count, max(name) AS latest FROM app_schema_migrations");
      await run("pg_dump", ["--format=custom", "--compress=6", "--no-password", `--snapshot=${exported.id}`, `--file=${dump}`], libpqEnvironment(sourceUrl, tools))
        .catch((error) => { throw toolFailure("the source dump", error); });
      await source.query("COMMIT");
      snapshot = { at: exported.at.toISOString(), bytes: Number(exported.bytes), tables, counts, migrations: migrations.count, latestMigration: migrations.latest };
    } finally {
      await source.end();
    }

    const admin = await connect(clientConfig(target));
    try {
      const dropped = [];
      const skipped = [];
      const before = planBeforeCopy(await listCopies(admin, prefix), { sourceBytes: snapshot.bytes, budgetBytes });
      await dropAll(admin, prefix, before.drop, dropped, skipped);
      if (!before.fits) {
        throw new Error(`a new copy (${Math.ceil(snapshot.bytes / 1048576)} MB) does not fit the ${budgetBytes / 1048576} MB storage budget next to the newest copy; raise STARDUST_OFFSITE_MAX_MB if the off-site plan allows it`);
      }

      const name = copyDatabaseName(prefix);
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)}`);
      let verified = false;
      let copyBytes = 0;
      const rows = Object.values(snapshot.counts).reduce((sum, count) => sum + BigInt(count), 0n);
      try {
        await run("pg_restore", [
          "--no-owner", "--no-privileges", "--no-security-labels", "--no-tablespaces", "--no-publications", "--no-subscriptions",
          "--single-transaction", "--exit-on-error", "--no-password", `--dbname=${name}`, dump,
        ], targetEnvironment(target, name, tools, process.env.PGSSLROOTCERT)).catch((error) => { throw toolFailure("the restore", error); });
        const copy = await connect(clientConfig(target, name));
        let mismatches;
        try {
          mismatches = countMismatches(snapshot.counts, await countRows(copy, snapshot.tables));
        } finally {
          await copy.end();
        }
        if (mismatches.length > 0) throw new Error(`the copy does not match the source: ${mismatches.slice(0, 5).join("; ")}`);
        copyBytes = Number((await admin.query("SELECT pg_catalog.pg_database_size($1)::bigint AS bytes", [name])).rows[0].bytes);
        await admin.query(`COMMENT ON DATABASE ${admin.escapeIdentifier(name)} IS ${admin.escapeLiteral(copyMarker({
          snapshotAt: snapshot.at, tables: snapshot.tables.length, rows: rows.toString(), migrations: snapshot.migrations, latestMigration: snapshot.latestMigration,
        }))}`);
        verified = true;
      } finally {
        if (!verified) await dropCopy(admin, prefix, name).catch(() => {});
      }

      const after = planAfterCopy(await listCopies(admin, prefix), { keep });
      await dropAll(admin, prefix, after, dropped, skipped);
      const kept = (await listCopies(admin, prefix)).filter((copy) => copy.verified).sort(newestFirst);
      console.log(JSON.stringify({
        offsiteCopy: "ok",
        database: name,
        snapshotAt: snapshot.at,
        tables: snapshot.tables.length,
        rows: rows.toString(),
        latestMigration: snapshot.latestMigration,
        sourceBytes: snapshot.bytes,
        copyBytes,
        storedBytes: kept.reduce((sum, copy) => sum + copy.bytes, 0),
        budgetBytes,
        kept: kept.map((copy) => copy.name),
        dropped,
        ...(skipped.length > 0 ? { notDropped: skipped } : {}),
      }));
    } finally {
      await admin.end();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("offsite-copy.mjs")) {
  try {
    await main();
  } catch (error) {
    console.error(JSON.stringify({ offsiteCopy: "failed", message: error.message }));
    process.exitCode = 1;
  }
}
