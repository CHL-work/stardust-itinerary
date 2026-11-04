import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { switchSessionTrip } from "@/lib/auth/repository";
import { requireAuthenticatedSession, requireSameOrigin, setSessionCookie } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

const switchTripSchema = z.object({ tripId: z.uuid() });

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const body = switchTripSchema.parse(await request.json());
    const grant = await switchSessionTrip(
      getPool(config),
      config,
      session,
      body.tripId,
      request.headers.get("user-agent"),
    );
    const response = NextResponse.json({ switched: true, tripId: grant.tripId });
    setSessionCookie(response, config, grant);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
