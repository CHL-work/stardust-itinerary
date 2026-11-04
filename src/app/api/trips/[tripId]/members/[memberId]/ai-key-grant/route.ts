import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { setAiKeyGrant } from "@/lib/app/repository";
import { aiKeyGrantSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/**
 * An owner turns a member's use of the owner's own AI keys on or off (JOB-063). The response says
 * nothing about the keys themselves.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; memberId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, memberId } = await params;
    const { shared } = aiKeyGrantSchema.parse(await request.json());
    await setAiKeyGrant(getPool(config), session, tripId, memberId, shared);
    return NextResponse.json({ shared }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
