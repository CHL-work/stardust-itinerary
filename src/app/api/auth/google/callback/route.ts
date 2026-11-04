import { NextRequest, NextResponse } from "next/server";
import { ResponseBodyError } from "openid-client";

import { getAuthConfig } from "@/lib/auth/config";
import { clearAccountCookie, issueAccountOnboarding, publicSignupEnabled, setAccountCookie } from "@/lib/auth/account-session";
import {
  ClaimUnavailableError,
  JoinUnavailableError,
  MembershipDisabledError,
  RateLimitError,
  SessionUnavailableError,
} from "@/lib/auth/errors";
import { completeGoogleAuthorization } from "@/lib/auth/google";
import {
  consumeClaim,
  consumeJoinLink,
  enforceRateLimit,
  signInExistingIdentity,
} from "@/lib/auth/repository";
import {
  authenticatedSession,
  authCookieNames,
  clearOAuthCookies,
  clearSessionCookie,
  requestRateLimitKey,
  setSessionCookie,
} from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  const pool = getPool(config);

  const state = request.cookies.get(authCookieNames.oauthState)?.value;
  const nonce = request.cookies.get(authCookieNames.oauthNonce)?.value;
  const codeVerifier = request.cookies.get(authCookieNames.oauthVerifier)?.value;
  if (!state || !nonce || !codeVerifier) {
    const session = await authenticatedSession(request, config);
    const response = NextResponse.redirect(
      new URL(session ? "/" : "/auth/sign-in?error=expired", config.appBaseUrl),
    );
    clearOAuthCookies(response, config);
    response.cookies.delete(authCookieNames.claimIntent);
    response.cookies.delete(authCookieNames.joinIntent);
    return response;
  }

  try {
    await enforceRateLimit(pool, config, {
      scope: "google-callback",
      key: requestRateLimitKey(request),
      maximum: 20,
      windowSeconds: 300,
    });
    const identity = await completeGoogleAuthorization(config, new URL(request.url), {
      state,
      nonce,
      codeVerifier,
    });
    const claimToken = request.cookies.get(authCookieNames.claimIntent)?.value;
    const joinToken = request.cookies.get(authCookieNames.joinIntent)?.value;
    if (claimToken && joinToken) {
      throw new SessionUnavailableError("Conflicting invitation intents were rejected.");
    }
    const userAgent = request.headers.get("user-agent");
    let grant;
    if (claimToken) grant = await consumeClaim(pool, config, { rawToken: claimToken, identity, userAgent });
    else if (joinToken) grant = await consumeJoinLink(pool, config, { rawToken: joinToken, identity, userAgent });
    else {
      try { grant = await signInExistingIdentity(pool,config,{ identity,userAgent }); }
      catch (error) {
        if (!publicSignupEnabled() || !(error instanceof SessionUnavailableError || error instanceof MembershipDisabledError)) throw error;
        const accountGrant = await issueAccountOnboarding(pool,config,identity);
        const response = NextResponse.redirect(new URL("/trips/new",config.appBaseUrl));
        clearOAuthCookies(response,config);
        response.cookies.delete(authCookieNames.claimIntent);
        response.cookies.delete(authCookieNames.joinIntent);
        clearSessionCookie(response,config);
        setAccountCookie(response,config,accountGrant);
        return response;
      }
    }
    const response = NextResponse.redirect(new URL("/", config.appBaseUrl));
    clearOAuthCookies(response, config);
    response.cookies.delete(authCookieNames.claimIntent);
    response.cookies.delete(authCookieNames.joinIntent);
    clearAccountCookie(response,config);
    setSessionCookie(response, config, grant);
    return response;
  } catch (error) {
    const reason = error instanceof MembershipDisabledError
      ? "disabled"
      : error instanceof SessionUnavailableError
      ? "unbound"
      : error instanceof ClaimUnavailableError
        ? "claim"
        : error instanceof JoinUnavailableError
          ? "join"
        : error instanceof RateLimitError
          ? "rate_limit"
          : "oauth";
    console.error("Google authentication callback failed", {
      reason,
      error: error instanceof Error ? error.message : "Unknown authentication error",
      providerStatus: error instanceof ResponseBodyError ? error.status : undefined,
      providerError: error instanceof ResponseBodyError ? error.error : undefined,
      providerDescription: error instanceof ResponseBodyError ? error.error_description : undefined,
    });
    const response = NextResponse.redirect(new URL(`/auth/sign-in?error=${reason}`, config.appBaseUrl));
    clearOAuthCookies(response, config);
    response.cookies.delete(authCookieNames.claimIntent);
    response.cookies.delete(authCookieNames.joinIntent);
    clearAccountCookie(response,config);
    return response;
  }
}
