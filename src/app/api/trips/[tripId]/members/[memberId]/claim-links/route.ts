import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { issueClaim, revokeClaims } from "@/lib/auth/repository";
import { buildClaimUrl } from "@/lib/auth/tokens";
import {
  requireAuthenticatedSession,
  requireSameOrigin,
  requireTripOwner,
} from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tripId: string; memberId: string }> },
) {
  const config = getAuthConfig();
  requireSameOrigin(request, config);
  const session = await requireAuthenticatedSession(request, config);
  const { tripId, memberId } = await context.params;
  requireTripOwner(session, tripId);
  const claim = await issueClaim(getPool(config), config, {
    tripId,
    memberId,
    actorMemberId: session.memberId,
    actorUserId: session.userId,
  });
  return NextResponse.json(
    {
      claimUrl: buildClaimUrl(config.appBaseUrl, claim.rawToken),
      expiresAt: claim.expiresAt,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ tripId: string; memberId: string }> },
) {
  const config = getAuthConfig();
  requireSameOrigin(request, config);
  const session = await requireAuthenticatedSession(request, config);
  const { tripId, memberId } = await context.params;
  requireTripOwner(session, tripId);
  await revokeClaims(getPool(config), {
    tripId,
    memberId,
    actorMemberId: session.memberId,
    actorUserId: session.userId,
  });
  return NextResponse.json({ revoked: true });
}
