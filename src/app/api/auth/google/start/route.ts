import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { createGoogleAuthorizationTransaction } from "@/lib/auth/google";
import { enforceRateLimit } from "@/lib/auth/repository";
import { authCookieNames, requestRateLimitKey, secureCookie } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  await enforceRateLimit(getPool(config), config, {
    scope: "google-start",
    key: requestRateLimitKey(request),
    maximum: 10,
    windowSeconds: 300,
  });
  const transaction = await createGoogleAuthorizationTransaction(config);
  const response = NextResponse.redirect(transaction.authorizationUrl);
  const options = {
    httpOnly: true,
    secure: secureCookie(config),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
    priority: "high" as const,
  };
  response.cookies.set(authCookieNames.oauthState, transaction.state, options);
  response.cookies.set(authCookieNames.oauthNonce, transaction.nonce, options);
  response.cookies.set(authCookieNames.oauthVerifier, transaction.codeVerifier, options);
  return response;
}
