import type { NextRequest, NextResponse } from "next/server";

import type { AuthConfig } from "@/lib/auth/config";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { verifySession, type AuthenticatedSession, type SessionGrant } from "@/lib/auth/repository";
import { getPool } from "@/lib/db/pool";

export const authCookieNames = {
  claimIntent: "stardust.claim-intent",
  joinIntent: "stardust.join-intent",
  oauthState: "stardust.oauth-state",
  oauthNonce: "stardust.oauth-nonce",
  oauthVerifier: "stardust.oauth-verifier",
  session: "stardust.session",
} as const;

export function secureCookie(config: AuthConfig): boolean {
  return config.appBaseUrl.protocol === "https:";
}

export function setSessionCookie(
  response: NextResponse,
  config: AuthConfig,
  grant: SessionGrant,
): void {
  response.cookies.set(authCookieNames.session, grant.rawToken, {
    httpOnly: true,
    secure: secureCookie(config),
    sameSite: "lax",
    path: "/",
    expires: grant.expiresAt,
    priority: "high",
  });
}

export function clearSessionCookie(response: NextResponse, config: AuthConfig): void {
  response.cookies.set(authCookieNames.session, "", {
    httpOnly: true,
    secure: secureCookie(config),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function clearOAuthCookies(response: NextResponse, config: AuthConfig): void {
  for (const name of [
    authCookieNames.oauthState,
    authCookieNames.oauthNonce,
    authCookieNames.oauthVerifier,
  ]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: secureCookie(config),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

export function requestRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("x-real-ip") || forwarded || "local-or-unknown";
  const userAgent = request.headers.get("user-agent") || "unknown-agent";
  return `${address}\0${userAgent}`;
}

/**
 * The client address for abuse limits that strangers could otherwise reset: Cloudflare's own
 * `CF-Connecting-IP` (a client cannot set it through the tunnel), else a reverse proxy's
 * `X-Real-IP`. Never the user agent or the client-supplied first `X-Forwarded-For` entry.
 */
export function trustedClientAddress(request: NextRequest): string {
  return request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown-address";
}

export function requireSameOrigin(request: NextRequest, config: AuthConfig): void {
  if (!config.allowedOrigins.has(request.headers.get("origin") ?? "")) {
    throw new SessionUnavailableError("The request origin is not allowed.");
  }
}

export async function authenticatedSession(
  request: NextRequest,
  config: AuthConfig,
): Promise<AuthenticatedSession | null> {
  const rawToken = request.cookies.get(authCookieNames.session)?.value;
  if (!rawToken) {
    return null;
  }
  return verifySession(getPool(config), config, rawToken);
}

export async function requireAuthenticatedSession(
  request: NextRequest,
  config: AuthConfig,
): Promise<AuthenticatedSession> {
  const session = await authenticatedSession(request, config);
  if (!session) {
    throw new SessionUnavailableError();
  }
  return session;
}

export function requireTripOwner(session: AuthenticatedSession, tripId: string): void {
  if (session.tripId !== tripId || session.role !== "owner") {
    throw new SessionUnavailableError("Owner authorization is required.");
  }
}
