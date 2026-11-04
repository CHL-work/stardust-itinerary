import { migrate } from "./migration-lib.mjs";

const applied = await migrate({
  connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL,
});
if (applied.length === 0) {
  console.log("Database schema is already current.");
} else {
  console.log(`Applied migrations: ${applied.join(", ")}`);
}
