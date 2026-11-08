import type { Pool } from "pg";

import { getAuthConfig } from "@/lib/auth/config";
import { getPool } from "@/lib/db/pool";
import { runDueDisruptionMonitors } from "@/lib/disruptions/monitor";
import { runDueFlightStatusChecks } from "@/lib/flights/monitor";

/**
 * Routine checks paid by members' own keys (JOB-094, D-106) run inside the web server, the only workload
 * allowed to decrypt users' keys; the background worker keeps the operator-funded checks of sponsored
 * trips. Every five minutes, with `ROUTINE_CHECKS_ENABLED=true`, one replica's loop runs a small bounded
 * batch. Database claims (flight slots, the per-trip disruption lock) keep two replicas from checking the
 * same thing twice. Logs carry counts only.
 */
export const ROUTINE_CHECK_INTERVAL_MS = 5 * 60_000;

let started = false;
let running = false;

export function routineChecksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ROUTINE_CHECKS_ENABLED === "true";
}

function bounded(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}

function failureName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z_]{1,80}$/u.test(error.name) ? error.name : "routine_check_failed";
}

export type RoutineCheckRun = {
  flights: Awaited<ReturnType<typeof runDueFlightStatusChecks>> | { error: string };
  disruptions: Awaited<ReturnType<typeof runDueDisruptionMonitors>> | { error: string };
};

/** One pass; returns null while a previous pass in this process is still running. */
export async function runRoutineChecksOnce(pool: Pool, env: Record<string, string | undefined> = process.env, now?: Date): Promise<RoutineCheckRun | null> {
  if (running) return null;
  running = true;
  try {
    const flights = await runDueFlightStatusChecks(pool, {
      funding: "member", now, maxChecks: bounded(env.ROUTINE_FLIGHT_MAX_CHECKS, 4, 10),
    }).catch((error: unknown) => ({ error: failureName(error) }));
    const disruptions = await runDueDisruptionMonitors(pool, {
      funding: "member", now, maxTrips: bounded(env.ROUTINE_DISRUPTION_MAX_TRIPS, 2, 10),
      // Finish well inside the five-minute cadence so passes do not pile up.
      maxRunDurationMs: 4 * 60_000,
    }).catch((error: unknown) => ({ error: failureName(error) }));
    return { flights, disruptions };
  } finally {
    running = false;
  }
}

function worthLogging(run: RoutineCheckRun): boolean {
  return "error" in run.flights || "error" in run.disruptions || run.flights.checked > 0 || run.disruptions.claimedTrips > 0;
}

/** Started once per server process from `instrumentation.ts`. */
export function startRoutineCheckScheduler(env: Record<string, string | undefined> = process.env): boolean {
  if (started || !routineChecksEnabled(env)) return false;
  started = true;
  const tick = () => {
    let pool: Pool;
    try {
      pool = getPool(getAuthConfig());
    } catch {
      console.warn(JSON.stringify({ routineChecks: { error: "configuration" } }));
      return;
    }
    void runRoutineChecksOnce(pool, env).then((run) => {
      if (run && worthLogging(run)) console.info(JSON.stringify({ routineChecks: run }));
    }, () => console.warn(JSON.stringify({ routineChecks: { error: "unexpected" } })));
  };
  // Wait a minute after start, with jitter, so a rollout's replicas do not wake together.
  setTimeout(tick, 60_000 + Math.floor(Math.random() * 60_000)).unref?.();
  setInterval(tick, ROUTINE_CHECK_INTERVAL_MS).unref?.();
  return true;
}
