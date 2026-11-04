import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { createTripMember } from "@/lib/app/repository";
import { createMemberSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const member = await createTripMember(
      getPool(config),
      session,
      tripId,
      createMemberSchema.parse(await request.json()),
    );
    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
