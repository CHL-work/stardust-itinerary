import { assertNotGuest } from "@/lib/app/repository";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import {
  syncAllItineraryItemsToCalendar,
  syncItineraryItemToCalendar,
} from "@/lib/calendar/repository";
import { getPool } from "@/lib/db/pool";

const syncSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("item"), itemId: z.uuid() }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config); assertNotGuest(session, "use Google Calendar");
    const { tripId } = await params;
    const body = syncSchema.parse(await request.json());
    const pool = getPool(config);
    const results = body.mode === "all"
      ? await syncAllItineraryItemsToCalendar(pool, config, session, tripId)
      : [await syncItineraryItemToCalendar(pool, config, session, tripId, body.itemId)];
    return NextResponse.json({ results });
  } catch (error) {
    return apiError(error);
  }
}
