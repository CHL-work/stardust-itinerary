import { NextRequest, NextResponse } from "next/server";

import { aiInstructionsInputSchema } from "@/lib/ai/custom-instructions-contract";
import { getAiInstructions, saveAiInstructions } from "@/lib/ai/custom-instructions";
import { apiError } from "@/lib/app/http";
import { AppInvalidInputError } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

type Context = { params: Promise<{ tripId: string }> };
const headers = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    if (request.nextUrl.search) throw new AppInvalidInputError("Instructions are available only for the signed-in account.");
    const { tripId } = await params;
    return NextResponse.json(await getAiInstructions(getPool(config), session, tripId), { headers });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    if (request.nextUrl.search) throw new AppInvalidInputError("Instructions are available only for the signed-in account.");
    const { tripId } = await params;
    const input = aiInstructionsInputSchema.parse(await request.json());
    return NextResponse.json(await saveAiInstructions(getPool(config), session, tripId, input), { headers });
  } catch (error) { return failure(error); }
}
