import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingItineraryEditDetail } from "@/lib/app/types";

const mock = vi.hoisted(() => ({ construct: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn(), planner: vi.fn(), createTrip: vi.fn() }));
vi.mock("pg", () => ({
  Client: class { constructor(input: unknown) { mock.construct(input); } connect = mock.connect; query = mock.query; end = mock.end; },
  Pool: class { constructor(input: unknown) { mock.construct(input); } },
}));
vi.mock("@/lib/ai/planner", () => ({ runAiPlanner: mock.planner }));
vi.mock("@/lib/app/repository", () => ({ createTrip: mock.createTrip, createTripMember: vi.fn(), createChangeRequest: vi.fn(), getPendingItineraryRequestForEdit: vi.fn() }));
vi.mock("@/lib/ai/conversation", () => ({ prepareAiConversation: vi.fn() }));

import { assertPreserved, main, parseDatabaseTarget, prepareDatabase, requireIsolatedTarget, selectedModel } from "../../../scripts/test-ai-pending-edit";
import { withSyntheticAiOperator } from "../../../scripts/lib/synthetic-ai-operator";

const target = "postgresql://test:synthetic-password@127.0.0.1:5432/stardust_test_ai_reservation_pending_guard";
const originalArgv = [...process.argv];
beforeEach(() => {
  vi.clearAllMocks(); mock.connect.mockResolvedValue(undefined); mock.end.mockResolvedValue(undefined);
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/application"); vi.stubEnv("DATABASE_DIRECT_URL", "");
  vi.stubEnv("TEST_DATABASE_URL", target); vi.stubEnv("OWNER_GOOGLE_EMAIL", "original@example.test");
  process.argv = ["node", "not-this-evaluator.ts", "--model=gpt-6.1-sol", "--run-live"];
});
afterEach(() => { process.argv = [...originalArgv]; vi.unstubAllEnvs(); });

describe("pending evaluator preflight guards", () => {
  it.each([
    undefined, "invalid-url", "https://localhost/stardust_test_ai_reservation_pending_guard",
    "postgresql://localhost/application", "postgresql://localhost/stardust_test_ai_reservation_other",
    "postgresql://localhost/stardust_test_ai_search_pending_guard", "postgresql://remote.example.test/stardust_test_ai_reservation_pending_guard",
    `${target}?options=unsafe`, `${target}#public`, "postgresql://localhost/%E0%A4%A",
  ])("rejects an unsafe target before any connection or provider", async (url) => {
    vi.stubEnv("TEST_DATABASE_URL", url);
    await expect(main()).rejects.toThrow();
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled(); expect(mock.createTrip).not.toHaveBeenCalled();
    expect(process.env.OWNER_GOOGLE_EMAIL).toBe("original@example.test");
  });
  it.each(["DATABASE_URL", "DATABASE_DIRECT_URL"] as const)("rejects %s matching through loopback aliases before any write", async (name) => {
    vi.stubEnv(name, target.replace("127.0.0.1", "localhost"));
    expect(() => requireIsolatedTarget(parseDatabaseTarget(target))).toThrow("test_database_matches_application_database");
    await expect(main()).rejects.toThrow("test_database_matches_application_database");
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled();
  });
  it("requires explicit live opt-in and one registered model", async () => {
    expect(() => selectedModel(["--model=gpt-6.1-sol"])).toThrow("live_eval_not_authorized");
    expect(() => selectedModel(["--run-live"])).toThrow("invalid_model");
    expect(() => selectedModel(["--run-live", "--model=unregistered"])).toThrow("invalid_model");
    expect(() => selectedModel(["--run-live", "--model=gpt-6.1-sol", "--model=claude-opus-5-5"])).toThrow("invalid_model");
    expect(selectedModel(["--run-live", "--model=gpt-6.1-sol"])).toBe("gpt-6.1-sol");
    expect(selectedModel(["--run-live", "--model=claude-opus-5-5"])).toBe("claude-opus-5-5");
    process.argv = ["node", "not-this-evaluator.ts", "--model=gpt-6.1-sol"];
    await expect(main()).rejects.toThrow("live_eval_not_authorized");
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled();
  });
  it("uses the existing guarded prefix without widening operator authority", async () => {
    const work = vi.fn().mockResolvedValue("safe");
    await expect(withSyntheticAiOperator(target, work)).resolves.toBe("safe");
    expect(work).toHaveBeenCalledOnce(); expect(process.env.OWNER_GOOGLE_EMAIL).toBe("original@example.test");
  });
  it.each([
    { database_name: "stardust_test_ai_reservation_pending_guard", object_count: 1 },
    { database_name: "application", object_count: 0 },
  ])("rejects nonfresh or mismatched actual database before fixture or planner work", async (state) => {
    mock.query.mockResolvedValue({ rows: [state], rowCount: 1 });
    await expect(prepareDatabase(parseDatabaseTarget(target))).rejects.toThrow(/test_database_not_fresh|test_database_connection_failed/u);
    expect(mock.query).toHaveBeenCalledOnce(); expect(mock.end).toHaveBeenCalledOnce();
    expect(mock.planner).not.toHaveBeenCalled(); expect(mock.createTrip).not.toHaveBeenCalled();
  });
  it("returns only a stable code for a raw connection failure", async () => {
    mock.connect.mockRejectedValueOnce(new Error(`Raw diagnostics contain ${target}`));
    await expect(prepareDatabase(parseDatabaseTarget(target))).rejects.toThrow("test_database_connection_failed");
    expect(mock.end).toHaveBeenCalledOnce(); expect(mock.query).not.toHaveBeenCalled();
    expect(mock.planner).not.toHaveBeenCalled();
  });
});

const pending: PendingItineraryEditDetail = {
  requestId: "synthetic-request", status: "pending", operation: "create", targetItemId: null,
  createdByMemberId: "synthetic-creator", requestedByMemberId: "synthetic-creator", requestedByName: "Synthetic owner", source: "ai",
  reason: "Synthetic fixture", proposalRevision: 1, createdAt: "2030-04-01T00:00:00Z", updatedAt: "2030-04-01T00:00:00Z",
  patch: { tripDayId: "synthetic-day", title: "Synthetic lunch", itemType: "meal", startsAt: "2030-04-01T03:00:00Z", endsAt: "2030-04-01T04:00:00Z",
    locationName: "架空食堂ほし 秋葉原", mapUrl: null, departureLocationName: null, departureMapUrl: null, destinationLocationName: null, destinationMapUrl: null,
    flight: null, notes: "Synthetic note", visibility: "private", viewerMemberIds: ["synthetic-guest"], status: "planned", isLocked: false,
    linkedExpense: { description: "Synthetic lunch charge", amountMinor: 5101, currency: "JPY", payerMemberId: "synthetic-creator",
      occurredAt: "2030-04-01T03:00:00Z", status: "posted", splitMemberIds: ["synthetic-creator", "synthetic-guest"] },
  },
};
describe("pending evaluator invariant assertions", () => {
  const after = { ...pending, proposalRevision: 2, patch: { ...pending.patch, title: "午餐時間" } };
  it("allows only intended changed fields while requiring one revision increment", () => {
    expect(() => assertPreserved(pending, after, ["title"])).not.toThrow();
  });
  it.each([
    { requestId: "new-duplicate" }, { targetItemId: "canonical-event" }, { status: "approved" }, { source: "owner" },
    { requestedByMemberId: "different-owner" }, { createdByMemberId: "different-owner" }, { proposalRevision: 1 }, { proposalRevision: 3 },
  ])("detects identity/status/revision corruption", (override) => {
    expect(() => assertPreserved(pending, { ...after, ...override } as PendingItineraryEditDetail, ["title"])).toThrow("proposal_identity_changed");
  });
  it.each([
    { startsAt: "2030-04-01T04:30:00Z" }, { endsAt: null }, { viewerMemberIds: [] }, { visibility: "trip" }, { linkedExpense: null },
    { linkedExpense: { ...pending.patch.linkedExpense!, amountMinor: 5100 } },
    { linkedExpense: { ...pending.patch.linkedExpense!, payerMemberId: "synthetic-guest" } },
    { linkedExpense: { ...pending.patch.linkedExpense!, splitMemberIds: ["synthetic-creator"] } },
  ])("detects unintended expense/privacy/time changes", (patch) => {
    expect(() => assertPreserved(pending, { ...after, patch: { ...after.patch, ...patch } } as PendingItineraryEditDetail, ["title"])).toThrow("proposal_data_changed");
  });
});

describe("pending evaluator safe entry-point wiring", () => {
  const source = readFileSync(new URL("../../../scripts/test-ai-pending-edit.ts", import.meta.url), "utf8");
  it("finishes target/shape guards before ownership overrides and live provider calls", () => {
    const mainSource = source.slice(source.indexOf("export async function main"));
    expect(mainSource.indexOf("selectedModel")).toBeLessThan(mainSource.indexOf("runEvaluation"));
    expect(mainSource.indexOf("requireIsolatedTarget")).toBeLessThan(mainSource.indexOf("runEvaluation"));
    const evaluation = source.slice(source.indexOf("async function runEvaluation"), source.indexOf("export async function main"));
    expect(evaluation.indexOf("await prepareDatabase")).toBeLessThan(evaluation.indexOf("await withSyntheticAiOperator"));
    expect(evaluation.indexOf("await withSyntheticAiOperator")).toBeLessThan(evaluation.indexOf("new Pool"));
    expect(evaluation.indexOf("createSyntheticContext")).toBeLessThan(evaluation.indexOf("runAiPlanner"));
    const setup = source.slice(source.indexOf("async function createSyntheticContext"), source.indexOf("async function canonicalSnapshot"));
    expect(setup.indexOf("fixture_shape_mismatch")).toBeLessThan(setup.indexOf("bindSyntheticAiOperator"));
    expect(source).toContain('const EXPECTED_MIGRATION_COUNT = 45');
    expect(source).toContain('const FINAL_MIGRATION = "0049_custom_ai_instructions.sql"');
  });
  it("has an explicit exact-key replay with snapshot comparisons and no approval or cleanup authority", () => {
    expect(source).toContain("SECOND_FOLLOW_UP, model, \"zh-HK\", secondKey, fixture.conversationId");
    expect(source).toContain("await replaySnapshot(pool, fixture.session.tripId) === beforeReplay");
    expect(source).toContain("await canonicalSnapshot(pool) === beforeCanonical");
    expect(source).not.toMatch(/reviewChangeRequest|DROP DATABASE|TRUNCATE|loadEnvFile/iu);
    expect(source).not.toContain("process.env.OWNER_GOOGLE_EMAIL =");
  });
  it("prints only aggregate pass/failure and runs only when invoked as the entry script", () => {
    expect(source).toContain("pathToFileURL(process.argv[1]).href === import.meta.url");
    expect(source.match(/console\.(?:log|error)\(/gu)).toHaveLength(2);
    expect(source).toContain("AI pending edit eval passed: ${model}.");
    expect(source).toContain("AI pending edit eval failed: ${code}.");
  });
});
