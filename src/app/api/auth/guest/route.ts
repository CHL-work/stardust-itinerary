import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createGuestSession, GuestCapacityError, guestModeEnabled, verifyTurnstile } from "@/lib/app/guest";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { RateLimitError } from "@/lib/auth/errors";
import { enforceRateLimit } from "@/lib/auth/repository";
import { requestRateLimitKey, requireSameOrigin, setSessionCookie } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { locales } from "@/lib/i18n";

/**
 * "Try as guest" (JOB-064): a 24-hour guest account with a synthetic demo trip. Off unless
 * GUEST_MODE_ENABLED=true; gated by Cloudflare Turnstile when configured, and always rate limited.
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
    const text = await request.text();
    let raw: unknown = {};
    if (text.trim()) {
      try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: "The submitted values are invalid." }, { status: 400, headers }); }
    }
    const body = guestRequestSchema.parse(raw);
    const pool = getPool(config);
    await enforceRateLimit(pool, config, { scope: "guest-create", key: requestRateLimitKey(request), maximum: 3, windowSeconds: 3600 });
    const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
    if (await verifyTurnstile(body.turnstileToken, address) === "failed") {
      return NextResponse.json({ error: "The check that you are a person did not pass. Try again.", code: "GUEST_CHALLENGE_FAILED" },
        { status: 403, headers });
    }
    const created = await createGuestSession(pool, config, {
      userAgent: request.headers.get("user-agent"), locale: body.locale ?? "en",
    });
    const response = NextResponse.json({ tripId: created.tripId }, { status: 201, headers });
    setSessionCookie(response, config, created.grant);
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: "Too many guest trips were started from here. Try again later.", code: "GUEST_RATE_LIMITED" },
        { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) } });
    }
    if (error instanceof GuestCapacityError) {
      return NextResponse.json({ error: error.message, code: "GUEST_CAPACITY" }, { status: 503, headers });
    }
    const response = apiError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
