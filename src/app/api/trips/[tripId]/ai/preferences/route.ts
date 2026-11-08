import { NextRequest, NextResponse } from "next/server";

import { aiPreferencesInputSchema, getAiPreferences, RoutineSearchCheckError, saveAiPreferences } from "@/lib/ai/preferences";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { RateLimitError } from "@/lib/auth/errors";
import { isGuestSession } from "@/lib/auth/guest-identity";
import { enforceRateLimit } from "@/lib/auth/repository";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/**
 * The signed-in account's AI preferences (JOB-094): chat effort and routine checks. Turning routine checks
 * on runs one live web search on the account's own key, so those checks are rate limited.
 */
type Context = { params: Promise<{ tripId: string }> };
const headers = { "Cache-Control": "private, no-store" };
const SEARCH_CHECKS_PER_HOUR = 10;
const GUEST_SEARCH_CHECKS_PER_DAY = 3;

function failure(error: unknown) {
  const response = error instanceof RoutineSearchCheckError
    ? NextResponse.json({ error: error.message, code: error.reason === "no_search" ? "ROUTINE_SEARCH_UNAVAILABLE"
      : error.reason === "auth" ? "ROUTINE_KEY_REJECTED" : "ROUTINE_CHECK_FAILED" }, { status: error.reason === "provider" ? 503 : 400 })
    : error instanceof RateLimitError
      ? NextResponse.json({ error: "Too many search checks. Try again later.", code: "ROUTINE_CHECKS_LIMITED" },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } })
      : apiError(error);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    return NextResponse.json(await getAiPreferences(getPool(config), session, tripId), { headers });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const input = aiPreferencesInputSchema.parse(await request.json());
    const pool = getPool(config);
    return NextResponse.json(await saveAiPreferences(pool, session, tripId, input, {
      beforeSearchCheck: async () => {
        await enforceRateLimit(pool, config, { scope: "ai-routine-search-check", key: session.userId, userId: session.userId,
          maximum: SEARCH_CHECKS_PER_HOUR, windowSeconds: 3600 });
        if (isGuestSession(session)) {
          await enforceRateLimit(pool, config, { scope: "ai-routine-search-check-guest", key: session.userId, userId: session.userId,
            maximum: GUEST_SEARCH_CHECKS_PER_DAY, windowSeconds: 86_400 });
        }
      },
    }), { headers });
  } catch (error) { return failure(error); }
}
