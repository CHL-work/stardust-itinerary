import { assertNotGuest } from "@/lib/app/repository";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { previewCalendarImport } from "@/lib/calendar/import-repository";
import { calendarPrivateHeaders, calendarImportHttpError, calendarWrongTrip, readCalendarImportJson } from "@/lib/calendar/import-http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig(); requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config); assertNotGuest(session, "use Google Calendar");
    const { tripId } = await params; if (tripId !== session.tripId) return calendarWrongTrip();
    const input = z.strictObject({ eventId: z.string().min(5).max(1024) }).parse(await readCalendarImportJson(request));
    return NextResponse.json(await previewCalendarImport(getPool(config), config, session, tripId, input.eventId), { headers: calendarPrivateHeaders });
  } catch (error) { return calendarImportHttpError(error); }
}
