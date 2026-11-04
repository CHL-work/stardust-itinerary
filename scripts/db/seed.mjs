import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
}

const fixturePath = path.resolve("database/fixtures/demo.sql");
const fixture = await readFile(fixturePath, "utf8");
const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(fixture);
  await client.query("COMMIT");
  console.log("Loaded redacted demonstration fixture.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
