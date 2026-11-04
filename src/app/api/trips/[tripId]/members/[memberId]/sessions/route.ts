import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { revokeMemberSessions } from "@/lib/auth/repository";
import {
  requireAuthenticatedSession,
  requireSameOrigin,
  requireTripOwner,
} from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ tripId: string; memberId: string }> },
) {
  const config = getAuthConfig();
  requireSameOrigin(request, config);
  const session = await requireAuthenticatedSession(request, config);
  const { tripId, memberId } = await context.params;
  requireTripOwner(session, tripId);
  await revokeMemberSessions(getPool(config), {
    tripId,
    memberId,
    actorMemberId: session.memberId,
    actorUserId: session.userId,
  });
  return NextResponse.json({ revoked: true });
}
