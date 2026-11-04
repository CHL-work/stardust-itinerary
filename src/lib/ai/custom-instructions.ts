import type { Pool, PoolClient } from "pg";

import { AppConflictError, AppNotFoundError, appendAudit, assertTrip, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { aiInstructionsInputSchema, type AiInstructions, type AiInstructionsInput } from "./custom-instructions-contract";

/** Internal planner read; the caller must already have admitted the current actor. */
export async function readAiInstructions(client: Pick<PoolClient, "query">, userId: string): Promise<AiInstructions> {
  const result = await client.query<{ ai_instructions: string; ai_instructions_revision: number }>(
    "SELECT ai_instructions, ai_instructions_revision FROM app_users WHERE id = $1", [userId],
  );
  const row = result.rows[0];
  if (!row) throw new AppNotFoundError("Account not found.");
  return { instructions: row.ai_instructions, revision: row.ai_instructions_revision };
}

export async function getAiInstructions(pool: Pool, session: AuthenticatedSession, tripId: string): Promise<AiInstructions> {
  assertTrip(session, tripId);
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    return readAiInstructions(client, session.userId);
  });
}

export async function saveAiInstructions(
  pool: Pool, session: AuthenticatedSession, tripId: string, input: AiInstructionsInput,
): Promise<AiInstructions> {
  assertTrip(session, tripId);
  const value = aiInstructionsInputSchema.parse(input);
  return inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const result = await client.query<{ ai_instructions: string; ai_instructions_revision: number }>(
      `UPDATE app_users
          SET ai_instructions = $2, ai_instructions_revision = ai_instructions_revision + 1
        WHERE id = $1 AND ai_instructions_revision = $3
        RETURNING ai_instructions, ai_instructions_revision`,
      [session.userId, value.instructions, value.expectedRevision],
    );
    const row = result.rows[0];
    if (!row) throw new AppConflictError("Your AI instructions changed elsewhere. Reload before saving.");
    await appendAudit(client, {
      tripId, actorMemberId: session.memberId, entityType: "ai_instructions", action: "ai.instructions.updated",
      metadata: { revision: row.ai_instructions_revision, characterCount: value.instructions.length, cleared: value.instructions.length === 0 },
    });
    return { instructions: row.ai_instructions, revision: row.ai_instructions_revision };
  });
}
