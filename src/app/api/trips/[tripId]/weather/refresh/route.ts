import { after, NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { assertTrip } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { refreshTripWeather } from "@/lib/weather/repository";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    assertTrip(session, tripId);
    after(async () => {
      await refreshTripWeather(getPool(config), session, tripId).catch(() => {
        // Weather refresh is best-effort and writes a bounded run result when
        // provider calls fail. Never hold the user's page response open.
      });
    });
    return NextResponse.json({ status: "scheduled" }, {
      status: 202,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
