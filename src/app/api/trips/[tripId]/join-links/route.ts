import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { JoinUnavailableError } from "@/lib/auth/errors";
import { issueJoinLink, revokeJoinLink } from "@/lib/auth/repository";
import { buildJoinUrl } from "@/lib/auth/tokens";
import {
  requireAuthenticatedSession,
  requireSameOrigin,
  requireTripOwner,
} from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    requireTripOwner(session, tripId);
    const link = await issueJoinLink(getPool(config), config, {
      tripId,
      actorMemberId: session.memberId,
      actorUserId: session.userId,
    });
    return NextResponse.json(
      { joinUrl: buildJoinUrl(config.appBaseUrl, link.rawToken) },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof JoinUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return apiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    requireTripOwner(session, tripId);
    await revokeJoinLink(getPool(config), {
      tripId,
      actorMemberId: session.memberId,
      actorUserId: session.userId,
    });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiError(error);
  }
}
