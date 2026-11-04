import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { removeTripMember, updateTripMember } from "@/lib/app/repository";
import { getTripMemberRemovalPreview, memberRemovalInputSchema } from "@/lib/app/member-removal";
import { updateMemberSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; memberId: string }> },
) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, memberId } = await params;
    return privateResponse(NextResponse.json(await getTripMemberRemovalPreview(getPool(config), session, tripId, memberId)));
  } catch (error) {
    return privateResponse(apiError(error));
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; memberId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, memberId } = await params;
    await updateTripMember(
      getPool(config),
      session,
      tripId,
      memberId,
      updateMemberSchema.parse(await request.json()),
    );
    return privateResponse(NextResponse.json({ ok: true }));
  } catch (error) {
    return privateResponse(apiError(error));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; memberId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, memberId } = await params;
    await removeTripMember(getPool(config), session, tripId, memberId,
      memberRemovalInputSchema.parse(await request.json()));
    return privateResponse(NextResponse.json({ removed: true }));
  } catch (error) {
    return privateResponse(apiError(error));
  }
}
