import { NextRequest, NextResponse } from "next/server";

import {
  AiCredentialRejectedError, aiCredentialInputSchema, aiCredentialProviders, aiKeyUsage, AiKeysUnavailableError, deleteAiCredential,
  listAiCredentials, saveAiCredential,
} from "@/lib/ai/credentials";
import { apiError } from "@/lib/app/http";
import { AppInvalidInputError } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { RateLimitError } from "@/lib/auth/errors";
import { enforceRateLimit } from "@/lib/auth/repository";
import { requestRateLimitKey, requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/**
 * The signed-in account's own AI provider keys. Responses carry only the provider, the last four
 * characters and timestamps; a key is never returned after it has been saved.
 */
type Context = { params: Promise<{ tripId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Each save asks the provider about the key from this server's address. Bound how often one account,
// or one browser address, can do that, so the server cannot be used to test lists of leaked keys.
const KEY_CHECKS_PER_HOUR = { account: 10, address: 30 };

function failure(error: unknown) {
  const response = error instanceof AiCredentialRejectedError
    ? NextResponse.json({ error: error.message, code: "AI_KEY_REJECTED" }, { status: 400 })
    : error instanceof AiKeysUnavailableError
      ? NextResponse.json({ error: error.message, code: "AI_KEYS_UNAVAILABLE" }, { status: 403 })
      : error instanceof RateLimitError
        ? NextResponse.json({ error: "Too many key checks. Try again later.", code: "AI_KEY_CHECKS_LIMITED" },
          { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } })
        : apiError(error);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const pool = getPool(config);
    const [keys, usage] = await Promise.all([listAiCredentials(pool, session, tripId), aiKeyUsage(pool, session, tripId)]);
    return NextResponse.json({ keys, usage }, { headers });
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const input = aiCredentialInputSchema.parse(await request.json());
    const pool = getPool(config);
    await enforceRateLimit(pool, config, { scope: "ai-key-check", key: session.userId,
      maximum: KEY_CHECKS_PER_HOUR.account, windowSeconds: 3600 });
    await enforceRateLimit(pool, config, { scope: "ai-key-check-address", key: requestRateLimitKey(request),
      maximum: KEY_CHECKS_PER_HOUR.address, windowSeconds: 3600 });
    return NextResponse.json({ key: await saveAiCredential(pool, session, tripId, input) }, { headers });
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
