import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createGuestSession, GuestAddressLimitError, GuestCapacityError, guestModeEnabled, turnstileMode, verifyTurnstile,
} from "@/lib/app/guest";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { setAccountCookie } from "@/lib/auth/account-session";
import { RateLimitError } from "@/lib/auth/errors";
import { enforceRateLimit } from "@/lib/auth/repository";
import { clearSessionCookie, requireSameOrigin, trustedClientAddress } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { locales } from "@/lib/i18n";

/**
 * "Try as guest": a 24-hour guest account that starts at Create Trip. Off unless
 * GUEST_MODE_ENABLED=true; gated by Cloudflare Turnstile (required unless explicitly waived),
 * rate limited and capped per address on Cloudflare's own client-address header.
 */
const guestRequestSchema = z.strictObject({
  turnstileToken: z.string().min(1).max(2048).optional(),
  locale: z.enum(locales).optional(),
});
const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!guestModeEnabled()) return NextResponse.json({ error: "Guest mode is not available." }, { status: 404, headers });
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const mode = turnstileMode();
    if (mode === "misconfigured") {
      console.error("Guest mode is on without TURNSTILE_SECRET_KEY; guest creation is refused");
      return NextResponse.json({ error: "Guest trips are not available right now.", code: "GUEST_UNAVAILABLE" }, { status: 503, headers });
    }
    const text = await request.text();
    let raw: unknown = {};
    if (text.trim()) {
      try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: "The submitted values are invalid." }, { status: 400, headers }); }
    }
    const body = guestRequestSchema.parse(raw);
    const pool = getPool(config);
    const address = trustedClientAddress(request);
    await enforceRateLimit(pool, config, { scope: "guest-create", key: address, maximum: 3, windowSeconds: 3600 });
    if (mode === "required" && !await verifyTurnstile(body.turnstileToken, address === "unknown-address" ? null : address,
      { hostname: config.appBaseUrl.hostname, action: "guest" })) {
      return NextResponse.json({ error: "The check that you are a person did not pass. Try again.", code: "GUEST_CHALLENGE_FAILED" },
        { status: 403, headers });
    }
    const created = await createGuestSession(pool, config, {
      userAgent: request.headers.get("user-agent"), locale: body.locale ?? "en", address,
    });
    const response = NextResponse.json({ next: `/trips/new?locale=${body.locale ?? "en"}` }, { status: 201, headers });
    clearSessionCookie(response, config);
    setAccountCookie(response, config, created.grant);
    return response;
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof GuestAddressLimitError) {
      return NextResponse.json({ error: error instanceof GuestAddressLimitError ? error.message : "Too many guest trips were started from here. Try again later.",
        code: "GUEST_RATE_LIMITED" },
      { status: 429, headers: { ...headers, ...(error instanceof RateLimitError ? { "Retry-After": String(error.retryAfterSeconds) } : {}) } });
    }
    if (error instanceof GuestCapacityError) {
      return NextResponse.json({ error: error.message, code: "GUEST_CAPACITY" }, { status: 503, headers });
    }
    const response = apiError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
