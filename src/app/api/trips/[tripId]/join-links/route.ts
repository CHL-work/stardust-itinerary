import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { AppInvalidInputError, requireKeysToShare } from "@/lib/app/repository";
import { joinLinkSchema } from "@/lib/app/validation";
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
    // The body is optional: older clients send none.
    const text = await request.text();
    let raw: unknown = {};
    if (text.trim()) {
      try { raw = JSON.parse(text); } catch { throw new AppInvalidInputError("The submitted values are invalid."); }
    }
    const { shareAiKeys } = joinLinkSchema.parse(raw);
    const pool = getPool(config);
    if (shareAiKeys) await requireKeysToShare(pool, session.userId);
    const link = await issueJoinLink(pool, config, {
      tripId,
      actorMemberId: session.memberId,
      actorUserId: session.userId,
      sharesAiKeys: shareAiKeys === true,
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
