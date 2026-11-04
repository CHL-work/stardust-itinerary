import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { AppInvalidInputError, AppNotFoundError, assertTrip, inTransaction } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { lockActiveAiMember } from "@/lib/ai/conversation";
import { assertAiRequestWritable } from "@/lib/ai/request-recovery";
import { inspectReservationSecrets, redactReservationSecrets } from "@/lib/ai/reservation-secrets";
import type { PreparedAiImage } from "@/lib/ai/image-server-types";
import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_COUNT, AI_IMAGE_MAX_EDGE, AI_IMAGE_FACTS_MAX_CHARACTERS } from "@/lib/ai/image-types";

type Queryable = Pick<PoolClient, "query">;

async function fence(client: Queryable, session: AuthenticatedSession, requestId: string): Promise<void> {
  const request = await client.query<{ conversation_id: string }>(
    `SELECT conversation_id FROM ai_requests
      WHERE trip_id = $1 AND id = $2 AND actor_member_id = $3 AND actor_user_id = $4
        AND conversation_id IS NOT NULL AND status = 'started' AND feature = 'planning'`,
    [session.tripId, requestId, session.memberId, session.userId],
  );
  if (!request.rows[0]) throw new AppNotFoundError("AI request not found.");
  await assertAiRequestWritable(client, session, requestId, request.rows[0].conversation_id);
}

function validateImage(image: PreparedAiImage): void {
  if (!z.uuid().safeParse(image.id).success || image.mediaType !== "image/jpeg"
    || !Buffer.isBuffer(image.data) || image.data.length < 4 || image.data.length > AI_IMAGE_MAX_BYTES
    || image.data.readUInt16BE(0) !== 0xffd8 || image.data.readUInt16BE(image.data.length - 2) !== 0xffd9
    || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > AI_IMAGE_MAX_EDGE || image.height > AI_IMAGE_MAX_EDGE
    || !/^[0-9a-f]{64}$/u.test(image.sha256)
    || createHash("sha256").update(image.data).digest("hex") !== image.sha256) {
    throw new AppInvalidInputError("The prepared AI picture is invalid.");
  }
}

/** Caller owns the admission transaction; validate the entire batch before its first insert. */
export async function saveAiRequestImages(
  client: Queryable, session: AuthenticatedSession, requestId: string, images: readonly PreparedAiImage[],
): Promise<void> {
  if (images.length === 0) return;
  if (images.length > AI_IMAGE_MAX_COUNT || new Set(images.map((image) => image.id)).size !== images.length) {
    throw new AppInvalidInputError("Attach at most three distinct pictures.");
  }
  images.forEach(validateImage);
  await fence(client, session, requestId);
  for (const [ordinal, image] of images.entries()) {
    await client.query(
      `INSERT INTO ai_request_images (trip_id,id,ai_request_id,ordinal,media_type,image_data,sha256,width,height)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [session.tripId, image.id, requestId, ordinal, image.mediaType, image.data, image.sha256, image.width, image.height],
    );
  }
}

/** Facts are write-once and private; a failed extraction never replaces earlier evidence. */
export async function saveAiImageFacts(
  client: Queryable, session: AuthenticatedSession, requestId: string, facts: string,
): Promise<void> {
  if (typeof facts !== "string" || !facts.trim() || facts.length > AI_IMAGE_FACTS_MAX_CHARACTERS) {
    throw new AppInvalidInputError("The extracted picture text is invalid.");
  }
  const sanitized = redactReservationSecrets(facts.trim(), inspectReservationSecrets(facts));
  if (!sanitized.trim() || sanitized.length > AI_IMAGE_FACTS_MAX_CHARACTERS) {
    throw new AppInvalidInputError("The extracted picture text is invalid.");
  }
  await fence(client, session, requestId);
  const result = await client.query(
    `UPDATE ai_requests SET image_context_text = $5
      WHERE trip_id = $1 AND id = $2 AND actor_member_id = $3 AND actor_user_id = $4
        AND status = 'started' AND image_context_text IS NULL
        AND EXISTS (SELECT 1 FROM ai_request_images image WHERE image.trip_id = $1 AND image.ai_request_id = $2)`,
    [session.tripId, requestId, session.memberId, session.userId, sanitized],
  );
  if (result.rowCount !== 1) throw new AppInvalidInputError("Picture facts are unavailable or were already recorded.");
}

export async function readAiRequestImage(
  pool: Pool, session: AuthenticatedSession, tripId: string, imageId: string,
): Promise<{ data: Buffer; mediaType: "image/jpeg" }> {
  assertTrip(session, tripId);
  if (!z.uuid().safeParse(imageId).success) throw new AppInvalidInputError("The picture identifier is invalid.");
  return inTransaction(pool, async (client) => {
    await lockActiveAiMember(client, session);
    const result = await client.query<{ image_data: Buffer; media_type: "image/jpeg" }>(
      `SELECT image.image_data, image.media_type FROM ai_request_images image
       JOIN ai_requests request ON request.trip_id = image.trip_id AND request.id = image.ai_request_id
       JOIN ai_conversations conversation ON conversation.trip_id = request.trip_id AND conversation.id = request.conversation_id
      WHERE image.trip_id = $1 AND image.id = $2 AND request.actor_member_id = $3 AND request.actor_user_id = $4
        AND request.feature = 'planning' AND conversation.actor_member_id = $3 AND conversation.actor_user_id = $4
        AND conversation.history_revoked_at IS NULL
        AND (conversation.closed_at IS NULL OR conversation.closed_reason IN ('user_reset','user_switch'))
      FOR SHARE OF conversation`,
      [tripId, imageId, session.memberId, session.userId],
    );
    if (!result.rows[0]) throw new AppNotFoundError("AI picture not found.");
    return { data: result.rows[0].image_data, mediaType: result.rows[0].media_type };
  });
}
