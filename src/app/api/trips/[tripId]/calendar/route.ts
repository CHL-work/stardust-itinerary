import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { listCalendarState } from "@/lib/calendar/repository";
import { getPool } from "@/lib/db/pool";
import { calendarPrivateHeaders, calendarImportHttpError, calendarWrongTrip } from "@/lib/calendar/import-http";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    if (session.tripId !== tripId) return calendarWrongTrip();
    return NextResponse.json(await listCalendarState(getPool(config), config, session), { headers: calendarPrivateHeaders });
  } catch (error) {
    return calendarImportHttpError(error);
  }
}
