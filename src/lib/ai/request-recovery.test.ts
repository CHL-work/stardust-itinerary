import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppConflictError, AppForbiddenError } from "@/lib/app/repository";
import { assertBoundUserAiIdle, lockBoundUserAi } from "@/lib/ai/conversation";
import { aiProviderFailureCodes } from "@/lib/ai/provider-failure";
import {
  aiRequestPayloadHash, assertAiRequestWritable, findAiRequestReplay, readAiRequestRecovery,
  AiRequestInterruptedError,
} from "@/lib/ai/request-recovery";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = { tripId: id(1), memberId: id(2), userId: id(3), role: "editor" } as AuthenticatedSession;
const clientRequestId = id(4);
const response = {
  requestId: id(5), message: "Dinner is awaiting review.", proposalIds: [id(6)], proposalCount: 1,
  proposalId: id(6), changeStatus: "pending", entityId: null, model: "gpt-6.1-sol", usedToday: 1,
  remainingToday: 19, webSearch: { performed: false, queryCount: 0, sources: [] },
  memory: { previousTurnsUsed: 1, tokenEstimate: 200, tokenBudget: 6000, checkpointVersion: null,
    truncated: false },
};
function row(overrides: Record<string, unknown> = {}) {
  return { id: id(5), client_request_id: clientRequestId, conversation_id: id(7), status: "succeeded",
    created_at: "2026-09-05T12:00:00Z", completed_at: "2026-09-05T12:01:00Z",
    result_text: response.message, response_json: response, error_code: null,
    expired: false, recoverable: true, request_payload_hash: "a".repeat(64), ...overrides };
}
function db(value: ReturnType<typeof row> | null = row(), options: { bound?: boolean; busy?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT role FROM trip_members")) return { rows: [{ role: session.role }], rowCount: 1 };
    if (sql.startsWith("SELECT 1 FROM trip_members")) return { rows: options.bound === false ? [] : [{}] };
    if (sql.includes("SELECT request.id,")) return { rows: value ? [value] : [] };
    if (sql.includes("SELECT EXISTS")) return { rows: [{ busy: options.busy ?? false }] };
    return { rows: [], rowCount: 1 };
  });
  return { query, pool: { query, connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool, client: { query } as unknown as PoolClient };
}

describe("self-only AI recovery", () => {
  it("decodes old saved receipts without returning retired preference metadata", async () => {
    const legacy = { ...response, memory: { ...response.memory, personalMemoriesUsed: 3 },
      preferenceChanges: [{ id: id(90), action: "created", subject: "Synthetic retired fact" }] };
    const { pool, query } = db(row({ response_json: legacy }));
    const result = await readAiRequestRecovery(pool, session, session.tripId, clientRequestId);
    expect(result.request?.result).toEqual(response);
    expect(JSON.stringify(result)).not.toContain("Synthetic retired fact");
    expect(JSON.stringify(result)).not.toContain("personalMemoriesUsed");
    const sql = query.mock.calls.find(([sql]) => sql.includes("SELECT request.id,"))?.[0];
    expect(sql).toContain("COALESCE(to_jsonb(conversation)->>'purpose','trip') = 'trip'");
  });

  it("hashes exact semantic submission fields without trimming or omitting the model choice", () => {
    const original = aiRequestPayloadHash("Plan dinner", undefined, "en");
    expect(original).toMatch(/^[0-9a-f]{64}$/u);
    expect(aiRequestPayloadHash("Plan dinner", undefined, "en")).toBe(original);
    expect(aiRequestPayloadHash("Plan dinner ", undefined, "en")).not.toBe(original);
    expect(aiRequestPayloadHash("Plan dinner", "gpt-6.1-sol", "en")).not.toBe(original);
    expect(aiRequestPayloadHash("Plan dinner", undefined, "zh-HK")).not.toBe(original);
    expect(aiRequestPayloadHash("Plan dinner", undefined, "en", null)).not.toBe(original);
    expect(aiRequestPayloadHash("Plan dinner", undefined, "en", id(7))).not.toBe(original);
    expect(aiRequestPayloadHash("Plan dinner", undefined, "en", id(7)))
      .not.toBe(aiRequestPayloadHash("Plan dinner", undefined, "en", id(8)));
  });

  it("projects a strict final receipt scoped to the exact user/member/trip and active conversation", async () => {
    const { pool, query } = db();
    const result = await readAiRequestRecovery(pool, session, session.tripId, clientRequestId);
    expect(result.request?.result).toEqual(response);
    const selected = query.mock.calls.find(([sql]) => sql.includes("SELECT request.id,"));
    expect(selected?.[0]).toContain("member.user_id = $3 AND member.status = 'active'");
    expect(selected?.[0]).toContain("conversation.closed_at IS NULL");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT request.id,"),
      [session.tripId, session.memberId, session.userId, clientRequestId, 10]);
    expect(JSON.stringify(result)).not.toContain("prompt_text");
    expect(query.mock.calls.every(([sql]) => !/^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(true);
  });

  it.each([
    { ...response, rawProviderError: "secret" },
    { ...response, memory: { ...response.memory, prompt: "private" } },
    { ...response, requestId: id(99) },
    { ...response, webSearch: { ...response.webSearch, sources: ["javascript:alert(1)"] } },
    { message: "Incomplete object" },
  ])("rejects malformed or extra-field persisted response objects", async (bad) => {
    const { pool } = db(row({ response_json: bad }));
    const result = await readAiRequestRecovery(pool, session, session.tripId);
    expect(result.request?.result).toBeNull();
    expect(result.request?.message).toBe(response.message);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("returns only a boolean about this user's work in another trip", async () => {
    const { pool } = db(null, { busy: true });
    expect(await readAiRequestRecovery(pool, session, session.tripId)).toEqual({ request: null, busyElsewhere: true, activeConversationId: null });
  });

  it.each([
    [{ status: "started", expired: false }, "running", null],
    [{ status: "started", expired: true }, "interrupted", "AI_REQUEST_INTERRUPTED"],
    [{ status: "failed", error_code: "PRIVATE_PROVIDER_FAILURE" }, "failed", "AI_REQUEST_FAILED"],
    [{ status: "failed", error_code: "AiRequestInterruptedError" }, "interrupted", "AI_REQUEST_INTERRUPTED"],
    [{ status: "failed", error_code: "AbortError" }, "failed", "AI_REQUEST_TIMEOUT"],
    [{ status: "failed", error_code: "TimeoutError" }, "failed", "AI_REQUEST_TIMEOUT"],
    [{ status: "failed", error_code: "AI_REQUEST_TIMEOUT" }, "failed", "AI_REQUEST_TIMEOUT"],
    [{ status: "failed", error_code: "AI_SEARCH_EVIDENCE_MISSING" }, "failed", "AI_SEARCH_EVIDENCE_MISSING"],
    [{ status: "failed", error_code: "ZodError" }, "failed", "AI_PROPOSAL_VALIDATION_FAILED"],
  ])("reports safe state for %j", async (patch, status, errorCode) => {
    const { pool } = db(row(patch));
    const result = await readAiRequestRecovery(pool, session, session.tripId);
    expect(result.request).toMatchObject({ status, errorCode, message: null, result: null });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_FAILURE");
  });

  it("denies revoked/rebound identities and cross-trip reads before selecting request content", async () => {
    const { pool, query } = db(row(), { bound: false });
    await expect(readAiRequestRecovery(pool, session, session.tripId)).rejects.toBeInstanceOf(AppForbiddenError);
    expect(query).toHaveBeenCalledTimes(3);
    query.mockClear();
    await expect(readAiRequestRecovery(pool, session, id(99))).rejects.toBeInstanceOf(AppForbiddenError);
    expect(query).not.toHaveBeenCalled();
  });
  it.each(aiProviderFailureCodes)("recovers allowlisted %s metadata only for an exactly matching terminal failure", async (code) => {
    const providerFailure = { code, provider: "anthropic", ...(code === "AI_PROVIDER_RATE_LIMITED" ? { retryAt: "2026-09-05T13:00:00.000Z" } : {}) };
    const { pool, client, query } = db(row({ status: "failed", error_code: code, provider_failure: providerFailure }));
    for (const recovered of [await readAiRequestRecovery(pool, session, session.tripId, clientRequestId),
      await findAiRequestReplay(client, session, clientRequestId, "a".repeat(64))]) {
      expect(recovered?.request).toMatchObject({ status: "failed", errorCode: code, providerFailure, message: null, result: null });
    }
    const select = query.mock.calls.find(([sql]) => sql.includes("SELECT request.id,"))?.[0] ?? "";
    expect(select).toContain("failure.trip_id = request.trip_id AND failure.ai_request_id = request.id");
    expect(select).toContain("failure.payload->>'errorCode' = request.error_code");
    expect(select).toContain("request.status = 'failed' AND failure.event_type = 'request.failed'");
    expect(select).toContain("ORDER BY failure.sequence DESC LIMIT 1");
    expect(select).not.toContain("error_message");
    expect(query.mock.calls.every(([sql]) => !/^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(true);
  });
  it.each([
    undefined, null, "PRIVATE", [], {},
    { code: "PRIVATE_PROVIDER_FAILURE", provider: "anthropic" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "PRIVATE account" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "PRIVATE" },
    { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2026-09-05T13:00:00.000Z", secret: "PRIVATE" },
    { code: "AI_PROVIDER_UNAVAILABLE", provider: "anthropic" },
  ])("keeps legacy, malformed and code-mismatched failure metadata generic (%j)", async (provider_failure) => {
    const { pool } = db(row({ status: "failed", error_code: "AI_PROVIDER_RATE_LIMITED", provider_failure }));
    const result = await readAiRequestRecovery(pool, session, session.tripId);
    expect(result.request).toMatchObject({ status: "failed", errorCode: "AI_REQUEST_FAILED", message: null, result: null });
    expect(result.request).not.toHaveProperty("providerFailure");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it.each(["started", "succeeded", "unknown"])("never attaches terminal provider metadata to %s status", async (status) => {
    const { pool } = db(row({ status, error_code: "AI_PROVIDER_RATE_LIMITED", provider_failure: { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic" } }));
    const result = await readAiRequestRecovery(pool, session, session.tripId);
    expect(result.request).not.toHaveProperty("providerFailure");
    expect(result.request?.errorCode).not.toBe("AI_PROVIDER_RATE_LIMITED");
  });

  it.each(["started", "succeeded", "failed"])("replays an existing %s key without mutation", async (status) => {
    const { client, query } = db(row({ status }));
    expect((await findAiRequestReplay(client, session, clientRequestId, "a".repeat(64)))?.request?.requestId).toBe(id(5));
    expect(query.mock.calls.every(([sql]) => !/^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(true);
  });

  it("never admits a reused key for different content or an earlier reset conversation", async () => {
    await expect(findAiRequestReplay(db().client, session, clientRequestId, "b".repeat(64)))
      .rejects.toBeInstanceOf(AppConflictError);
    await expect(findAiRequestReplay(db(row({ recoverable: false })).client, session, clientRequestId, "a".repeat(64)))
      .rejects.toBeInstanceOf(AiRequestInterruptedError);
  });

  it("serializes per immutable user, with no trip-wide or role-wide exclusion", async () => {
    const { client, query } = db(null, { busy: true });
    await lockBoundUserAi(client, session.userId);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"),
      [JSON.stringify([session.userId, "ai-bound-user"])]);
    await expect(assertBoundUserAiIdle(client, session.userId)).rejects.toBeInstanceOf(AppConflictError);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE actor_user_id = $1"), [session.userId, 10, 2]);
    const admission = query.mock.calls.find(([sql]) => sql.includes("WHERE actor_user_id = $1"))?.[0] ?? "";
    expect(admission).toContain("feature = 'planning' AND created_at");
    expect(admission).toContain("feature = 'calendar_location' AND created_at");
  });

  it("fences expired/reset/rebound/non-running work before any write", async () => {
    const { client, query } = db(null);
    await expect(assertAiRequestWritable(client, session, id(5), id(7))).rejects.toBeInstanceOf(AiRequestInterruptedError);
    const fence = query.mock.calls.find(([sql]) => sql.includes("FOR UPDATE OF request"))?.[0] ?? "";
    expect(fence).toContain("request.status = 'started'");
    expect(fence).toContain("member.user_id = $4 AND member.status = 'active'");
    expect(fence).toContain("conversation.closed_at IS NULL");
    expect(fence).toContain("make_interval(mins => $6::integer)");
  });
});
