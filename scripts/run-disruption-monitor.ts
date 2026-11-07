import { Pool } from "pg";

import { runDueDisruptionMonitors } from "../src/lib/disruptions/index";
import { runDueFlightStatusChecks } from "../src/lib/flights/monitor";

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

const startedAt = Date.now();
try {
  // Flight status checks are time-bound (JOB-083), so they go first; a failure there never stops the disruption run.
  const flightChecksValue = Number.parseInt(process.env.FLIGHT_STATUS_MAX_CHECKS ?? "2", 10);
  try {
    const flights = await runDueFlightStatusChecks(pool, { maxChecks: Number.isFinite(flightChecksValue) ? flightChecksValue : 2 });
    process.stdout.write(`${JSON.stringify({ flightStatus: flights })}\n`);
    if (flights.failed > 0) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ flightStatus: { error: error instanceof Error ? error.name : "unknown" } })}\n`);
    process.exitCode = 1;
  }
  const result = await runDueDisruptionMonitors(pool, {
    maxTrips: Number.isFinite(maxTripsValue) ? maxTripsValue : 1,
    maxCandidatesPerBatch: Number.isFinite(maxCandidatesPerBatchValue)
      ? maxCandidatesPerBatchValue
      : 4,
    maxCandidatesPerRun: Number.isFinite(maxCandidatesPerRunValue)
      ? maxCandidatesPerRunValue
      : 4,
    // The job's deadline is 10 minutes: leave the disruption run what the flight checks did not use.
    maxRunDurationMs: Math.max(60_000, 9 * 60_000 - (Date.now() - startedAt)),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failedTrips > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
