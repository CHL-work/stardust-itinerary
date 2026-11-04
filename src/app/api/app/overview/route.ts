import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { getAppOverview } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const overview = await getAppOverview(getPool(config), session);
    const projectNumber = /^(\d+)-/.exec(config.googleClientId)?.[1];
    const calendar = overview.calendar as Record<string, unknown>;
    return NextResponse.json({
      ...overview,
      calendar: {
        ...calendar,
        setupUrl: projectNumber
          ? `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=${projectNumber}`
          : "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
