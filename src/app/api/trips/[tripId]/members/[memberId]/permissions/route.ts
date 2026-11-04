import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { updateMemberPermissions } from "@/lib/app/repository";
import { memberPermissionsSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; memberId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, memberId } = await params;
    const permissions = memberPermissionsSchema.parse(await request.json());
    await updateMemberPermissions(getPool(config), session, tripId, memberId, permissions);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
