import { createHash } from "node:crypto";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { AppConflictError, assertTrip, inTransaction } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { ACTIVE_REQUEST_WINDOW_MINUTES, CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES, lockBoundUserAi, lockActiveAiMember, supportsAiConversationHistory } from "@/lib/ai/conversation";
import type { AiPlannerResult, AiRecoveredRequest, AiRequestRecoveryResponse } from "@/lib/ai/request-recovery-types";
import { parseAiProviderFailureDetails } from "@/lib/ai/provider-failure";

type Queryable = Pick<PoolClient, "query">;
export type AiRequestRecoveryRow = {
  id: string;
  client_request_id: string | null;
  conversation_id: string | null;
  status: string;
  created_at: Date | string;
  completed_at: Date | string | null;
  result_text: string | null;
  response_json: AiPlannerResult | null;
  error_code: string | null;
  expired: boolean;
  recoverable: boolean;
  request_payload_hash?: string | null;
  provider_failure?: unknown;
};

const nonnegative = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Historical receipts may include retired preference metadata. Validate and
// discard those fields without reviving any preference store or write path.
const safeResponse = z.strictObject({
  requestId: z.uuid(), message: z.string().max(16_000), proposalIds: z.array(z.uuid()).max(20),
  proposalCount: nonnegative.max(20), proposalId: z.uuid().nullable(),
  changeStatus: z.enum(["approved", "pending"]).nullable(), entityId: z.uuid().nullable(),
  model: z.string().max(160), usedToday: nonnegative, remainingToday: nonnegative.nullable(),
  webSearch: z.strictObject({
    performed: z.boolean(), queryCount: nonnegative,
    sources: z.array(z.url().refine((url) => /^https?:\/\//u.test(url))).max(20),
  }),
  memory: z.strictObject({
    previousTurnsUsed: nonnegative, tokenEstimate: nonnegative, tokenBudget: nonnegative,
    checkpointVersion: nonnegative.nullable(), personalMemoriesUsed: nonnegative.optional(), truncated: z.boolean(),
  }),
  preferenceChanges: z.array(z.strictObject({ id: z.uuid(), action: z.enum(["created", "updated", "confirmed", "forgotten", "suggested"]), subject: z.string().max(240) })).max(10).optional(),
}).transform(({ preferenceChanges: _legacyChanges, memory, ...response }) => {
  const { personalMemoriesUsed: _legacyCount, ...continuity } = memory;
  void _legacyChanges;
  void _legacyCount;
  return { ...response, memory: continuity };
});

export class AiRequestInterruptedError extends AppConflictError {
  constructor() {
    super("This AI request is no longer active. Check its result before submitting a new request.");
    this.name = "AiRequestInterruptedError";
  }
}

export function aiRequestPayloadHash(prompt: string, requestedModel: string | undefined, locale: string, conversationId?: string | null, imageHashes: readonly string[] = []): string {
  return createHash("sha256").update(JSON.stringify([
    prompt, requestedModel ?? null, locale, ...(conversationId !== undefined ? [conversationId] : []),
    ...(imageHashes.length ? [imageHashes] : []),
  ])).digest("hex");
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function safeFailureCode(code: string | null): string {
  if (code === "AI_IMAGE_EXTRACTION_FAILED") return code;
  if (code === "AI_REQUEST_TIMEOUT" || code === "AbortError" || code === "TimeoutError") return "AI_REQUEST_TIMEOUT";
  if (code === "AI_SEARCH_EVIDENCE_MISSING") return code;
  if (code === "ZodError") return "AI_PROPOSAL_VALIDATION_FAILED";
  return "AI_REQUEST_FAILED";
}

export function projectAiRecoveredRequest(row: AiRequestRecoveryRow): AiRecoveredRequest {
  const status = row.error_code === "AiRequestInterruptedError" ? "interrupted" : row.status === "started"
    ? row.expired ? "interrupted" : "running"
    : row.status === "succeeded" ? "succeeded" : "failed";
  const parsed = status === "succeeded" ? safeResponse.safeParse(row.response_json) : null;
  const failure = status === "failed" && row.status === "failed" ? parseAiProviderFailureDetails(row.provider_failure) : null;
  const providerFailure = failure?.code === row.error_code ? failure : null;
  return {
    requestId: row.id,
    clientRequestId: row.client_request_id,
    conversationId: row.conversation_id,
    status,
    createdAt: iso(row.created_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    errorCode: status === "interrupted" ? "AI_REQUEST_INTERRUPTED" : status === "failed" ? providerFailure?.code ?? safeFailureCode(row.error_code) : null,
    message: status === "succeeded" ? row.result_text : null,
    result: parsed?.success && parsed.data.requestId === row.id ? parsed.data : null,
    ...(providerFailure ? { providerFailure } : {}),
  };
}

// Used only inside an already self-authorized ai_requests selection. Project
// one bounded field, not raw provider diagnostics or another request's events.
// A newer inconsistent failure cannot resurrect metadata from an older event.
export const aiProviderFailureSelectSql = `(SELECT CASE WHEN failure.payload->>'errorCode' = request.error_code
    THEN failure.payload->'providerFailure' ELSE NULL END
  FROM ai_request_events failure
  WHERE failure.trip_id = request.trip_id AND failure.ai_request_id = request.id
    AND request.status = 'failed' AND failure.event_type = 'request.failed'
  ORDER BY failure.sequence DESC LIMIT 1)`;

// Null-conversation deterministic replies belong to the current era only: a
// subsequent explicit reset must not redisplay them as a new conversation.
const recoverableSql = `(
  (request.conversation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM ai_conversations conversation
     WHERE conversation.trip_id = request.trip_id AND conversation.id = request.conversation_id
       AND conversation.actor_member_id = request.actor_member_id
       AND conversation.actor_user_id = request.actor_user_id AND conversation.closed_at IS NULL
       AND COALESCE(to_jsonb(conversation)->>'purpose','trip') = 'trip'
  )) OR (request.conversation_id IS NULL AND request.feature = 'off_topic' AND NOT EXISTS (
    SELECT 1 FROM ai_conversations conversation
     WHERE conversation.trip_id = request.trip_id AND conversation.actor_member_id = request.actor_member_id
       AND conversation.actor_user_id = request.actor_user_id AND conversation.created_at > request.created_at
  ))
)`;

/** Must run under the bound-user admission lock, before quota/policy checks. */
export async function findAiRequestReplay(
  client: Queryable,
  session: AuthenticatedSession,
  clientRequestId: string,
  payloadHash: string,
): Promise<AiRequestRecoveryResponse | null> {
  await lockActiveAiMember(client, session);
  const existing = await client.query<AiRequestRecoveryRow>(
    `SELECT request.id, request.client_request_id, request.conversation_id, request.status,
            request.created_at, request.completed_at, request.result_text, request.response_json,
            request.request_payload_hash, request.error_code,
            ${aiProviderFailureSelectSql} AS provider_failure,
            request.created_at <= CURRENT_TIMESTAMP - make_interval(mins => $5::integer) AS expired,
            ${recoverableSql} AS recoverable
       FROM ai_requests request
      WHERE request.trip_id = $1 AND request.actor_user_id = $2
        AND request.client_request_id = $3 AND request.actor_member_id = $4`,
    [session.tripId, session.userId, clientRequestId, session.memberId, ACTIVE_REQUEST_WINDOW_MINUTES],
  );
  const row = existing.rows[0];
  if (!row) return null;
  if (row.request_payload_hash !== payloadHash) {
    throw new AppConflictError("This request identifier was already used for a different AI submission.");
  }
  if (!row.recoverable) throw new AiRequestInterruptedError();
  return { request: projectAiRecoveredRequest(row), busyElsewhere: false,
    activeConversationId: row.conversation_id ?? await readActiveConversationId(client, session) };
}

export async function readAiRequestRecovery(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
  clientRequestId?: string,
): Promise<AiRequestRecoveryResponse> {
  assertTrip(session, tripId);
  return inTransaction(pool, async (client) => {
  await lockActiveAiMember(client, session);
  const result = await client.query<AiRequestRecoveryRow>(
    `SELECT request.id, request.client_request_id, request.conversation_id, request.status,
            request.created_at, request.completed_at, request.result_text, request.response_json, request.error_code,
            ${aiProviderFailureSelectSql} AS provider_failure,
            request.created_at <= CURRENT_TIMESTAMP - make_interval(mins => $5::integer) AS expired,
            true AS recoverable
       FROM ai_requests request
       JOIN trip_members member ON member.trip_id = request.trip_id AND member.id = request.actor_member_id
      WHERE request.trip_id = $1 AND request.actor_member_id = $2 AND request.actor_user_id = $3
        AND member.user_id = $3 AND member.status = 'active'
        AND request.feature IN ('planning', 'off_topic')
        AND ($4::uuid IS NULL OR request.client_request_id = $4)
        AND ${recoverableSql}
      ORDER BY request.created_at DESC, request.id DESC LIMIT 1`,
    [tripId, session.memberId, session.userId, clientRequestId ?? null, ACTIVE_REQUEST_WINDOW_MINUTES],
  );
  const elsewhere = await client.query<{ busy: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ai_requests
      WHERE actor_user_id = $1 AND trip_id <> $2 AND status = 'started'
        AND ((feature = 'planning' AND created_at > CURRENT_TIMESTAMP - make_interval(mins => $3::integer))
          OR (feature = 'calendar_location' AND created_at > CURRENT_TIMESTAMP - make_interval(mins => $4::integer)))) AS busy`,
    [session.userId, tripId, ACTIVE_REQUEST_WINDOW_MINUTES, CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES],
  );
  return { request: result.rows[0] ? projectAiRecoveredRequest(result.rows[0]) : null,
    busyElsewhere: elsewhere.rows[0]?.busy === true, activeConversationId: await readActiveConversationId(client, session) };
  });
}

async function readActiveConversationId(client: Queryable, session: AuthenticatedSession): Promise<string | null> {
  const historyEnabled = await supportsAiConversationHistory(client);
  const active = await client.query<{ id: string }>(
    `SELECT conversation.id FROM ai_conversations conversation
       JOIN trip_members member ON member.trip_id = conversation.trip_id AND member.id = conversation.actor_member_id
      WHERE conversation.trip_id = $1 AND conversation.actor_member_id = $2 AND conversation.actor_user_id = $3
        AND member.user_id = $3 AND member.status = 'active' AND conversation.closed_at IS NULL
        AND COALESCE(to_jsonb(conversation)->>'purpose','trip') = 'trip'
        ${historyEnabled ? "AND conversation.history_revoked_at IS NULL AND conversation.closed_reason IS NULL" : ""}`,
    [session.tripId, session.memberId, session.userId],
  );
  return active.rows[0]?.id ?? null;
}

/** Fence all canonical/proposal writes and completion in the same transaction. */
export async function assertAiRequestWritable(
  client: Queryable,
  session: AuthenticatedSession,
  requestId: string,
  conversationId: string,
): Promise<void> {
  await lockCurrentTripActor(client, session);
  await lockBoundUserAi(client, session.userId);
  const current = await client.query(
    `SELECT request.id FROM ai_requests request
       JOIN trip_members member ON member.trip_id = request.trip_id AND member.id = request.actor_member_id
       JOIN ai_conversations conversation ON conversation.trip_id = request.trip_id AND conversation.id = request.conversation_id
      WHERE request.trip_id = $1 AND request.id = $2 AND request.actor_member_id = $3
        AND request.actor_user_id = $4 AND request.conversation_id = $5
        AND request.status = 'started' AND request.feature = 'planning'
        AND request.created_at > CURRENT_TIMESTAMP - make_interval(mins => $6::integer)
        AND member.user_id = $4 AND member.status = 'active'
        AND conversation.actor_member_id = $3 AND conversation.actor_user_id = $4 AND conversation.closed_at IS NULL
        AND COALESCE(to_jsonb(conversation)->>'purpose','trip') = 'trip'
      FOR UPDATE OF request, member, conversation`,
    [session.tripId, requestId, session.memberId, session.userId, conversationId, ACTIVE_REQUEST_WINDOW_MINUTES],
  );
  if (current.rows.length !== 1) throw new AiRequestInterruptedError();
}
