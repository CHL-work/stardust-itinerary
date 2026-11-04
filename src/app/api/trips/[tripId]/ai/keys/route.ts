import { NextRequest, NextResponse } from "next/server";

import {
  AiCredentialRejectedError, aiCredentialInputSchema, aiCredentialProviders, AiKeysUnavailableError, deleteAiCredential,
  listAiCredentials, saveAiCredential,
} from "@/lib/ai/credentials";
import { apiError } from "@/lib/app/http";
import { AppInvalidInputError } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/**
 * The signed-in account's own AI provider keys. Responses carry only the provider, the last four
 * characters and timestamps; a key is never returned after it has been saved.
 */
type Context = { params: Promise<{ tripId: string }> };
const headers = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  const response = error instanceof AiCredentialRejectedError
    ? NextResponse.json({ error: error.message, code: "AI_KEY_REJECTED" }, { status: 400 })
    : error instanceof AiKeysUnavailableError
      ? NextResponse.json({ error: error.message, code: "AI_KEYS_UNAVAILABLE" }, { status: 403 })
      : apiError(error);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    return NextResponse.json({ keys: await listAiCredentials(getPool(config), session, tripId) }, { headers });
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const input = aiCredentialInputSchema.parse(await request.json());
    return NextResponse.json({ key: await saveAiCredential(getPool(config), session, tripId, input) }, { headers });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const provider = request.nextUrl.searchParams.get("provider");
    if (!aiCredentialProviders.includes(provider as never)) throw new AppInvalidInputError("Unknown provider.");
    await deleteAiCredential(getPool(config), session, tripId, provider as (typeof aiCredentialProviders)[number]);
    return new NextResponse(null, { status: 204, headers });
  } catch (error) { return failure(error); }
}
