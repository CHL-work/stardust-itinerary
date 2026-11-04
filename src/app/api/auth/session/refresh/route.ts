import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import { rotateSession } from "@/lib/auth/repository";
import {
  authCookieNames,
  clearSessionCookie,
  requireSameOrigin,
  setSessionCookie,
} from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return new NextResponse(null, { status: 204 });
  }
  const config = getAuthConfig();
  try {
    requireSameOrigin(request, config);
  } catch (error) {
    return apiError(error);
  }
  const rawToken = request.cookies.get(authCookieNames.session)?.value;
  if (!rawToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  try {
    const grant = await rotateSession(getPool(config), config, rawToken);
    const response = NextResponse.json({ authenticated: true, expiresAt: grant.expiresAt });
    setSessionCookie(response, config, grant);
    return response;
  } catch {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    clearSessionCookie(response, config);
    return response;
  }
}
