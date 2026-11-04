import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { updateAiSettings } from "@/lib/app/repository";
import { aiSettingsSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const body = aiSettingsSchema.parse(await request.json());
    await updateAiSettings(getPool(config), session, tripId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
