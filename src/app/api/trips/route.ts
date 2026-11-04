import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { createTrip } from "@/lib/app/repository";
import { createTripSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { accountCookieName, clearAccountCookie, verifyAccountOnboarding } from "@/lib/auth/account-session";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { authenticatedSession, requireSameOrigin, setSessionCookie } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const pool = getPool(config);
    const session = await authenticatedSession(request, config)
      ?? await verifyAccountOnboarding(pool,config,request.cookies.get(accountCookieName)?.value);
    if (!session) throw new SessionUnavailableError("Sign in with Google before creating a trip.");
    const input = createTripSchema.parse(await request.json());
    const created = await createTrip(pool, session, input,{ config,userAgent:request.headers.get("user-agent") });
    const response = NextResponse.json({ tripId:created.tripId,memberId:created.memberId }, {
      status: 201,
      headers: { "Cache-Control": "no-store, private" },
    });
    if (created.sessionGrant) setSessionCookie(response,config,created.sessionGrant);
    clearAccountCookie(response,config);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
