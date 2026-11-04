import { Pool } from "pg";

import { runDueDisruptionMonitors } from "../src/lib/disruptions/index";

const connectionString = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");
}

// One due trip and one small provider batch per invocation keep the Windows
// task comfortably inside its runtime limit. Per-event successful-check state
// lets five-minute backend wakes drain due work without delaying page requests.
const maxTripsValue = Number.parseInt(process.env.DISRUPTION_MONITOR_MAX_TRIPS ?? "1", 10);
const maxCandidatesPerBatchValue = Number.parseInt(
  process.env.DISRUPTION_MONITOR_MAX_CANDIDATES_PER_BATCH ?? "4",
  10,
);
const maxCandidatesPerRunValue = Number.parseInt(
  process.env.DISRUPTION_MONITOR_MAX_CANDIDATES_PER_RUN
    ?? String(maxCandidatesPerBatchValue),
  10,
);
const pool = new Pool({
  connectionString,
  max: 2,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

try {
  const result = await runDueDisruptionMonitors(pool, {
    maxTrips: Number.isFinite(maxTripsValue) ? maxTripsValue : 1,
    maxCandidatesPerBatch: Number.isFinite(maxCandidatesPerBatchValue)
      ? maxCandidatesPerBatchValue
      : 4,
    maxCandidatesPerRun: Number.isFinite(maxCandidatesPerRunValue)
      ? maxCandidatesPerRunValue
      : 4,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failedTrips > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
