/**
 * Runs once when a server process starts. Routine checks paid by members' own keys (JOB-094) run here,
 * in the web server, because only the web server may decrypt users' keys. Off unless
 * `ROUTINE_CHECKS_ENABLED=true`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.ROUTINE_CHECKS_ENABLED !== "true") return;
  const { startRoutineCheckScheduler } = await import("@/lib/routine-checks/scheduler");
  startRoutineCheckScheduler();
}
