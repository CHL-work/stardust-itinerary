import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ flights: vi.fn(), disruptions: vi.fn() }));
vi.mock("@/lib/flights/monitor", () => ({ runDueFlightStatusChecks: mocks.flights }));
vi.mock("@/lib/disruptions/monitor", () => ({ runDueDisruptionMonitors: mocks.disruptions }));
import { routineChecksEnabled, runRoutineChecksOnce } from "@/lib/routine-checks/scheduler";

const pool = {} as Pool;

describe("routine checks in the web server (JOB-094)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flights.mockResolvedValue({ checked: 1, updated: 0, unchanged: 1, unverified: 0, failed: 0 });
    mocks.disruptions.mockResolvedValue({ claimedTrips: 0, succeededTrips: 0, failedTrips: 0, skippedTrips: 0, observationsWritten: 0 });
  });

  it("is off unless ROUTINE_CHECKS_ENABLED is exactly true", () => {
    expect(routineChecksEnabled({})).toBe(false);
    expect(routineChecksEnabled({ ROUTINE_CHECKS_ENABLED: "1" })).toBe(false);
    expect(routineChecksEnabled({ ROUTINE_CHECKS_ENABLED: "true" })).toBe(true);
  });

  it("runs only member-funded checks, in small bounded batches", async () => {
    const run = await runRoutineChecksOnce(pool, { ROUTINE_FLIGHT_MAX_CHECKS: "50", ROUTINE_DISRUPTION_MAX_TRIPS: "3" });
    expect(mocks.flights).toHaveBeenCalledWith(pool, expect.objectContaining({ funding: "member", maxChecks: 10 }));
    expect(mocks.disruptions).toHaveBeenCalledWith(pool, expect.objectContaining({ funding: "member", maxTrips: 3, maxRunDurationMs: 240_000 }));
    expect(run?.flights).toMatchObject({ checked: 1 });
  });

  it("never overlaps passes, and one failing check type does not stop the other", async () => {
    let release: () => void = () => {};
    mocks.flights.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ checked: 0, updated: 0, unchanged: 0, unverified: 0, failed: 0 }); }));
    const first = runRoutineChecksOnce(pool, {});
    expect(await runRoutineChecksOnce(pool, {})).toBeNull();
    release();
    await first;
    const failure = new Error("boom"); failure.name = "ProviderDown";
    mocks.flights.mockRejectedValueOnce(failure);
    const run = await runRoutineChecksOnce(pool, {});
    expect(run?.flights).toEqual({ error: "ProviderDown" });
    expect(mocks.disruptions).toHaveBeenCalledTimes(2);
  });
});
