import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppForbiddenError, AppInvalidInputError, AppNotFoundError } from "@/lib/app/repository";
import { listAiConversations, listAiConversationMessages } from "@/lib/ai/conversation-history";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = { tripId: id(1), memberId: id(2), userId: id(3), role: "owner" } as AuthenticatedSession;
const conversationId = id(4);
const conversation = (n: number) => ({ id: id(n), created_at: `2026-09-05T12:00:00.${String(n).padStart(6, "0")}Z`,
  last_used_at: "2026-09-05T12:00:01Z", closed_at: n === 4 ? null : "2026-09-05T12:00:02Z", first_prompt: "Private dinner plan" });
const message = (n: number) => ({ id: id(n), client_request_id: null, conversation_id: conversationId, status: "succeeded",
  created_at: new Date("2026-09-05T12:00:00.000Z"), completed_at: "2026-09-05T12:00:01Z",
  created_cursor: `2026-09-05T12:00:00.${String(n).padStart(6, "0")}Z`,
  prompt_text: `Private prompt ${n}`, result_text: `Safe reply ${n}`, requested_model: "gpt-6.1-sol",
  response_json: null, error_code: null as string | null, expired: false, recoverable: true, provider_failure: undefined as unknown });

function database(options: { bound?: boolean; enabled?: boolean; target?: boolean; conversations?: ReturnType<typeof conversation>[];
  messages?: ReturnType<typeof message>[]; images?: Array<{ id: string; ai_request_id: string; width: number; height: number }> } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT 1 FROM trip_members")) return { rows: options.bound === false ? [] : [{}] };
    if (sql.includes("FROM pg_attribute")) return { rows: [{ enabled: options.enabled !== false }] };
    if (sql.includes("to_regclass('ai_request_images')")) return { rows: [{ enabled: options.images !== undefined }] };
    if (sql.includes("FROM ai_request_images")) return { rows: options.images ?? [] };
    if (sql.includes("FOR SHARE OF conversation")) return { rows: options.target === false ? [] : [conversation(4)] };
    if (sql.includes("first_prompt")) return { rows: options.conversations ?? [conversation(4)] };
    if (sql.includes("SELECT conversation.id")) return { rows: [{ id: conversationId }] };
    if (sql.includes("request.created_at, request.completed_at")) return { rows: options.messages ?? [message(10)] };
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, query, release };
}

describe("private AI conversation history", () => {
  it("keeps archived preference conversations visible as permanently read-only history", async () => {
    const legacy = { ...conversation(5), purpose: "preferences" as const };
    const { pool } = database({ conversations: [legacy] });
    const result = await listAiConversations(pool, session, session.tripId);
    expect(result.conversations).toEqual([expect.objectContaining({
      conversationId: legacy.id, purpose: "preferences", canResume: false, isActive: false,
    })]);
  });

  it("projects only attachment summaries on the already authorized page and leaves original prompts untouched", async () => {
    const image = { id: id(90), ai_request_id: id(10), width: 100, height: 200 };
    const { pool, query } = database({ images: [image] });
    const page = await listAiConversationMessages(pool, session, session.tripId, conversationId);
    expect(page.messages[0]).toMatchObject({ prompt: "Private prompt 10", images: [{ id: id(90), width: 100, height: 200 }] });
    const imageQuery = query.mock.calls.find(([sql]) => sql.includes("FROM ai_request_images"))![0];
    expect(imageQuery).toContain("ai_request_id = ANY");
    expect(imageQuery).not.toContain("image_data");
    expect(JSON.stringify(page)).not.toContain("image_context_text");
  });

  it("lists only current bound identity archives and preserves microsecond ordering keys", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => conversation(40 - index));
    const { pool, query, release } = database({ conversations: rows });
    const page = await listAiConversations(pool, session, session.tripId);
    expect(page.conversations).toHaveLength(20);
    expect(page.activeConversationId).toBe(conversationId);
    expect(page.conversations[0].createdAt).toBe(rows[0].created_at);
    expect(page.nextCursor).toBeTruthy();
    await listAiConversations(pool, session, session.tripId, page.nextCursor!);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY conversation.created_at DESC"),
      [session.tripId, session.memberId, session.userId, rows[19].created_at, rows[19].id, 21]);
    const select = query.mock.calls.find(([sql]) => sql.includes("first_prompt"))![0];
    expect(select).toContain("conversation.history_revoked_at IS NULL");
    expect(select).toContain("closed_reason IN ('user_reset','user_switch')");
    expect(select).toContain("conversation.actor_user_id = $3");
    expect(select).not.toContain("role = 'owner'");
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("returns each newest message page chronologically without losing microseconds or leaking diagnostics", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => message(50 - index));
    rows[0].status = "failed";
    rows[0].error_code = "private-provider-failure" as never;
    const { pool, query } = database({ messages: rows });
    const page = await listAiConversationMessages(pool, session, session.tripId, conversationId);
    expect(page.messages).toHaveLength(20);
    expect(page.messages[0].requestId).toBe(rows[19].id);
    expect(page.messages[0].createdAt).toBe(rows[19].created_cursor);
    expect(page.messages.at(-1)).toMatchObject({ status: "failed", errorCode: "AI_REQUEST_FAILED", message: null });
    expect(JSON.stringify(page)).not.toContain("private-provider-failure");
    await listAiConversationMessages(pool, session, session.tripId, conversationId, page.nextCursor!);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY request.created_at DESC"),
      [session.tripId, session.memberId, session.userId, conversationId, rows[19].created_cursor, rows[19].id, 10, 21]);
    expect(query.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT|DELETE)\b/u.test(sql))).toBe(false);
  });

  it("binds cursors to their identity, trip, conversation and endpoint without querying on invalid input", async () => {
    const { pool, query } = database({ conversations: Array.from({ length: 21 }, (_, i) => conversation(40 - i)) });
    const page = await listAiConversations(pool, session, session.tripId);
    query.mockClear();
    await expect(listAiConversations(pool, { ...session, userId: id(99) }, session.tripId, page.nextCursor!)).rejects.toBeInstanceOf(AppInvalidInputError);
    await expect(listAiConversationMessages(pool, session, session.tripId, conversationId, page.nextCursor!)).rejects.toBeInstanceOf(AppInvalidInputError);
    await expect(listAiConversations(pool, session, session.tripId, "not+a+cursor")).rejects.toBeInstanceOf(AppInvalidInputError);
    expect(query).not.toHaveBeenCalled();
  });
  it("includes only safe matching failure metadata from the authorized message page", async () => {
    const failure = { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2026-09-05T13:00:00.000Z" };
    const { pool, query } = database({ messages: [
      { ...message(12), status: "failed", error_code: failure.code, provider_failure: failure },
      { ...message(11), status: "failed", error_code: failure.code, provider_failure: { ...failure, diagnostic: "PRIVATE provider body" } },
      { ...message(10), provider_failure: failure },
    ] });
    const page = await listAiConversationMessages(pool, session, session.tripId, conversationId);
    expect(page.messages[2]).toMatchObject({ status: "failed", errorCode: failure.code, providerFailure: failure, message: null, result: null });
    expect(page.messages[1]).toMatchObject({ status: "failed", errorCode: "AI_REQUEST_FAILED" });
    expect(page.messages[1]).not.toHaveProperty("providerFailure"); expect(page.messages[0]).not.toHaveProperty("providerFailure");
    expect(JSON.stringify(page)).not.toContain("PRIVATE provider");
    const select = query.mock.calls.find(([sql]) => sql.includes("request.created_at, request.completed_at"))?.[0] ?? "";
    expect(select).toContain("failure.trip_id = request.trip_id AND failure.ai_request_id = request.id");
    expect(select).toContain("failure.payload->>'errorCode' = request.error_code");
    expect(select).toContain("request.actor_member_id = $2 AND request.actor_user_id = $3");
    expect(query.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT|DELETE)\b/u.test(sql))).toBe(false);
  });

  it("fails closed for another trip, stale/rebound membership, revoked archives and absent migration", async () => {
    const db = database({ bound: false });
    await expect(listAiConversations(db.pool, session, id(99))).rejects.toBeInstanceOf(AppForbiddenError);
    expect(db.query).not.toHaveBeenCalled();
    await expect(listAiConversations(db.pool, session, session.tripId)).rejects.toBeInstanceOf(AppForbiddenError);
    const revoked = database({ target: false });
    await expect(listAiConversationMessages(revoked.pool, session, session.tripId, conversationId)).rejects.toBeInstanceOf(AppNotFoundError);
    expect(revoked.query.mock.calls.some(([sql]) => sql.includes("ORDER BY request.created_at DESC"))).toBe(false);
    await expect(listAiConversations(database({ enabled: false }).pool, session, session.tripId)).rejects.toBeInstanceOf(AppNotFoundError);
  });
});
