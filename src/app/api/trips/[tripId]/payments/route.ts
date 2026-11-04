import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/app/http";
import { createMemberPayment, memberPaymentCreateSchema } from "@/lib/app/member-payments";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  let response: NextResponse;
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    z.uuid().parse(tripId);
    const input = memberPaymentCreateSchema.parse(await request.json());
    response = NextResponse.json(await createMemberPayment(getPool(config), session, tripId, input), { status: 201 });
  } catch (error) { response = apiError(error); }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
