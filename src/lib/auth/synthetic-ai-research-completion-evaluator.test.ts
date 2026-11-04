import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderFailureError } from "@/lib/ai/provider-failure";
import type { AiPlannerResult } from "@/lib/ai/request-recovery-types";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const mock = vi.hoisted(() => ({ construct: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn(), poolEnd: vi.fn(),
  poolQuery: vi.fn(), planner: vi.fn(), createTrip: vi.fn() }));
vi.mock("pg", () => ({
  Client: class { constructor(input: unknown) { mock.construct(input); } connect = mock.connect; query = mock.query; end = mock.end; },
  Pool: class { constructor(input: unknown) { mock.construct(input); } query = mock.poolQuery; end = mock.poolEnd; },
}));
vi.mock("@/lib/ai/planner", () => ({ runAiPlanner: mock.planner }));
vi.mock("@/lib/app/repository", () => ({ createTrip: mock.createTrip }));
vi.mock("@/lib/ai/conversation", () => ({ prepareAiConversation: vi.fn() }));

import {
  assertAnswer, assertResearchCompletion, currentJapanDate, EXPECTED_MIGRATION_COUNT, FINAL_MIGRATION,
  main, parseDatabaseTarget, parseOptions, prepareDatabase, publicDiscoveryPrompt, requireIsolatedTarget,
  runEvaluation, type CompletionOptions, type ResearchEvent,
} from "../../../scripts/test-ai-research-completion";

const targetUrl = "postgresql://test:synthetic-password@127.0.0.1:5432/stardust_test_ai_completion_guard";
const options: CompletionOptions = { model: "gpt-6.1-sol", date: "2026-09-12" };
const session: AuthenticatedSession = { tripId: "10000000-0000-4000-8000-000000000099", memberId: "20000000-0000-4000-8000-000000000099",
  userId: "00000000-0000-4000-8000-000000000001", sessionId: "synthetic", role: "owner", displayName: "Demo Owner",
  expiresAt: new Date("2026-09-13T00:00:00Z"), absoluteExpiresAt: new Date("2026-09-15T00:00:00Z"),
  issuer: "https://accounts.google.com", subject: "synthetic", generation: 1 };
const answer = "Nagoya research: Pokémon has a sourced public exhibition listing, but check its applicable dates before visiting. Detective Conan has no verified current pop-up. Gundam has no verified current pop-up. Published listings do not guarantee admission.";
const result: AiPlannerResult = { requestId: "40000000-0000-4000-8000-000000000099", message: answer,
  proposalIds: [], proposalCount: 0, proposalId: null, changeStatus: null, entityId: null, model: options.model,
  usedToday: 1, remainingToday: null, webSearch: { performed: true, queryCount: 3, sources: ["https://www.pokemon.co.jp/public-event"] },
  memory: { previousTurnsUsed: 0, tokenEstimate: 200, tokenBudget: 6000, checkpointVersion: null, truncated: false } };
const events: ResearchEvent[] = [
  { event_type: "public.research.requested", payload: { eligibleCount: 3, hoursTargetCount: 0 } },
  { event_type: "public.research.completed", payload: { outcome: "researched", targetCount: 3, queryCount: 3,
    queries: ["Nagoya Pokémon public events", "Nagoya Detective Conan public events", "Nagoya Gundam public events"],
    sourceUrls: ["https://www.pokemon.co.jp/public-event"], facts: [
      { key: "R1", kind: "discovery", status: "verified" }, { key: "R2", kind: "discovery", status: "unverified" },
      { key: "R3", kind: "discovery", status: "unverified" },
    ] } },
  { event_type: "public.research.finalized", payload: { finalized: true, factCount: 3, outcome: "researched" } },
];
const modifyEvent = (type: string, override: Record<string, unknown>) => events.map((event) => event.event_type === type
  ? { ...event, payload: { ...event.payload, ...override } } : event);

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-12T03:00:00Z"));
  vi.stubEnv("TEST_DATABASE_URL", targetUrl); vi.stubEnv("TEST_DATABASE_CONFIRM_DESTROY", "stardust_test_ai_completion_guard");
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/application"); vi.stubEnv("DATABASE_DIRECT_URL", "");
  vi.stubEnv("OWNER_GOOGLE_EMAIL", "prior@example.test");
  mock.connect.mockResolvedValue(undefined); mock.end.mockResolvedValue(undefined); mock.poolEnd.mockResolvedValue(undefined);
  mock.query.mockResolvedValue({ rows: [{ database_name: "stardust_test_ai_completion_guard", object_count: 0 }], rowCount: 1 });
  mock.planner.mockRejectedValue(new Error("Unexpected default provider invocation"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("completion evaluator preflight", () => {
  it.each([
    [], ["--run-live"], ["--model=gpt-6.1-sol"], ["--run-live", "--model=unknown"],
    ["--run-live", "--model=gpt-6-astra"], ["--run-live", "--model=__proto__"],
    ["--run-live", "--model=gpt-6.1-sol", "--model=claude-fable-5-1"],
    ["--run-live", "--run-live", "--model=gpt-6.1-sol"],
    ["--run-live", "--model=gpt-6.1-sol", "--prompt=arbitrary"],
    ["--run-live", "--model=gpt-6.1-sol", "--date=2026-09-11"],
    ["--run-live", "--model=gpt-6.1-sol", "--date=2030-02-30"],
    ["--run-live", "--model=gpt-6.1-sol", "--date=2026-09-12", "--date=2026-09-12"],
  ].map((args) => ({ args })))("rejects invalid CLI before connection or operator override: $args", async ({ args }) => {
    expect(await main(args)).toEqual({ status: "failed", stage: "preflight", code: "arguments_invalid" });
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled();
    expect(process.env.OWNER_GOOGLE_EMAIL).toBe("prior@example.test");
  });
  it("anchors the fixed public prompt to actual Japan date and accepts only the incident models", () => {
    expect(currentJapanDate(new Date("2026-09-11T15:00:00Z"))).toBe("2026-09-12");
    expect(parseOptions(["--", "--run-live", "--model=gpt-6.1-sol"])).toEqual(options);
    expect(parseOptions(["--run-live", "--model=claude-fable-5-1", "--date=2026-09-12"]).model).toBe("claude-fable-5-1");
    const prompt = publicDiscoveryPrompt(options.date);
    expect(prompt).toContain("Nagoya"); expect(prompt).toContain("2026-09-12");
    expect(prompt).toContain("Pokémon, Detective Conan, and Gundam");
    expect(prompt).toContain("Do not create, edit or propose any event or expense");
    expect(prompt).not.toContain("prior@example.test");
  });
  it.each([
    undefined, "not-a-url", "https://localhost/stardust_test_ai_completion_guard", "postgresql://remote.example.test/stardust_test_ai_completion_guard",
    "postgresql://localhost/application", "postgresql://localhost/stardust_test_ai_auto_guard", `${targetUrl}?options=unsafe`, `${targetUrl}#schema`,
    "postgresql://localhost/%E0%A4%A", `postgresql://localhost/stardust_test_ai_completion_${"a".repeat(64)}`,
  ])("rejects an unsafe DB URL without any side effects", async (url) => {
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(await main(["--run-live", "--model=gpt-6.1-sol"])).toMatchObject({ status: "failed", code: "test_database_invalid" });
    expect(mock.construct).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled();
  });
  it.each(["DATABASE_URL", "DATABASE_DIRECT_URL"] as const)("rejects a live target through another loopback alias in %s", async (variable) => {
    vi.stubEnv(variable, targetUrl.replace("127.0.0.1", "localhost"));
    expect(() => requireIsolatedTarget(parseDatabaseTarget(targetUrl))).toThrow("test_database_not_isolated");
    expect(await main(["--run-live", "--model=gpt-6.1-sol"])).toMatchObject({ code: "test_database_not_isolated" });
    expect(mock.construct).not.toHaveBeenCalled();
  });
  it("requires the exact disposable database confirmation, including programmatic callers", async () => {
    vi.stubEnv("TEST_DATABASE_CONFIRM_DESTROY", "wrong_database");
    const prepare = vi.fn();
    expect(await runEvaluation(parseDatabaseTarget(targetUrl), options, { prepare })).toMatchObject({ code: "test_database_unconfirmed" });
    expect(prepare).not.toHaveBeenCalled(); expect(mock.construct).not.toHaveBeenCalled();
  });
  it.each([
    { database_name: "application", object_count: 0 }, { database_name: "stardust_test_ai_completion_guard", object_count: 1 },
  ])("rejects mismatched/nonfresh databases before migrations or fixture writes", async (state) => {
    mock.query.mockResolvedValue({ rows: [state], rowCount: 1 });
    const migrate = vi.fn();
    await expect(prepareDatabase(parseDatabaseTarget(targetUrl), migrate)).rejects.toThrow(/test_database_(?:connection_failed|not_fresh)/u);
    expect(mock.query).toHaveBeenCalledOnce(); expect(migrate).not.toHaveBeenCalled(); expect(mock.end).toHaveBeenCalledOnce();
  });
  it("applies the complete current migration set before the local synthetic fixture", async () => {
    const migrations = Array.from({ length: EXPECTED_MIGRATION_COUNT }, (_, index) => `migration-${index}`);
    migrations[migrations.length - 1] = FINAL_MIGRATION;
    const migrate = vi.fn().mockResolvedValue(migrations);
    await prepareDatabase(parseDatabaseTarget(targetUrl), migrate);
    expect(migrate).toHaveBeenCalledOnce();
    expect(mock.query.mock.calls[1]?.[0]).toBe("BEGIN");
    expect(mock.query.mock.calls[2]?.[0]).toContain("Example Journey");
    expect(mock.query.mock.calls[3]?.[0]).toBe("COMMIT"); expect(mock.end).toHaveBeenCalledOnce();
  });
  it("rejects old/partial migrations and redacts raw connection failures", async () => {
    await expect(prepareDatabase(parseDatabaseTarget(targetUrl), vi.fn().mockResolvedValue([FINAL_MIGRATION])))
      .rejects.toThrow("migration_set_mismatch");
    mock.connect.mockRejectedValue(new Error(`Connection diagnostic ${targetUrl}`));
    await expect(prepareDatabase(parseDatabaseTarget(targetUrl), vi.fn())).rejects.toThrow("test_database_connection_failed");
    expect(mock.createTrip).not.toHaveBeenCalled(); expect(mock.planner).not.toHaveBeenCalled();
  });
});

describe("multi-topic discovery completion assertions", () => {
  it("accepts completed multi-target research and labels mixed source confidence explicitly", () => {
    expect(assertResearchCompletion(events, result)).toEqual({ targetCount: 3, queryCount: 3, verifiedCount: 1, unverifiedCount: 2,
      sourceClassification: "partially_verified", sourceDomains: ["www.pokemon.co.jp"] });
  });
  it("allows two derived targets without demanding an exact three-target model response", () => {
    const two = events.map((event) => ({ ...event, payload: event.event_type === "public.research.requested" ? { ...event.payload, eligibleCount: 2 }
      : event.event_type === "public.research.completed" ? { ...event.payload, targetCount: 2, facts: (event.payload.facts as unknown[]).slice(0, 2) }
        : { ...event.payload, factCount: 2 } }));
    expect(assertResearchCompletion(two, result).targetCount).toBe(2);
  });
  it.each(["timeout", "failed", "budget_exhausted", "privacy_blocked", "user_disabled", "finalization_failed"])(
    "never calls %s a completed workflow", (outcome) => {
      expect(() => assertResearchCompletion(modifyEvent("public.research.completed", { outcome }), result)).toThrow("research_incomplete");
    });
  it.each([
    { type: "public.research.requested", payload: { eligibleCount: 1 } },
    { type: "public.research.requested", payload: { hoursTargetCount: 3 } },
    { type: "public.research.finalized", payload: { finalized: false } },
    { type: "public.research.finalized", payload: { factCount: 0 } },
    { type: "public.research.completed", payload: { targetCount: 1 } },
  ])("requires real multi-target discovery and successful finalization", ({ type, payload }) => {
    expect(() => assertResearchCompletion(modifyEvent(type, payload), result)).toThrow("research_incomplete");
  });
  it.each([
    { queryCount: 0 }, { queries: [] }, { queries: ["Nagoya Pokémon", "Nagoya Pokémon", "Nagoya Pokémon"] },
    { sourceUrls: [] }, { sourceUrls: ["https://secret:password@example.test/path"] },
    { facts: [{ key: "R1", kind: "venue", status: "verified" }, { key: "R2", kind: "venue", status: "unverified" }, { key: "R3", kind: "venue", status: "unverified" }] },
    { facts: [{ key: "R1", kind: "discovery", status: "verified" }, { key: "R1", kind: "discovery", status: "unverified" }, { key: "R3", kind: "discovery", status: "unverified" }] },
  ])("rejects missing, unrelated, unsafe or duplicate observed evidence", (override) => {
    expect(() => assertResearchCompletion(modifyEvent("public.research.completed", override), result)).toThrow("research_evidence_missing");
  });
  it("passes honest all-unverified completion only with an unambiguous unverified classification", () => {
    const unverified = modifyEvent("public.research.completed", { outcome: "unverified", sourceUrls: [],
      facts: [1, 2, 3].map((index) => ({ key: `R${index}`, kind: "discovery", status: "unverified" })) });
    const response = { ...result, message: "Nagoya: no current verified pop-up was found for Pokémon. No current verified exhibition was found for Detective Conan. No current verified collaboration cafe was found for Gundam. Please check official announcements before making a special trip.",
      webSearch: { ...result.webSearch, sources: [] } };
    expect(assertResearchCompletion(unverified, response)).toMatchObject({ sourceClassification: "unverified", verifiedCount: 0, unverifiedCount: 3, sourceDomains: [] });
    expect(() => assertResearchCompletion(unverified, { ...response, message: response.message + " The events are running today." })).toThrow("answer_incomplete");
  });
  it.each(["doesn't", "does not", "doesn’t"])("allows only the explicit negative epistemic disclaimer (%s)", (contraction) => {
    const base = "Nagoya: no current verified pop-up was found for Pokémon, Detective Conan, or Gundam. Please check official announcements before making a special trip. ";
    const disclaimer = `This ${contraction} mean nothing is running today, only that nothing could be confirmed from current public sources in this research round.`;
    expect(() => assertAnswer(base + disclaimer, true)).not.toThrow();
    expect(() => assertAnswer(base + disclaimer + " Gundam is running today.", true)).toThrow("answer_incomplete");
    expect(() => assertAnswer(base + `This ${contraction} mean nothing is running today.`, true)).toThrow("answer_incomplete");
  });
  it.each(["No proposal was saved because research did not finish.", "No current events could be verified. Please retry.",
    "Nagoya Pokémon and Gundam are possible options. More information is needed to help you plan a visit. Please check current venue schedules before travelling."])(
    "rejects canned or incomplete answers without dumping their content", (message) => {
      expect(() => assertAnswer(message, false)).toThrow("answer_incomplete");
    });
});

function workflow() {
  const prepare = vi.fn().mockResolvedValue(undefined);
  const context = vi.fn().mockResolvedValue({ session, conversationId: "50000000-0000-4000-8000-000000000099" });
  const planner = vi.fn<typeof mock.planner>().mockResolvedValueOnce(result).mockResolvedValueOnce({ request: {
    requestId: result.requestId, status: "succeeded", result,
  } });
  mock.poolQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT status,")) return { rowCount: 1, rows: [{ status: "succeeded", requested_model: options.model,
      effective_model: options.model, provider: "openai", transport: "codex_sdk", authentication_mode: "chatgpt_subscription",
      proposal_id: null, response_json: result, actor_user_id: session.userId, actor_member_id: session.memberId,
      client_request_id: planner.mock.calls[0]?.[5] }] };
    if (sql.startsWith("SELECT event_type")) return { rows: events, rowCount: events.length };
    return { rows: [{ digest: "unchanged" }], rowCount: 1 };
  });
  return { prepare, context, planner };
}

describe("full planner and durable exact-key replay workflow", () => {
  it("verifies zero canonical changes and own saved-result replay, restoring operator state and pool", async () => {
    const dependency = workflow();
    const report = await runEvaluation(parseDatabaseTarget(targetUrl), options, dependency);
    expect(report).toMatchObject({ status: "passed", stage: "complete", model: options.model, proposalCount: 0,
      replayVerified: true, sourceClassification: "partially_verified" });
    expect(dependency.planner).toHaveBeenCalledTimes(2);
    expect(dependency.planner.mock.calls[1]).toEqual(dependency.planner.mock.calls[0]);
    expect(mock.poolEnd).toHaveBeenCalledOnce(); expect(process.env.OWNER_GOOGLE_EMAIL).toBe("prior@example.test");
    expect(JSON.stringify(report)).not.toMatch(/Pokémon|Nagoya|https:|synthetic-password|prior@|requestId|message/u);
    expect(mock.planner).not.toHaveBeenCalled();
  });
  it("rejects unsolicited proposals without invoking replay", async () => {
    const dependency = workflow(); dependency.planner.mockReset().mockResolvedValue({ ...result, proposalCount: 1, proposalIds: [session.tripId] });
    expect(await runEvaluation(parseDatabaseTarget(targetUrl), options, dependency)).toMatchObject({ status: "failed", code: "planner_result_mismatch" });
    expect(dependency.planner).toHaveBeenCalledOnce(); expect(mock.poolEnd).toHaveBeenCalledOnce();
  });
  it("rejects canonical mutation before replay", async () => {
    const dependency = workflow(), original = mock.poolQuery.getMockImplementation()!;
    let itineraryReads = 0;
    mock.poolQuery.mockImplementation(async (sql: string) => sql.includes("FROM itinerary_items record")
      ? { rows: [{ digest: ++itineraryReads === 1 ? "before" : "changed" }] } : original(sql));
    expect(await runEvaluation(parseDatabaseTarget(targetUrl), options, dependency)).toMatchObject({ code: "canonical_data_changed" });
    expect(dependency.planner).toHaveBeenCalledOnce();
  });
  it("rejects replay response drift and extra recorded provider activity", async () => {
    const dependency = workflow(); dependency.planner.mockReset().mockResolvedValueOnce(result).mockResolvedValueOnce({ request: {
      requestId: result.requestId, status: "succeeded", result: { ...result, message: "Different" },
    } });
    expect(await runEvaluation(parseDatabaseTarget(targetUrl), options, dependency)).toMatchObject({ code: "request_replay_mismatch" });
    const second = workflow(), original = mock.poolQuery.getMockImplementation()!;
    let requestReads = 0;
    mock.poolQuery.mockImplementation(async (sql: string) => sql.includes("FROM ai_requests record")
      ? { rows: [{ digest: ++requestReads === 1 ? "before" : "extra-provider-activity" }] } : original(sql));
    expect(await runEvaluation(parseDatabaseTarget(targetUrl), options, second)).toMatchObject({ code: "request_replay_mismatch" });
  });
  it("redacts provider failure while preserving safe category and cleanup state", async () => {
    const dependency = workflow(); dependency.planner.mockReset().mockRejectedValue(new AiProviderFailureError({ code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic" }));
    mock.poolEnd.mockRejectedValue(new Error(`Cleanup diagnostic ${targetUrl}`));
    const report = await runEvaluation(parseDatabaseTarget(targetUrl), options, dependency);
    expect(report).toMatchObject({ status: "failed", code: "AI_PROVIDER_RATE_LIMITED", cleanupFailed: true });
    expect(JSON.stringify(report)).not.toContain("synthetic-password"); expect(process.env.OWNER_GOOGLE_EMAIL).toBe("prior@example.test");
  });
  it("requires cleanup success for an otherwise completed workflow", async () => {
    const dependency = workflow(); mock.poolEnd.mockRejectedValue(new Error("synthetic cleanup error"));
    expect(await runEvaluation(parseDatabaseTarget(targetUrl), options, dependency)).toMatchObject({ status: "failed", code: "cleanup_failed", replayVerified: true });
  });
  it("does not load local secrets, accept custom prompts or create/drop databases", () => {
    const source = readFileSync(new URL("../../../scripts/test-ai-research-completion.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/loadEnvFile|loadEnvConfig|CREATE DATABASE|DROP DATABASE|process\.env\.OWNER_GOOGLE_EMAIL\s*=/u);
    expect(source).toContain("migrate({ connectionString: target.connectionString })");
    expect(source).toContain("prepareAiConversation"); expect(source).toContain("withSyntheticAiOperator");
  });
});
