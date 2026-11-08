import { after, NextRequest, NextResponse } from "next/server";

import {
  aiPreferencesInputSchema, claimRoutineAutoCheck, getAiPreferences, limitRoutineSearchChecks, RoutineSearchCheckError, runRoutineAutoCheck,
  saveAiPreferences,
} from "@/lib/ai/preferences";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { RateLimitError } from "@/lib/auth/errors";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/**
 * The signed-in account's AI preferences (JOB-094): chat effort and routine checks. Turning routine checks
 * on runs one live web search on the account's own key, so those checks are rate limited. POST starts the
 * automatic check for a key saved before routine checks turned on by themselves (JOB-096); it runs after
 * the response, and the AI tab reads its progress with GET.
 */
type Context = { params: Promise<{ tripId: string }> };
const headers = { "Cache-Control": "private, no-store" };

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
      beforeSearchCheck: () => limitRoutineSearchChecks(pool, config, session),
    }), { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const pool = getPool(config);
    const claim = await claimRoutineAutoCheck(pool, session, tripId, { beforeCheck: () => limitRoutineSearchChecks(pool, config, session) });
    if (claim) {
      after(() => runRoutineAutoCheck(pool, session, tripId, claim).then(() => undefined,
        () => console.warn(JSON.stringify({ routineAutoCheck: { error: "finish" } }))));
    }
    return NextResponse.json(await getAiPreferences(pool, session, tripId), { headers });
  } catch (error) { return failure(error); }
}
