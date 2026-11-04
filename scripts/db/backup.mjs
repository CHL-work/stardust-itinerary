// Encrypted logical backup: pg_dump (custom format) -> verify the archive -> age-encrypt -> store.
// Plaintext only ever exists in a private temporary directory that is removed afterwards.
//
//   DATABASE_DIRECT_URL            administrator connection (required)
//   STARDUST_BACKUP_AGE_RECIPIENT  age public key the archive is encrypted to (required)
//   STARDUST_BACKUP_GCS_BUCKET     upload target; uses the workload's metadata-server identity
//   STARDUST_BACKUP_DIR            local target when no bucket is set (default /var/backups/stardust)
//   STARDUST_BACKUP_PREFIX         object/file name prefix (default "stardust")
// Usage: node scripts/db/backup.mjs [--label=scheduled|pre-migrate|manual]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const labelPattern = /^[a-z][a-z0-9-]{0,31}$/u;

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`${command} exited with ${code}: ${stderr.trim().slice(0, 400)}`)));
  });
}

/** libpq environment for a connection URL, so the password never appears in process arguments. */
export function libpqEnvironment(connectionString, base = process.env) {
  const url = new URL(connectionString);
  const env = { ...base, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//u, "")) };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const host = url.searchParams.get("host");
  if (host) env.PGHOST = host;
  return env;
}

export function backupObjectName(prefix, label, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  return `${prefix}/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${prefix}-${stamp}-${label}.dump.age`;
}

async function metadataToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`metadata token request failed: ${response.status}`);
  return (await response.json()).access_token;
}

async function uploadToGcs(bucket, objectName, body, contentType) {
  const token = await metadataToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}&ifGenerationMatch=0`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`upload of ${objectName} failed: ${response.status}`);
}

async function main() {
  const labelArgument = process.argv.find((value) => value.startsWith("--label="));
  const label = labelArgument ? labelArgument.slice("--label=".length) : "manual";
  if (!labelPattern.test(label)) throw new Error("Backup label must be a short lowercase word");
  const connectionString = process.env.DATABASE_DIRECT_URL;
  const recipient = process.env.STARDUST_BACKUP_AGE_RECIPIENT?.trim();
  if (!connectionString) throw new Error("DATABASE_DIRECT_URL is required");
  if (!recipient || !/^age1[0-9a-z]{58}$/u.test(recipient)) throw new Error("STARDUST_BACKUP_AGE_RECIPIENT must be an age public key");
  const prefix = process.env.STARDUST_BACKUP_PREFIX || "stardust";

  const client = new pg.Client({ connectionString });
  await client.connect();
  let inventory;
  try {
    const migrations = await client.query("SELECT count(*)::int AS count, max(name) AS latest FROM app_schema_migrations");
    inventory = { migrations: migrations.rows[0].count, latestMigration: migrations.rows[0].latest };
  } finally {
    await client.end();
  }

  const work = await mkdtemp(path.join(os.tmpdir(), "stardust-backup-"));
  try {
    const plain = path.join(work, "database.dump");
    const encrypted = `${plain}.age`;
    const env = libpqEnvironment(connectionString);
    await run("pg_dump", ["--format=custom", "--compress=9", "--no-password", `--file=${plain}`], env);
    const toc = await run("pg_restore", ["--list", plain], env);
    const tocEntries = toc.split("\n").filter((line) => line && !line.startsWith(";")).length;
    if (tocEntries === 0) throw new Error("pg_restore could not read any archive entries");
    await run("age", ["--encrypt", "--recipient", recipient, "--output", encrypted, plain], process.env);
    await rm(plain);

    const body = await readFile(encrypted);
    const objectName = backupObjectName(prefix, label);
    const manifest = {
      object: objectName,
      createdAt: new Date().toISOString(),
      label,
      bytes: (await stat(encrypted)).size,
      sha256: createHash("sha256").update(body).digest("hex"),
      archiveEntries: tocEntries,
      ...inventory,
      encryption: "age",
      format: "pg_dump custom",
    };
    const bucket = process.env.STARDUST_BACKUP_GCS_BUCKET;
    if (bucket) {
      await uploadToGcs(bucket, objectName, body, "application/octet-stream");
      await uploadToGcs(bucket, `${objectName}.json`, JSON.stringify(manifest, null, 2), "application/json");
    } else {
      const directory = process.env.STARDUST_BACKUP_DIR || "/var/backups/stardust";
      const target = path.join(directory, objectName);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(encrypted, target);
      await writeFile(`${target}.json`, JSON.stringify(manifest, null, 2));
    }
    console.log(JSON.stringify({ backup: "ok", ...manifest }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("backup.mjs")) {
  await main();
}
