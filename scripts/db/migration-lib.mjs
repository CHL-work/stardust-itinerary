import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const migrationLockId = 7_400_002;

export const defaultMigrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../database/migrations",
);

export async function readMigrations(directory = defaultMigrationsDirectory) {
  const names = (await readdir(directory))
    .filter((name) => migrationFilePattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  if (names.length === 0) {
    throw new Error(`No migration files found in ${directory}`);
  }

  const duplicateVersions = names
    .map((name) => name.slice(0, 4))
    .filter((version, index, versions) => versions.indexOf(version) !== index);

  if (duplicateVersions.length > 0) {
    throw new Error(`Duplicate migration version: ${duplicateVersions[0]}`);
  }

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(directory, name), "utf8");
      return {
        name,
        sql,
        checksum: sha256(sql),
      };
    }),
  );
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Databases migrated from a Windows checkout recorded checksums over CRLF bytes, while the
 * repository stores LF. Accept an applied checksum only when it equals this file's bytes or a
 * variant that differs solely in line endings; any other difference still fails closed.
 */
export function checksumMatchesApplied(sql, appliedChecksum) {
  if (sha256(sql) === appliedChecksum) return true;
  const lf = sql.replaceAll("\r\n", "\n");
  return [lf, lf.replaceAll("\n", "\r\n")].some((variant) => sha256(variant) === appliedChecksum);
}

export async function migrate({ connectionString, through, directory } = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL or an explicit connectionString is required");
  }

  const migrations = await readMigrations(directory);
  if (through && !migrations.some((migration) => migration.name === through)) {
    throw new Error(`Unknown target migration: ${through}`);
  }

  const client = new Client({ connectionString });
  const appliedNow = [];
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        name text PRIMARY KEY,
        checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const appliedResult = await client.query(
      "SELECT name, checksum_sha256 FROM app_schema_migrations ORDER BY name",
    );
    const available = new Map(migrations.map((migration) => [migration.name, migration]));

    for (const row of appliedResult.rows) {
      const migration = available.get(row.name);
      if (!migration) {
        throw new Error(`Applied migration is missing from the repository: ${row.name}`);
      }
      if (!checksumMatchesApplied(migration.sql, row.checksum_sha256)) {
        throw new Error(`Applied migration checksum changed: ${row.name}`);
      }
    }

    const alreadyApplied = new Set(appliedResult.rows.map((row) => row.name));
    for (const migration of migrations) {
      if (!alreadyApplied.has(migration.name)) {
        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO app_schema_migrations (name, checksum_sha256) VALUES ($1, $2)",
            [migration.name, migration.checksum],
          );
          await client.query("COMMIT");
          appliedNow.push(migration.name);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }

      if (migration.name === through) {
        break;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]);
    } finally {
      await client.end();
    }
  }

  return appliedNow;
}
