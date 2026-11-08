import { NextRequest, NextResponse } from "next/server";

import { getAiUsageSummary } from "@/lib/ai/usage-summary";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/** The signed-in account's last 30 days of AI tokens and estimated cost, for the AI tab (JOB-093). */
type Context = { params: Promise<{ tripId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    return NextResponse.json(await getAiUsageSummary(getPool(config), session, tripId), { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}
