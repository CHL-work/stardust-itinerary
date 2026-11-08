import { assertNotGuest } from "@/lib/app/repository";
import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, secureCookie } from "@/lib/auth/web";
import { calendarCookieNames, completeCalendarAuthorization } from "@/lib/calendar/google-auth";
import { storeCalendarConnection } from "@/lib/calendar/repository";
import { getPool } from "@/lib/db/pool";
import { readAccountLocale } from "@/lib/auth/locale-preference";
import { localeCookieName, preferredLocale } from "@/lib/locale-preference";

function clearCalendarCookies(response: NextResponse, secure: boolean): void {
  for (const name of Object.values(calendarCookieNames)) {
    response.cookies.set(name, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
  }
}

export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  const rememberedLocale = request.cookies.get(localeCookieName)?.value;
  let locale = preferredLocale(null, rememberedLocale);
  const state = request.cookies.get(calendarCookieNames.state)?.value;
  const verifier = request.cookies.get(calendarCookieNames.verifier)?.value;
  if (!state || !verifier) return NextResponse.json({ error: "Calendar authorization expired." }, { status: 400 });
  try {
    const session = await requireAuthenticatedSession(request, config); assertNotGuest(session, "use Google Calendar");
    locale = preferredLocale(await readAccountLocale(getPool(config), session.userId), rememberedLocale);
    const tokens = await completeCalendarAuthorization(config, new URL(request.url), state, verifier);
    await storeCalendarConnection(getPool(config), config, session, tokens);
    const response = NextResponse.redirect(new URL(`/${locale}?calendar=connected`, config.appBaseUrl));
    clearCalendarCookies(response, secureCookie(config));
    return response;
  } catch {
    const response = NextResponse.redirect(new URL(`/${locale}?calendar=error`, config.appBaseUrl));
    clearCalendarCookies(response, secureCookie(config));
    return response;
  }
}
