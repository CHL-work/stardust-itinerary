import { NextRequest, NextResponse } from "next/server";

import { freeAiSettings, listAvailableFreeModels } from "@/lib/ai/free-model";
import { aiProviderFailureDetails } from "@/lib/ai/provider-failure";
import { apiError } from "@/lib/app/http";
import { AppForbiddenError, AppInvalidInputError } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** On-demand, keyless catalog for an active member (including isolated demo guests). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    if (request.nextUrl.search) throw new AppInvalidInputError("This catalog accepts no identity or provider parameters.");
    const { tripId } = await params;
    if (tripId !== session.tripId) throw new AppForbiddenError("This trip is not available to the current member.");
    const settings = freeAiSettings();
    if (!settings.enabled) return NextResponse.json({ models: [], defaultModel: null }, { headers });
    // Recheck current membership and the trip switch without selecting any key or trip contents.
    // Finish this read before provider I/O; a catalog refresh holds no transaction or row lock.
    const access = await getPool(config).query<{ enabled: boolean }>(
      `SELECT settings.enabled FROM trip_ai_settings settings
         JOIN trip_members member ON member.trip_id = settings.trip_id
         JOIN app_users account ON account.id = member.user_id
        WHERE settings.trip_id = $1 AND member.id = $2 AND member.user_id = $3
          AND member.role = $4 AND member.status = 'active'
          AND (to_jsonb(account)->>'suspended_at') IS NULL`,
      [tripId, session.memberId, session.userId, session.role],
    );
    if (!access.rows[0]?.enabled) throw new AppForbiddenError("AI is unavailable for this trip or membership.");
    return NextResponse.json(await listAvailableFreeModels({ settings, signal: request.signal }), { headers });
  } catch (error) {
    const providerFailure = aiProviderFailureDetails(error);
    const response = providerFailure ? NextResponse.json({ error: providerFailure.code, code: providerFailure.code, providerFailure }, {
      status: providerFailure.code === "AI_PROVIDER_RATE_LIMITED" ? 429 : 503,
    }) : apiError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}
