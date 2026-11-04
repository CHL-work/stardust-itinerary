import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiPlannerResult } from "@/lib/ai/request-recovery-types";

const mock = vi.hoisted(() => ({ construct: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn(), planner: vi.fn(), createTrip: vi.fn() }));
vi.mock("pg", () => ({
  Client: class { constructor(input: unknown) { mock.construct(input); } connect = mock.connect; query = mock.query; end = mock.end; },
  Pool: class { constructor(input: unknown) { mock.construct(input); } },
}));
vi.mock("@/lib/ai/planner", () => ({ runAiPlanner: mock.planner }));
vi.mock("@/lib/app/repository", () => ({ createTrip: mock.createTrip }));
vi.mock("@/lib/ai/conversation", () => ({ prepareAiConversation: vi.fn() }));

import { assertProposal, assertResearchEvidence, hasSafeUnverifiedFxMessage, main, parseDatabaseTarget, prepareDatabase, requireIsolatedTarget, selectedModel, SYNTHETIC_PROMPT, type ResearchEvent } from "../../../scripts/test-ai-automatic-research";

const target = "postgresql://test:synthetic-password@127.0.0.1:5432/stardust_test_ai_auto_guard";
const originalArgv = [...process.argv];
beforeEach(() => {
  vi.clearAllMocks(); mock.connect.mockResolvedValue(undefined); mock.end.mockResolvedValue(undefined);
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/application"); vi.stubEnv("DATABASE_DIRECT_URL", "");
  vi.stubEnv("TEST_DATABASE_URL", target); vi.stubEnv("OWNER_GOOGLE_EMAIL", "original@example.test");
  process.argv = ["node", "not-this-evaluator.ts", "--model=gpt-6.1-sol", "--run-live"];
});
afterEach(() => { process.argv = [...originalArgv]; vi.unstubAllEnvs(); });

describe("automatic-research evaluator preflight guards", () => {
  it.each([
    undefined, "invalid-url", "https://localhost/stardust_test_ai_auto_guard", "postgresql://localhost/application",
    "postgresql://localhost/stardust_test_ai_search_guard", "postgresql://remote.example.test/stardust_test_ai_auto_guard",
    `${target}?options=unsafe`, `${target}#public`, "postgresql://localhost/%E0%A4%A",
    `postgresql://localhost/stardust_test_ai_auto_${"a".repeat(64)}`,
  ])("rejects unsafe targets before connection, override or provider", async (url) => {
    vi.stubEnv("TEST_DATABASE_URL", url);
    await expect(main()).rejects.toThrow();
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled(); expect(mock.createTrip).not.toHaveBeenCalled();
    expect(process.env.OWNER_GOOGLE_EMAIL).toBe("original@example.test");
  });
  it.each(["DATABASE_URL", "DATABASE_DIRECT_URL"] as const)("rejects %s matching via a loopback alias", async (name) => {
    vi.stubEnv(name, target.replace("127.0.0.1", "localhost"));
    expect(() => requireIsolatedTarget(parseDatabaseTarget(target))).toThrow("test_database_matches_application_database");
    await expect(main()).rejects.toThrow("test_database_matches_application_database");
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled();
  });
  it("requires explicit live opt-in and exactly one registered owner model", async () => {
    expect(() => selectedModel(["--model=gpt-6.1-sol"])).toThrow("live_eval_not_authorized");
    expect(() => selectedModel(["--run-live"])).toThrow("invalid_model");
    expect(() => selectedModel(["--run-live", "--model=unknown"])).toThrow("invalid_model");
    expect(() => selectedModel(["--run-live", "--model=gpt-6.1-sol", "--model=claude-opus-5-5"])).toThrow("invalid_model");
    expect(selectedModel(["--run-live", "--model=gpt-6.1-sol"])).toBe("gpt-6.1-sol");
    expect(selectedModel(["--run-live", "--model=claude-opus-5-5"])).toBe("claude-opus-5-5");
    process.argv = ["node", "not-this-evaluator.ts", "--model=gpt-6.1-sol"];
    await expect(main()).rejects.toThrow("live_eval_not_authorized");
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled();
  });
  it.each([
    { database_name: "stardust_test_ai_auto_guard", object_count: 1 }, { database_name: "application", object_count: 0 },
  ])("rejects nonfresh or mismatched actual database before any fixture writes", async (state) => {
    mock.query.mockResolvedValue({ rows: [state], rowCount: 1 });
    await expect(prepareDatabase(parseDatabaseTarget(target))).rejects.toThrow(/test_database_not_fresh|test_database_connection_failed/u);
    expect(mock.query).toHaveBeenCalledOnce(); expect(mock.end).toHaveBeenCalledOnce();
    expect(mock.planner).not.toHaveBeenCalled(); expect(mock.createTrip).not.toHaveBeenCalled();
  });
  it("redacts raw connection failures to a stable code", async () => {
    mock.connect.mockRejectedValueOnce(new Error(`Raw diagnostics contain ${target}`));
    await expect(prepareDatabase(parseDatabaseTarget(target))).rejects.toThrow("test_database_connection_failed");
    expect(mock.end).toHaveBeenCalledOnce(); expect(mock.query).not.toHaveBeenCalled();
  });
});

const dayId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";
const patch = { tripDayId: dayId, title: "Tokyo Skytree visit", itemType: "activity", status: "planned", visibility: "trip", viewerMemberIds: [],
  startsAt: "2030-04-02T01:00:00Z", endsAt: "2030-04-02T02:00:00Z", locationName: "Tokyo Skytree, Tokyo",
  linkedExpense: { description: "Admission", amountMinor: 12345, currency: "HKD", payerMemberId: memberId,
    occurredAt: "2030-04-02T01:00:00Z", status: "posted", splitMemberIds: [memberId] } };
const result = { webSearch: { performed: true, queryCount: 1, sources: ["https://www.example.org/public-rate"] } } as AiPlannerResult;
const events: ResearchEvent[] = [
  { event_type: "public.research.requested", payload: { eligibleCount: 1 } },
  { event_type: "public.research.completed", payload: { outcome: "researched", queryCount: 1, queries: ["HKD/JPY latest reference rate"],
    sourceUrls: ["https://www.example.org/public-rate"], facts: [{ key: "R1", kind: "exchange_rate", status: "verified" }] } },
  { event_type: "public.research.finalized", payload: { finalized: true, factCount: 1 } },
];
describe("automatic-research evaluator assertions", () => {
  it("accepts the unchanged original-currency linked expense and exactly requested schedule", () => {
    expect(() => assertProposal(patch, dayId, memberId)).not.toThrow();
  });
  it.each([
    { linkedExpense: null }, { linkedExpense: { ...patch.linkedExpense, currency: "JPY" } },
    { linkedExpense: { ...patch.linkedExpense, amountMinor: 12346 } },
    { linkedExpense: { ...patch.linkedExpense, payerMemberId: dayId } },
    { linkedExpense: { ...patch.linkedExpense, splitMemberIds: [memberId, dayId] } },
    { visibility: "private" }, { startsAt: "2030-04-03T10:00:00+09:00" }, { itemType: "lodging" },
  ])("rejects currency/amount/audience/time drift", (override) => {
    expect(() => assertProposal({ ...patch, ...override }, dayId, memberId)).toThrow("proposal_shape_mismatch");
  });
  it("requires one completed/finalized sourced exchange-rate research round", () => {
    expect(() => assertResearchEvidence(events, result)).not.toThrow();
    expect(() => assertResearchEvidence(events.slice(1), result)).toThrow("automatic_research_missing");
    expect(() => assertResearchEvidence([...events, events[0]!], result)).toThrow("automatic_research_missing");
  });
  it.each([
    { facts: [{ key: "R1", kind: "venue", status: "verified" }] },
    { facts: [{ key: "R1", kind: "exchange_rate", status: "unverified" }] },
    { outcome: "timeout" },
  ])("does not pass from unrelated or missing evidence", (override) => {
    const changed = events.map((event) => event.event_type === "public.research.completed" ? { ...event, payload: { ...event.payload, ...override } } : event);
    expect(() => assertResearchEvidence(changed, result)).toThrow("automatic_research_missing");
  });
  it.each([{ queryCount: 0 }, { queries: ["Tokyo Skytree hours"] }, { sourceUrls: [] }, { sourceUrls: ["https://user:secret@example.org/path"] }])("rejects missing/unsafe observed FX search evidence", (override) => {
    const changed = events.map((event) => event.event_type === "public.research.completed" ? { ...event, payload: { ...event.payload, ...override } } : event);
    expect(() => assertResearchEvidence(changed, result)).toThrow("search_evidence_missing");
  });
});

describe("explicit automatic-research workflow evaluation mode", () => {
  const unverifiedEvents: ResearchEvent[] = events.map((event) => event.event_type === "public.research.completed" ? {
    ...event, payload: { ...event.payload, outcome: "unverified", sourceUrls: [], facts: [{ key: "R1", kind: "exchange_rate", status: "unverified" }] },
  } : event);
  const unverifiedResult = { ...result, message: "I could not verify a dated HKD/JPY exchange rate. The pending expense remains HKD 123.45.",
    webSearch: { performed: true, queryCount: 1, sources: [] } } as AiPlannerResult;

  it("keeps the default sourced-FX benchmark strict when search genuinely has no verified source", () => {
    expect(() => assertResearchEvidence(unverifiedEvents, unverifiedResult)).toThrow("automatic_research_missing");
    expect(() => assertResearchEvidence(unverifiedEvents, unverifiedResult, false)).toThrow("automatic_research_missing");
  });
  it("allows only the named workflow mode to pass genuinely unverified, clearly disclosed FX evidence", () => {
    expect(() => assertResearchEvidence(unverifiedEvents, unverifiedResult, true)).not.toThrow();
  });
  it("still accepts sourced FX with the workflow option", () => {
    expect(() => assertResearchEvidence(events, result, true)).not.toThrow();
  });
  it("classifies FX itself even when a mixed batch verified another target", () => {
    const mixed = unverifiedEvents.map((event) => event.event_type === "public.research.completed" ? {
      ...event, payload: { ...event.payload, outcome: "researched", sourceUrls: ["https://www.example.org/venue"],
        facts: [{ key: "R1", kind: "exchange_rate", status: "unverified" }, { key: "R2", kind: "venue", status: "verified" }] },
    } : event);
    const mixedResult = { ...unverifiedResult, webSearch: { ...unverifiedResult.webSearch, sources: ["https://www.example.org/venue"] } };
    expect(() => assertResearchEvidence(mixed, mixedResult)).toThrow("automatic_research_missing");
    expect(() => assertResearchEvidence(mixed, mixedResult, true)).not.toThrow();
  });
  it.each(["failed", "timeout", "cleanup_failed", "budget_exhausted", "user_disabled", "privacy_blocked"])(
    "does not turn an execution failure or skipped research (%s) into workflow success", (outcome) => {
      const changed = unverifiedEvents.map((event) => event.event_type === "public.research.completed" ? { ...event, payload: { ...event.payload, outcome } } : event);
      expect(() => assertResearchEvidence(changed, unverifiedResult, true)).toThrow("automatic_research_missing");
    },
  );
  it.each([
    { queryCount: 0 }, { queries: ["Tokyo Skytree hours"] }, { facts: [{ key: "R2", kind: "venue", status: "unverified" }] },
  ])("retains observed FX search and target requirements in workflow mode", (override) => {
    const changed = unverifiedEvents.map((event) => event.event_type === "public.research.completed" ? { ...event, payload: { ...event.payload, ...override } } : event);
    expect(() => assertResearchEvidence(changed, unverifiedResult, true)).toThrow();
  });
  it.each([
    "The visit is pending and the expense is HKD 123.45.",
    "The venue schedule is unverified. HKD/JPY exchange rate will be included later.",
    "I could not verify the HKD/JPY rate, but 1 HKD = 19.9 JPY is a reasonable estimate.",
    "HKD/JPY is unverified. HKD/JPY: 19.9.",
    "The FX rate is unverified, but reference rate is around 19.9 JPY.",
    "I could not confirm an exchange rate. Use 19.9 JPY per HKD for now.",
  ])("rejects missing FX uncertainty or an unverified numeric quote: %s", (message) => {
    expect(hasSafeUnverifiedFxMessage(message)).toBe(false);
    expect(() => assertResearchEvidence(unverifiedEvents, { ...unverifiedResult, message }, true)).toThrow("unverified_fx_message_mismatch");
  });
  it.each([
    "I couldn't verify the latest HKD/JPY exchange rate. The HKD 123.45 ledger amount stays unchanged.",
    "The HKD/JPY reference rate remains unverified; no conversion was recorded.",
    "I was unable to confirm a dated exchange rate; the expense remains HKD 123.45.",
  ])("recognizes explicit English FX uncertainty without mistaking the unchanged expense for a quote", (message) => {
    expect(hasSafeUnverifiedFxMessage(message)).toBe(true);
    expect(() => assertResearchEvidence(unverifiedEvents, { ...unverifiedResult, message }, true)).not.toThrow();
  });
  it("never accepts a verified fact without a source just because workflow mode was chosen", () => {
    const changed = events.map((event) => event.event_type === "public.research.completed" ? { ...event, payload: { ...event.payload, sourceUrls: [] } } : event);
    expect(() => assertResearchEvidence(changed, result, true)).toThrow("search_evidence_missing");
  });
});

describe("automatic-research evaluator safe wiring", () => {
  const source = readFileSync(new URL("../../../scripts/test-ai-automatic-research.ts", import.meta.url), "utf8");
  it("guards target and demo shape before synthetic identity, provider and migration work", () => {
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
  it("uses synthetic input without an explicit search instruction and enforces exact-key replay and canonical invariants", () => {
    expect(SYNTHETIC_PROMPT).not.toMatch(/search|browse|look\s*up|research|google\s*maps/iu);
    expect(source).toContain('SYNTHETIC_PROMPT, model, "en", key, fixture.conversationId');
    expect(source).toContain("await replaySnapshot(pool, fixture.session.tripId) === beforeReplay");
    expect(source).toContain("await canonicalSnapshot(pool) === beforeCanonical");
    expect(source).not.toMatch(/reviewChangeRequest|DROP DATABASE|TRUNCATE|loadEnvFile/iu);
    expect(source).not.toContain("process.env.OWNER_GOOGLE_EMAIL =");
    const evaluation = source.slice(source.indexOf("async function runEvaluation"), source.indexOf("export async function main"));
    expect(evaluation.indexOf("assertProposal(")).toBeLessThan(evaluation.indexOf("assertResearchEvidence("));
    expect(evaluation.indexOf("await replaySnapshot(pool, fixture.session.tripId) === beforeReplay")).toBeLessThan(evaluation.indexOf("assertResearchEvidence("));
    expect(evaluation.lastIndexOf("await canonicalSnapshot(pool) === beforeCanonical")).toBeLessThan(evaluation.indexOf("assertResearchEvidence("));
  });
  it("is opt-in and emits only stable-code and allowlisted aggregate diagnostics", () => {
    expect(source).toContain("pathToFileURL(process.argv[1]).href === import.meta.url");
    expect(source.match(/console\.(?:log|error)\(/gu)).toHaveLength(2);
    expect(source).not.toContain("JSON.stringify(result)");
    expect(source).not.toContain("JSON.stringify(error)");
    expect(source).toContain('includes("--allow-unverified")');
    expect(source).toContain('"strict_sourced_fx"');
    expect(source).toContain('"workflow_allow_unverified"');
    expect(source).toContain("sourceOutcome: fxStatus");
  });
});
