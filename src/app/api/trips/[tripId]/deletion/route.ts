import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { tripDeletionInputSchema } from "@/lib/app/trip-deletion-contract";
import { deleteTrip, getTripDeletionPreview } from "@/lib/app/trip-deletion";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin, setSessionCookie } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    return privateResponse(NextResponse.json(await getTripDeletionPreview(getPool(config), session, tripId)));
  } catch (error) {
    return privateResponse(apiError(error));
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const result = await deleteTrip(getPool(config), config, session, tripId,
      tripDeletionInputSchema.parse(await request.json()), request.headers.get("user-agent"));
    const response = NextResponse.json({ deleted: true, nextTripId: result.nextTripId });
    setSessionCookie(response, config, result.grant);
    return privateResponse(response);
  } catch (error) {
    return privateResponse(apiError(error));
  }
}
