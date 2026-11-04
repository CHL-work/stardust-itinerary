import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindSyntheticAiOperator, sponsorSyntheticAiTrip, syntheticOperatorIdentity, withSyntheticAiOperator } from "../../../scripts/lib/synthetic-ai-operator";

const syntheticUserId = "00000000-0000-4000-8000-000000000001";
const syntheticTripId = "10000000-0000-4000-8000-000000000099";
const target = "postgresql://test:synthetic-password@localhost/stardust_test_ai_reservation_guard";
afterEach(() => { vi.unstubAllEnvs(); });

describe("synthetic evaluator operator isolation", () => {
  it.each([
    "not-a-url", "https://localhost/stardust_test_ai_search_guard",
    "postgresql://localhost/stardust_application", "postgresql://remote.example.test/stardust_test_ai_search_guard",
    `${target}?options=unsafe`, `${target}#schema`,
    `postgresql://localhost/stardust_test_ai_auto_${"a".repeat(64)}`,
  ])("rejects an unsafe target before changing the process or running any work", async (url) => {
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "prior-operator@example.test");
    const work = vi.fn();
    await expect(withSyntheticAiOperator(url, work)).rejects.toThrow("Unsafe synthetic AI evaluator fixture.");
    expect(work).not.toHaveBeenCalled();
    expect(process.env.OWNER_GOOGLE_EMAIL).toBe("prior-operator@example.test");
  });

  it.each(["DATABASE_URL", "DATABASE_DIRECT_URL"] as const)("rejects the configured %s even through a loopback alias before invoking work", async (name) => {
    vi.stubEnv(name, target.replace("localhost", "127.0.0.1"));
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "prior-operator@example.test");
    const work = vi.fn();
    await expect(withSyntheticAiOperator(target, work)).rejects.toThrow("Unsafe synthetic AI evaluator fixture.");
    expect(work).not.toHaveBeenCalled();
    expect(process.env.OWNER_GOOGLE_EMAIL).toBe("prior-operator@example.test");
  });

  it.each(["reservation", "reservation_clarification", "search", "auto", "completion"])("uses and restores the fixed synthetic operator for the %s evaluator", async (name) => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/application");
    vi.stubEnv("DATABASE_DIRECT_URL", "");
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "prior-operator@example.test");
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const result = await withSyntheticAiOperator(`postgresql://localhost/stardust_test_ai_${name}_guard`, async () => {
      expect(process.env.OWNER_GOOGLE_EMAIL).toBe(syntheticOperatorIdentity.emailHint);
      await bindSyntheticAiOperator({ query }, syntheticUserId);
      await sponsorSyntheticAiTrip({ query }, syntheticTripId, syntheticUserId);
      return "safe";
    });
    expect(result).toBe("safe");
    expect(process.env.OWNER_GOOGLE_EMAIL).toBe("prior-operator@example.test");
    expect(query.mock.calls[0]?.[1]).toEqual([syntheticOperatorIdentity.issuer, syntheticOperatorIdentity.subject,
      syntheticUserId, "ai-eval-operator@example.test"]);
    expect(query.mock.calls[1]?.[0]).toContain("WHERE settings.trip_id = $1 AND EXISTS");
    expect(query.mock.calls[1]?.[1]?.slice(0, 2)).toEqual([syntheticTripId, syntheticUserId]);
    expect(JSON.stringify(query.mock.calls)).not.toContain("prior-operator@example.test");
    expect(JSON.stringify(query.mock.calls)).not.toContain("synthetic-password");
  });

  it.each([undefined, "prior-operator@example.test"])("restores the original override state after setup/provider failure", async (previous) => {
    vi.stubEnv("OWNER_GOOGLE_EMAIL", previous);
    await expect(withSyntheticAiOperator(target, async () => { throw new Error("Synthetic failure"); })).rejects.toThrow("Synthetic failure");
    expect(process.env.OWNER_GOOGLE_EMAIL).toBe(previous);
  });

  it("refuses a non-fixture owner and sponsorship without the guarded override before any database write", async () => {
    const query = vi.fn();
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "prior-operator@example.test");
    await expect(bindSyntheticAiOperator({ query }, syntheticUserId)).rejects.toThrow("Unsafe synthetic AI evaluator fixture.");
    await expect(sponsorSyntheticAiTrip({ query }, syntheticTripId, syntheticUserId)).rejects.toThrow("Unsafe synthetic AI evaluator fixture.");
    await withSyntheticAiOperator(target, async () => {
      await expect(bindSyntheticAiOperator({ query }, syntheticTripId)).rejects.toThrow("Unsafe synthetic AI evaluator fixture.");
      await expect(sponsorSyntheticAiTrip({ query }, syntheticTripId, syntheticTripId)).rejects.toThrow("Unsafe synthetic AI evaluator fixture.");
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed when exact synthetic trip sponsorship does not match a stored identity", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await withSyntheticAiOperator(target, async () => {
      await expect(sponsorSyntheticAiTrip({ query }, syntheticTripId, syntheticUserId)).rejects.toThrow("Unsafe synthetic AI evaluator fixture.");
    });
    expect(query).toHaveBeenCalledOnce();
  });
});

describe("evaluator entry-point guard wiring", () => {
  it.each(["test-ai-reservation.ts", "test-ai-reservation-clarification.ts", "test-ai-search.ts"])("keeps %s safety checks before the synthetic override or planner", (file) => {
    const source = readFileSync(new URL(`../../../scripts/${file}`, import.meta.url), "utf8");
    const evaluation = source.slice(source.indexOf("async function runEvaluation"), source.indexOf("async function main"));
    const main = source.slice(source.indexOf("async function main"));
    expect(main.indexOf("parseDatabaseTarget")).toBeLessThan(main.indexOf("await runEvaluation"));
    expect(main.indexOf("requireIsolated")).toBeLessThan(main.indexOf("await runEvaluation"));
    const prepared = evaluation.includes("await prepareDatabase") ? evaluation.indexOf("await prepareDatabase") : evaluation.indexOf("await loadDemoFixture");
    expect(prepared).toBeGreaterThanOrEqual(0);
    expect(prepared).toBeLessThan(evaluation.indexOf("await withSyntheticAiOperator"));
    expect(evaluation.indexOf("await withSyntheticAiOperator")).toBeLessThan(evaluation.indexOf("new Pool"));
    expect(evaluation.indexOf("createSyntheticContext")).toBeLessThan(evaluation.indexOf("runAiPlanner"));
    const context = source.slice(source.indexOf("async function createSyntheticContext"), source.indexOf("async function runEvaluation"));
    expect(context.indexOf("fixture_shape_mismatch")).toBeLessThan(context.indexOf("await bindSyntheticAiOperator"));
    expect(context.indexOf("await bindSyntheticAiOperator")).toBeLessThan(context.indexOf("await createTrip"));
    expect(context.indexOf("await createTrip")).toBeLessThan(context.indexOf("await sponsorSyntheticAiTrip"));
    expect(source).not.toContain("process.env.OWNER_GOOGLE_EMAIL =");
    expect(source).not.toContain("loadEnvFile");
  });
});
