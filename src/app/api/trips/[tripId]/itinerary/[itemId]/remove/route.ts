import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/app/http";
import { removeCancelledItineraryItem } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

const removalSchema = z.strictObject({
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  confirm: z.literal(true),
});
const routeParamsSchema = z.object({ tripId: z.uuid(), itemId: z.uuid() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, itemId } = routeParamsSchema.parse(await params);
    const input = removalSchema.parse(await request.json());
    const result = await removeCancelledItineraryItem(getPool(config), session, tripId, itemId, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
