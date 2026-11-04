import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { calendarLocationSearchInput } from "@/lib/calendar/location-search-types";
import { readCalendarLocationSearch, searchCalendarLocation } from "@/lib/calendar/location-search";
import { calendarPrivateHeaders, calendarImportHttpError, calendarWrongTrip, readCalendarImportJson } from "@/lib/calendar/import-http";

export const maxDuration = 95;
export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig(); requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params; if (tripId !== session.tripId) return calendarWrongTrip();
    const input = calendarLocationSearchInput.parse(await readCalendarImportJson(request));
    return NextResponse.json(await searchCalendarLocation(getPool(config), config, session, input), { headers: calendarPrivateHeaders });
  } catch (error) { return calendarImportHttpError(error); }
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig(); const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params; if (tripId !== session.tripId) return calendarWrongTrip();
    const id = z.uuid().parse(request.nextUrl.searchParams.get("requestId"));
    return NextResponse.json(await readCalendarLocationSearch(getPool(config), config, session, id), { headers: calendarPrivateHeaders });
  } catch (error) { return calendarImportHttpError(error); }
}
