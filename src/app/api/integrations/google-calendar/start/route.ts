import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { assertNotGuest, getMemberPermissions } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, secureCookie } from "@/lib/auth/web";
import { calendarCookieNames, createCalendarAuthorizationTransaction } from "@/lib/calendar/google-auth";
import { getPool } from "@/lib/db/pool";

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    // A guest owns its demo trip, so owner permissions alone would allow this (JOB-064).
    assertNotGuest(session, "connect Google Calendar");
    const permissions = await getMemberPermissions(getPool(config), session.tripId, session.memberId);
    if (!permissions.canSyncCalendar) {
      return NextResponse.json({ error: "Calendar access is disabled for this member." }, { status: 403 });
    }
    const transaction = createCalendarAuthorizationTransaction(config);
    const response = NextResponse.redirect(transaction.authorizationUrl);
    const options = {
      httpOnly: true,
      secure: secureCookie(config),
      sameSite: "lax" as const,
      path: "/",
      maxAge: 10 * 60,
      priority: "high" as const,
    };
    response.cookies.set(calendarCookieNames.state, transaction.state, options);
    response.cookies.set(calendarCookieNames.verifier, transaction.codeVerifier, options);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
