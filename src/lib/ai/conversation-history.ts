import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { AppInvalidInputError, AppNotFoundError, assertTrip, inTransaction } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { ACTIVE_REQUEST_WINDOW_MINUTES, lockActiveAiMember, supportsAiConversationHistory } from "@/lib/ai/conversation";
import { aiProviderFailureSelectSql, projectAiRecoveredRequest, type AiRequestRecoveryRow } from "@/lib/ai/request-recovery";
import type { AiConversationSummary, AiConversationListResponse, AiConversationMessagesResponse } from "@/lib/ai/conversation-history-types";
import type { AiImageSummary } from "@/lib/ai/image-types";

export { resumeAiConversation } from "@/lib/ai/conversation";
export const AI_CONVERSATION_PAGE_SIZE = 20;

type ConversationRow = {
  id: string;
  created_at: string;
  last_used_at: Date | string;
  closed_at: Date | string | null;
  first_prompt: string | null;
  purpose?: "trip" | "preferences";
};
type MessageRow = AiRequestRecoveryRow & { prompt_text: string; requested_model: string; created_cursor: string };

const cursorSchema = z.strictObject({
  version: z.literal(1), kind: z.enum(["conversations", "messages"]),
  tripId: z.uuid(), memberId: z.uuid(), userId: z.uuid(), conversationId: z.uuid().nullable(),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u), id: z.uuid(),
});
type Cursor = z.infer<typeof cursorSchema>;

function parseCursor(value: string | undefined, session: AuthenticatedSession, conversationId: string | null): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 2048 || !/^[a-zA-Z0-9_-]+$/u.test(value)) throw new Error();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error();
    const parsed = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    const instant = new Date(parsed.createdAt);
    if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== parsed.createdAt.slice(0, 23) + "Z"
      || parsed.tripId !== session.tripId || parsed.memberId !== session.memberId || parsed.userId !== session.userId
      || parsed.conversationId !== conversationId || parsed.kind !== (conversationId ? "messages" : "conversations")) throw new Error();
    return parsed;
  } catch { throw new AppInvalidInputError("The AI history cursor is invalid for this conversation."); }
}

function nextCursor(session: AuthenticatedSession, conversationId: string | null, createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ version: 1, kind: conversationId ? "messages" : "conversations",
    tripId: session.tripId, memberId: session.memberId, userId: session.userId, conversationId, createdAt, id }), "utf8").toString("base64url");
}

function summary(row: ConversationRow): AiConversationSummary {
  return { conversationId: row.id, title: (row.first_prompt ?? "").trim().slice(0, 100),
    createdAt: row.created_at, lastUsedAt: new Date(row.last_used_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    isActive: row.closed_at === null && row.purpose !== "preferences",
    canResume: row.closed_at !== null && row.purpose !== "preferences",
    ...(row.purpose === "preferences" ? { purpose: row.purpose } : {}) };
}

const visibleConversationSql = `conversation.trip_id = $1 AND conversation.actor_member_id = $2 AND conversation.actor_user_id = $3
  AND conversation.history_revoked_at IS NULL
  AND (conversation.closed_at IS NULL OR conversation.closed_reason IN ('user_reset','user_switch'))`;

const conversationSelect = `SELECT conversation.id, COALESCE(to_jsonb(conversation)->>'purpose','trip') AS purpose,
  to_char(conversation.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  conversation.last_used_at, conversation.closed_at,
  (SELECT request.prompt_text FROM ai_requests request
    WHERE request.trip_id = conversation.trip_id AND request.conversation_id = conversation.id
      AND request.actor_member_id = conversation.actor_member_id AND request.actor_user_id = conversation.actor_user_id
      AND request.feature IN ('planning','off_topic')
    ORDER BY request.created_at, request.id LIMIT 1) AS first_prompt
  FROM ai_conversations conversation`;

async function historyReader<T>(pool: Pool, session: AuthenticatedSession, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool, async (client) => {
    // Keep identity revocation from changing the binding midway through a page.
    await lockActiveAiMember(client, session);
    if (!await supportsAiConversationHistory(client)) throw new AppNotFoundError("AI conversation history is not available yet.");
    return work(client);
  });
}

export async function listAiConversations(
  pool: Pool, session: AuthenticatedSession, tripId: string, cursor?: string,
): Promise<AiConversationListResponse> {
  assertTrip(session, tripId);
  const position = parseCursor(cursor, session, null);
  return historyReader(pool, session, async (client) => {
    const rows = await client.query<ConversationRow>(
      `${conversationSelect} WHERE ${visibleConversationSql}
        AND ($4::timestamptz IS NULL OR (conversation.created_at, conversation.id) < ($4::timestamptz,$5::uuid))
      ORDER BY conversation.created_at DESC, conversation.id DESC LIMIT $6`,
      [tripId, session.memberId, session.userId, position?.createdAt ?? null, position?.id ?? null, AI_CONVERSATION_PAGE_SIZE + 1],
    );
    const active = await client.query<{ id: string }>(
      `SELECT conversation.id FROM ai_conversations conversation
        WHERE ${visibleConversationSql} AND conversation.closed_at IS NULL
          AND COALESCE(to_jsonb(conversation)->>'purpose','trip') = 'trip'`,
      [tripId, session.memberId, session.userId],
    );
    const page = rows.rows.slice(0, AI_CONVERSATION_PAGE_SIZE);
    const last = page.at(-1);
    return { conversations: page.map(summary), activeConversationId: active.rows[0]?.id ?? null,
      nextCursor: rows.rows.length > AI_CONVERSATION_PAGE_SIZE && last ? nextCursor(session, null, last.created_at, last.id) : null };
  });
}

export async function listAiConversationMessages(
  pool: Pool, session: AuthenticatedSession, tripId: string, conversationId: string, cursor?: string,
): Promise<AiConversationMessagesResponse> {
  assertTrip(session, tripId);
  if (!z.uuid().safeParse(conversationId).success) throw new AppInvalidInputError("The AI conversation identifier is invalid.");
  const position = parseCursor(cursor, session, conversationId);
  return historyReader(pool, session, async (client) => {
    const conversation = await client.query<ConversationRow>(
      `${conversationSelect} WHERE ${visibleConversationSql} AND conversation.id = $4 FOR SHARE OF conversation`,
      [tripId, session.memberId, session.userId, conversationId],
    );
    if (!conversation.rows[0]) throw new AppNotFoundError("AI conversation not found.");
    const rows = await client.query<MessageRow>(
      `SELECT request.id, request.client_request_id, request.conversation_id, request.status,
              request.created_at, request.completed_at, request.prompt_text, request.result_text, request.requested_model,
              request.response_json, request.error_code,
              ${aiProviderFailureSelectSql} AS provider_failure,
              to_char(request.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_cursor,
              request.created_at <= CURRENT_TIMESTAMP - make_interval(mins => $7::integer) AS expired,
              true AS recoverable
         FROM ai_requests request
        WHERE request.trip_id = $1 AND request.actor_member_id = $2 AND request.actor_user_id = $3
          AND request.conversation_id = $4 AND request.feature IN ('planning','off_topic')
          AND ($5::timestamptz IS NULL OR (request.created_at, request.id) < ($5::timestamptz,$6::uuid))
        ORDER BY request.created_at DESC, request.id DESC LIMIT $8`,
      [tripId, session.memberId, session.userId, conversationId, position?.createdAt ?? null, position?.id ?? null,
        ACTIVE_REQUEST_WINDOW_MINUTES, AI_CONVERSATION_PAGE_SIZE + 1],
    );
    const page = rows.rows.slice(0, AI_CONVERSATION_PAGE_SIZE);
    const last = page.at(-1);
    const imagesByRequest = new Map<string, AiImageSummary[]>();
    const imageCapability = await client.query<{ enabled: boolean }>(
      `SELECT to_regclass('ai_request_images') IS NOT NULL AS enabled`,
    );
    if (imageCapability.rows[0]?.enabled && page.length) {
      const images = await client.query<AiImageSummary & { ai_request_id: string }>(
        `SELECT id, ai_request_id, width, height FROM ai_request_images
          WHERE trip_id = $1 AND ai_request_id = ANY($2::uuid[]) ORDER BY ai_request_id, ordinal`,
        [tripId, page.map((row) => row.id)],
      );
      for (const image of images.rows) {
        const summaries = imagesByRequest.get(image.ai_request_id) ?? [];
        summaries.push({ id: image.id, width: image.width, height: image.height });
        imagesByRequest.set(image.ai_request_id, summaries);
      }
    }
    return { conversation: summary(conversation.rows[0]),
      messages: [...page].reverse().map((row) => ({ ...projectAiRecoveredRequest(row), createdAt: row.created_cursor,
        prompt: row.prompt_text, model: row.requested_model,
        ...(imagesByRequest.has(row.id) ? { images: imagesByRequest.get(row.id)! } : {}) })),
      nextCursor: rows.rows.length > AI_CONVERSATION_PAGE_SIZE && last ? nextCursor(session, conversationId, last.created_cursor, last.id) : null };
  });
}
