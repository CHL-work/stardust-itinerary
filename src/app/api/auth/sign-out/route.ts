import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { revokeSession } from "@/lib/auth/repository";
import {
  clearSessionCookie,
  requireAuthenticatedSession,
  requireSameOrigin,
} from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    await revokeSession(getPool(config), session.sessionId, session.userId);
    const response = NextResponse.json({ signedOut: true });
    clearSessionCookie(response, config);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
