import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/app/http";
import { memberPaymentActionSchema, updateMemberPayment } from "@/lib/app/member-payments";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tripId: string; paymentId: string }> }) {
  let response: NextResponse;
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, paymentId } = await params;
    z.uuid().parse(tripId);
    z.uuid().parse(paymentId);
    const input = memberPaymentActionSchema.parse(await request.json());
    response = NextResponse.json(await updateMemberPayment(getPool(config), session, tripId, paymentId, input));
  } catch (error) { response = apiError(error); }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
