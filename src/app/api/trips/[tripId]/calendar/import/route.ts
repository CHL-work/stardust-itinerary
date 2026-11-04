import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { commitCalendarImport } from "@/lib/calendar/import-repository";
import { calendarImportInputSchema } from "@/lib/calendar/import-contracts";
import { calendarPrivateHeaders, calendarImportHttpError, calendarWrongTrip, readCalendarImportJson } from "@/lib/calendar/import-http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig(); requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params; if (tripId !== session.tripId) return calendarWrongTrip();
    const input = calendarImportInputSchema.parse(await readCalendarImportJson(request));
    return NextResponse.json(await commitCalendarImport(getPool(config), config, session, tripId, input), { headers: calendarPrivateHeaders });
  } catch (error) { return calendarImportHttpError(error); }
}
