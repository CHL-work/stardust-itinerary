import { randomUUID } from "node:crypto";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { Pool, PoolClient } from "pg";

import { AppConflictError, AppForbiddenError, AppNotFoundError } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import type { AiConversationPurpose } from "@/lib/app/types";
import { withAiImageFacts } from "@/lib/ai/image-context";

export const RECENT_CONVERSATION_TOKEN_BUDGET = 6_000;
const MAX_TURN_FIELD_TOKENS = 3_000;
const MAX_HISTORY_SCAN_ROWS = 200;
export const ACTIVE_REQUEST_WINDOW_MINUTES = 10;
export const CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES = 2;

export class AiConversationBusyError extends AppConflictError {
  constructor(message = "Another AI request is already being processed for this conversation.") {
    super(message);
    this.name = "AiConversationBusyError";
  }
}

/** Shared by admission, reset and completion; memory remains trip-specific. */
export async function lockBoundUserAi(client: Pick<PoolClient, "query">, userId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    JSON.stringify([userId, "ai-bound-user"]),
  ]);
}

export async function assertBoundUserAiIdle(client: Pick<PoolClient, "query">, userId: string): Promise<void> {
  const current = await client.query<{ busy: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ai_requests
      WHERE actor_user_id = $1 AND status = 'started'
        AND ((feature = 'planning' AND created_at > CURRENT_TIMESTAMP - make_interval(mins => $2::integer))
          OR (feature = 'calendar_location' AND created_at > CURRENT_TIMESTAMP - make_interval(mins => $3::integer)))) AS busy`,
    [userId, ACTIVE_REQUEST_WINDOW_MINUTES, CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES],
  );
  if (current.rows[0]?.busy) throw new AiConversationBusyError();
}

export async function supportsAiConversationHistory(client: Pick<PoolClient, "query">): Promise<boolean> {
  const result = await client.query<{ enabled: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('ai_conversations') AND attname = 'history_revoked_at' AND NOT attisdropped) AS enabled`,
  );
  return result.rows[0]?.enabled === true;
}

export class AiConversationChangedError extends AppConflictError {
  constructor() {
    super("The active AI conversation changed. Select the conversation again before sending.");
    this.name = "AiConversationChangedError";
  }
}

export async function lockActiveAiMember(client: Pick<PoolClient, "query">, session: AuthenticatedSession): Promise<void> {
  const binding = await client.query(
    `SELECT 1 FROM trip_members
      WHERE trip_id = $1 AND id = $2 AND user_id = $3 AND status = 'active'
      FOR UPDATE`,
    [session.tripId, session.memberId, session.userId],
  );
  if (binding.rows.length !== 1) throw new AppForbiddenError("This trip is not available to the current member.");
}

/** Explicit null means first use, not permission to select whichever chat is now active. */
export async function selectAiConversationForSubmission(
  client: PoolClient, session: AuthenticatedSession, expectedConversationId: string | null,
): Promise<string> {
  await lockActiveAiMember(client, session);
  await lockMemberConversation(client, session.tripId, session.memberId);
  if (!await supportsAiConversationHistory(client)) throw new AppConflictError("AI conversation history is not configured yet.");
  const current = await client.query<{ id: string; actor_user_id: string; purpose?: AiConversationPurpose }>(
    `SELECT id, actor_user_id, COALESCE(to_jsonb(ai_conversations)->>'purpose','trip') AS purpose FROM ai_conversations
      WHERE trip_id = $1 AND actor_member_id = $2 AND closed_at IS NULL
        AND history_revoked_at IS NULL AND closed_reason IS NULL FOR UPDATE`,
    [session.tripId, session.memberId],
  );
  const active = current.rows[0];
  if (active?.purpose === "preferences") throw new AppConflictError("Legacy preference conversations are read-only. Start a new conversation.");
  if ((active?.id ?? null) !== expectedConversationId || (active && active.actor_user_id !== session.userId)) {
    throw new AiConversationChangedError();
  }
  return active?.id ?? await createConversation(client, session, "first_use");
}

export type AiConversationTurn = {
  requestId?: string;
  user: string;
  assistant: string;
  completedAt: string;
  tokenEstimate?: number;
};

export type AiConversationCheckpoint = {
  id: string;
  version: number;
  throughRequestId: string;
  throughCompletedAt: string;
  summaryText: string;
  summary: {
    goals: string[];
    decisions: string[];
    openQuestions: string[];
  };
  tokenEstimate: number;
};

export type PreparedAiConversation = {
  conversationId: string;
  turns: AiConversationTurn[];
  tokenEstimate: number;
  truncated: boolean;
  checkpoint: AiConversationCheckpoint | null;
  checkpointThrough: { requestId: string; completedAt: string } | null;
};

type ConversationRow = {
  id: string;
  actor_user_id: string;
  purpose?: AiConversationPurpose;
};

export type AiConversationMemoryRow = {
  id: string;
  prompt_text: string;
  image_context_text?: string | null;
  result_text: string;
  completed_at: Date | string;
  completed_cursor?: string;
  available_turns: number;
};

type CheckpointRow = {
  id: string;
  version: number;
  through_request_id: string;
  through_completed_at: Date | string;
  summary_text: string;
  summary_json: { goals?: unknown; decisions?: unknown; openQuestions?: unknown };
  token_estimate: number;
};

type ConversationAuditCause = "first_use" | "identity_mismatch" | "identity_unbound" | "owner_recovery" | "user_reset" | "user_switch";

async function lockMemberConversation(
  client: Pick<PoolClient, "query">,
  tripId: string,
  memberId: string,
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    JSON.stringify([tripId, memberId, "ai-member"]),
  ]);
}

async function appendConversationAudit(
  client: Pick<PoolClient, "query">,
  input: {
    tripId: string;
    conversationId: string;
    actorMemberId: string | null;
    action: "created" | "closed" | "reset" | "resumed";
    cause: ConversationAuditCause;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (
       trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
     ) VALUES ($1,$2,$3,'ai_conversation',$4,$5,$6::jsonb)`,
    [
      input.tripId,
      randomUUID(),
      input.actorMemberId,
      input.conversationId,
      input.action,
      JSON.stringify({ cause: input.cause }),
    ],
  );
}

async function createConversation(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  cause: Extract<ConversationAuditCause, "first_use" | "identity_mismatch" | "user_reset">,
): Promise<string> {
  const conversationId = randomUUID();
  await client.query(
    `INSERT INTO ai_conversations (
       trip_id, id, actor_member_id, actor_user_id
     ) VALUES ($1,$2,$3,$4)`,
    [session.tripId, conversationId, session.memberId, session.userId],
  );
  await appendConversationAudit(client, {
    tripId: session.tripId,
    conversationId,
    actorMemberId: session.memberId,
    action: "created",
    cause,
  });
  return conversationId;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function estimateTextTokens(value: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4) + nonAscii);
}

function truncateToTokenBudget(value: string, budget: number): { value: string; truncated: boolean } {
  if (estimateTextTokens(value) <= budget) return { value, truncated: false };
  let used = 0;
  let output = "";
  for (const character of value) {
    const next = character.codePointAt(0)! <= 0x7f ? 0.25 : 1;
    if (Math.ceil(used + next) > budget) break;
    output += character;
    used += next;
  }
  return { value: output, truncated: true };
}

export function buildTokenBudgetedConversationTurns(
  rows: AiConversationMemoryRow[],
  tokenBudget = RECENT_CONVERSATION_TOKEN_BUDGET,
): Pick<PreparedAiConversation, "turns" | "tokenEstimate" | "truncated" | "checkpointThrough"> {
  const newestFirst: AiConversationTurn[] = [];
  let tokenEstimate = 0;
  let truncated = Number(rows[0]?.available_turns ?? rows.length) > rows.length;

  for (const row of rows) {
    const remaining = tokenBudget - tokenEstimate;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const userBounded = truncateToTokenBudget(withAiImageFacts(row.prompt_text, row.image_context_text), MAX_TURN_FIELD_TOKENS);
    const assistantBounded = truncateToTokenBudget(row.result_text, MAX_TURN_FIELD_TOKENS);
    const fullPairTokens = estimateTextTokens(userBounded.value) + estimateTextTokens(assistantBounded.value);
    if (newestFirst.length > 0 && fullPairTokens > remaining) {
      truncated = true;
      break;
    }
    let user = userBounded.value;
    let assistant = assistantBounded.value;
    if (fullPairTokens > remaining) {
      const userBudget = Math.max(1, Math.min(remaining - 1, Math.ceil(remaining / 2)));
      const assistantBudget = Math.max(1, remaining - userBudget);
      user = truncateToTokenBudget(user, userBudget).value;
      assistant = truncateToTokenBudget(assistant, assistantBudget).value;
      truncated = true;
    }
    if (userBounded.truncated || assistantBounded.truncated) truncated = true;
    const pairTokens = estimateTextTokens(user) + estimateTextTokens(assistant);
    newestFirst.push({
      requestId: row.id,
      user,
      assistant,
      completedAt: isoString(row.completed_at),
      tokenEstimate: pairTokens,
    });
    tokenEstimate += pairTokens;
  }

  const checkpointSource = newestFirst[0] ?? null;
  return {
    turns: newestFirst.reverse(),
    tokenEstimate,
    truncated,
    checkpointThrough: checkpointSource?.requestId
      ? {
          requestId: checkpointSource.requestId,
          completedAt: rows.find((row) => row.id === checkpointSource.requestId)?.completed_cursor
            ?? checkpointSource.completedAt,
        }
      : null,
  };
}

/** @deprecated Use buildTokenBudgetedConversationTurns. */
export const buildBoundedConversationTurns = buildTokenBudgetedConversationTurns;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 12)
    : [];
}

function toCheckpoint(row: CheckpointRow | undefined): AiConversationCheckpoint | null {
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    throughRequestId: row.through_request_id,
    throughCompletedAt: typeof row.through_completed_at === "string"
      ? row.through_completed_at
      : row.through_completed_at.toISOString(),
    summaryText: row.summary_text,
    summary: {
      goals: stringArray(row.summary_json?.goals),
      decisions: stringArray(row.summary_json?.decisions),
      openQuestions: stringArray(row.summary_json?.openQuestions),
    },
    tokenEstimate: row.token_estimate,
  };
}

export async function prepareAiConversation(
  client: PoolClient,
  session: AuthenticatedSession,
): Promise<PreparedAiConversation> {
  await lockMemberConversation(client, session.tripId, session.memberId);

  const activeResult = await client.query<ConversationRow>(
    `SELECT id, actor_user_id, COALESCE(to_jsonb(ai_conversations)->>'purpose','trip') AS purpose
       FROM ai_conversations
      WHERE trip_id = $1 AND actor_member_id = $2 AND closed_at IS NULL
      FOR UPDATE`,
    [session.tripId, session.memberId],
  );
  let active: ConversationRow | undefined = activeResult.rows[0];
  if (active?.purpose === "preferences" && active.actor_user_id === session.userId) {
    throw new AppConflictError("Legacy preference conversations are read-only. Start a new conversation.");
  }
  let createCause: "first_use" | "identity_mismatch" = "first_use";
  if (active && active.actor_user_id !== session.userId) {
    await closeMemberAiConversationForIdentityChange(client, {
      tripId: session.tripId, memberId: session.memberId, actorMemberId: session.memberId, cause: "identity_mismatch",
    });
    active = undefined;
    createCause = "identity_mismatch";
  }

  const conversationId = active?.id ?? await createConversation(client, session, createCause);
  const inFlightResult = await client.query<{ busy: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM ai_requests
        WHERE trip_id = $1
          AND conversation_id = $2
          AND actor_member_id = $3
          AND actor_user_id = $4
          AND status = 'started'
          AND created_at > CURRENT_TIMESTAMP - make_interval(mins => $5::integer)
     ) AS busy`,
    [session.tripId, conversationId, session.memberId, session.userId, ACTIVE_REQUEST_WINDOW_MINUTES],
  );
  if (inFlightResult.rows[0]?.busy) {
    throw new AiConversationBusyError();
  }

  const checkpointResult = await client.query<CheckpointRow>(
    `SELECT id, version, through_request_id,
            to_char(through_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS through_completed_at,
            summary_text, summary_json, token_estimate
       FROM ai_conversation_checkpoints
      WHERE trip_id = $1 AND conversation_id = $2
        AND actor_member_id = $3 AND actor_user_id = $4
      ORDER BY version DESC
      LIMIT 1`,
    [session.tripId, conversationId, session.memberId, session.userId],
  );
  const checkpoint = toCheckpoint(checkpointResult.rows[0]);

  const historyResult = await client.query<AiConversationMemoryRow>(
    `SELECT id, prompt_text, result_text, completed_at,
            to_jsonb(ai_requests)->>'image_context_text' AS image_context_text,
            to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed_cursor,
            (count(*) OVER ())::integer AS available_turns
       FROM ai_requests
      WHERE trip_id = $1
        AND conversation_id = $2
        AND actor_member_id = $3
        AND actor_user_id = $4
        AND feature = 'planning'
        AND status = 'succeeded'
        AND result_text IS NOT NULL
        AND btrim(result_text) <> ''
        AND completed_at IS NOT NULL
        AND (
          $5::timestamptz IS NULL
          OR (completed_at, id) > ($5::timestamptz, $6::uuid)
        )
      ORDER BY completed_at DESC, created_at DESC, id DESC
      LIMIT $7`,
    [session.tripId, conversationId, session.memberId, session.userId,
      checkpoint?.throughCompletedAt ?? null, checkpoint?.throughRequestId ?? null,
      MAX_HISTORY_SCAN_ROWS],
  );
  const memory = buildTokenBudgetedConversationTurns(historyResult.rows);

  await client.query(
    `UPDATE ai_conversations
        SET last_used_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND id = $2 AND closed_at IS NULL`,
    [session.tripId, conversationId],
  );

  return { conversationId, checkpoint, ...memory };
}

export async function createConversationCheckpoint(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  input: {
    conversationId: string;
    through: { requestId: string; completedAt: string } | null;
    summaryText: string;
    goals: string[];
    decisions: string[];
    openQuestions: string[];
  },
): Promise<{ id: string; version: number } | null> {
  if (!input.through) return null;
  const current = await client.query<{ version: number; through_request_id: string }>(
    `SELECT version, through_request_id
       FROM ai_conversation_checkpoints
      WHERE trip_id = $1 AND conversation_id = $2
      ORDER BY version DESC
      LIMIT 1
      FOR UPDATE`,
    [session.tripId, input.conversationId],
  );
  if (current.rows[0]?.through_request_id === input.through.requestId) {
    return null;
  }
  const checkpointId = randomUUID();
  const version = (current.rows[0]?.version ?? 0) + 1;
  const summaryText = input.summaryText.trim().slice(0, 8_000);
  const summary = {
    goals: input.goals.slice(0, 12).map((item) => item.slice(0, 500)),
    decisions: input.decisions.slice(0, 12).map((item) => item.slice(0, 500)),
    openQuestions: input.openQuestions.slice(0, 12).map((item) => item.slice(0, 500)),
  };
  await client.query(
    `INSERT INTO ai_conversation_checkpoints (
       trip_id, id, conversation_id, actor_member_id, actor_user_id, version,
       through_request_id, through_completed_at, summary_text, summary_json, token_estimate
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [session.tripId, checkpointId, input.conversationId, session.memberId, session.userId,
      version, input.through.requestId, input.through.completedAt, summaryText,
      JSON.stringify(summary), estimateTextTokens(summaryText + JSON.stringify(summary))],
  );
  return { id: checkpointId, version };
}

export async function resetAiConversation(
  pool: Pool,
  session: AuthenticatedSession,
  tripId: string,
): Promise<{ conversationId: string }> {
  if (session.tripId !== tripId) {
    throw new AppForbiddenError("This trip is not available to the current member.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockCurrentTripActor(client, session);
    await lockBoundUserAi(client, session.userId);
    await lockActiveAiMember(client, session);
    await assertBoundUserAiIdle(client, session.userId);
    await lockMemberConversation(client, tripId, session.memberId);
    const historyEnabled = await supportsAiConversationHistory(client);
    const activeResult = await client.query<{ id: string }>(
      `UPDATE ai_conversations
          SET closed_at = CURRENT_TIMESTAMP${historyEnabled ? ", closed_reason = 'user_reset'" : ""}
        WHERE trip_id = $1 AND actor_member_id = $2 AND actor_user_id = $3 AND closed_at IS NULL
      RETURNING id`,
      [tripId, session.memberId, session.userId],
    );
    for (const row of activeResult.rows) {
      await appendConversationAudit(client, {
        tripId,
        conversationId: row.id,
        actorMemberId: session.memberId,
        action: "reset",
        cause: "user_reset",
      });
    }
    const conversationId = await createConversation(client, session, "user_reset");
    await client.query("COMMIT");
    return { conversationId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeMemberAiConversationForIdentityChange(
  client: PoolClient,
  input: {
    tripId: string;
    memberId: string;
    actorMemberId: string | null;
    cause: "identity_unbound" | "owner_recovery" | "identity_mismatch";
  },
): Promise<void> {
  await lockMemberConversation(client, input.tripId, input.memberId);
  const historyEnabled = await supportsAiConversationHistory(client);
  const closedResult = await client.query<{ id: string }>(
    `UPDATE ai_conversations
        SET closed_at = ${historyEnabled ? "COALESCE(closed_at, CURRENT_TIMESTAMP), closed_reason = $3, history_revoked_at = CURRENT_TIMESTAMP" : "CURRENT_TIMESTAMP"}
      WHERE trip_id = $1 AND actor_member_id = $2 AND ${historyEnabled ? "history_revoked_at IS NULL" : "closed_at IS NULL"}
    RETURNING id`,
    [input.tripId, input.memberId, ...(historyEnabled ? [input.cause] : [])],
  );
  for (const row of closedResult.rows) {
    await appendConversationAudit(client, {
      tripId: input.tripId,
      conversationId: row.id,
      actorMemberId: input.actorMemberId,
      action: "closed",
      cause: input.cause,
    });
  }
}

/** Browsing never calls this. Explicit continuation switches one self-owned archive. */
export async function resumeAiConversation(
  pool: Pool, session: AuthenticatedSession, tripId: string, conversationId: string,
): Promise<{ conversationId: string }> {
  if (session.tripId !== tripId) throw new AppForbiddenError("This trip is not available to the current member.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockCurrentTripActor(client, session);
    await lockBoundUserAi(client, session.userId);
    await lockActiveAiMember(client, session);
    await assertBoundUserAiIdle(client, session.userId);
    await lockMemberConversation(client, tripId, session.memberId);
    if (!await supportsAiConversationHistory(client)) throw new AppConflictError("AI conversation history is not configured yet.");
    const target = await client.query<{ id: string; closed_at: Date | null; purpose?: AiConversationPurpose }>(
      `SELECT id, closed_at, COALESCE(to_jsonb(ai_conversations)->>'purpose','trip') AS purpose FROM ai_conversations
        WHERE trip_id = $1 AND id = $2 AND actor_member_id = $3 AND actor_user_id = $4
          AND history_revoked_at IS NULL
          AND (closed_at IS NULL OR closed_reason IN ('user_reset','user_switch')) FOR UPDATE`,
      [tripId, conversationId, session.memberId, session.userId],
    );
    if (!target.rows[0]) throw new AppNotFoundError("AI conversation not found.");
    if (target.rows[0].purpose === "preferences") throw new AppConflictError("Legacy preference conversations are read-only. Start a new conversation.");
    if (target.rows[0].closed_at !== null) {
      const archived = await client.query<{ id: string }>(
        `UPDATE ai_conversations SET closed_at = CURRENT_TIMESTAMP, closed_reason = 'user_switch'
          WHERE trip_id = $1 AND actor_member_id = $2 AND actor_user_id = $3 AND closed_at IS NULL
            AND history_revoked_at IS NULL RETURNING id`,
        [tripId, session.memberId, session.userId],
      );
      for (const row of archived.rows) {
        await appendConversationAudit(client, { tripId, conversationId: row.id, actorMemberId: session.memberId,
          action: "closed", cause: "user_switch" });
      }
      await client.query(
        `UPDATE ai_conversations SET closed_at = NULL, closed_reason = NULL, last_used_at = CURRENT_TIMESTAMP
          WHERE trip_id = $1 AND id = $2 AND actor_member_id = $3 AND actor_user_id = $4
            AND history_revoked_at IS NULL`,
        [tripId, conversationId, session.memberId, session.userId],
      );
      await appendConversationAudit(client, { tripId, conversationId, actorMemberId: session.memberId,
        action: "resumed", cause: "user_switch" });
    }
    await client.query("COMMIT");
    return { conversationId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Purpose is persisted and immutable; a request cannot promote a preference chat to trip-writing mode. */
export async function readAiConversationPurpose(client: Pick<PoolClient, "query">, session: AuthenticatedSession): Promise<AiConversationPurpose> {
  const result = await client.query<{ purpose: string }>(
    `SELECT COALESCE(to_jsonb(conversation)->>'purpose','trip') AS purpose FROM ai_conversations conversation
      WHERE conversation.trip_id=$1 AND conversation.actor_member_id=$2 AND conversation.actor_user_id=$3
        AND conversation.closed_at IS NULL`, [session.tripId, session.memberId, session.userId],
  );
  return result.rows[0]?.purpose === "preferences" ? "preferences" : "trip";
}
