import { after, NextRequest, NextResponse } from "next/server";

import {
  AiCredentialRejectedError, AiKeyCheckError, aiCredentialInputSchema, aiCredentialProviders, aiKeyProtection, aiKeyUsage, AiKeysUnavailableError,
  deleteAiCredential, listAiCredentials, saveAiCredential,
} from "@/lib/ai/credentials";
import { claimRoutineAutoCheck, limitRoutineSearchChecks, runRoutineAutoCheck } from "@/lib/ai/preferences";
import type { Pool } from "pg";

import { apiError } from "@/lib/app/http";
import { AppInvalidInputError } from "@/lib/app/repository";
import { getAuthConfig, type AuthConfig } from "@/lib/auth/config";
import { RateLimitError } from "@/lib/auth/errors";
import { enforceRateLimit, type AuthenticatedSession } from "@/lib/auth/repository";
import { isGuestSession } from "@/lib/auth/guest-identity";
import { requireAuthenticatedSession, requireSameOrigin, trustedClientAddress } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/**
 * The signed-in account's own AI provider keys. Responses carry only the provider, the last four
 * characters and timestamps; a key is never returned after it has been saved. `protection` says how
 * this server stores new keys ("secret_manager", "kms", "local" or null), so Settings can tell the user.
 * A save also says whether it started the routine check's web search test (`routineCheck`, JOB-096).
 */
type Context = { params: Promise<{ tripId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Each save asks the provider about the key from this server's address. Bound how often one account,
// or one browser address, can do that, so the server cannot be used to test lists of leaked keys.
const KEY_CHECKS_PER_HOUR = { account: 10, address: 30 };
const GUEST_KEY_CHECKS_PER_DAY = 5;

function failure(error: unknown) {
  const response = error instanceof AiCredentialRejectedError
    ? NextResponse.json({ error: error.message, code: "AI_KEY_REJECTED" }, { status: 400 })
    : error instanceof AiKeyCheckError
      ? NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "AI_KEY_CONFIGURATION" ? 400 : 503 })
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
    return NextResponse.json({ keys, usage, protection: aiKeyProtection() }, { headers });
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
    await enforceRateLimit(pool, config, { scope: "ai-key-check", key: session.userId, userId: session.userId,
      maximum: KEY_CHECKS_PER_HOUR.account, windowSeconds: 3600 });
    await enforceRateLimit(pool, config, { scope: "ai-key-check-address", key: trustedClientAddress(request), userId: session.userId,
      maximum: KEY_CHECKS_PER_HOUR.address, windowSeconds: 3600 });
    // Free guest accounts must not multiply the allowance (JOB-064): a few checks per guest.
    if (isGuestSession(session)) {
      await enforceRateLimit(pool, config, { scope: "ai-key-check-guest", key: session.userId, userId: session.userId,
        maximum: GUEST_KEY_CHECKS_PER_DAY, windowSeconds: 86_400 });
    }
    const key = await saveAiCredential(pool, session, tripId, input);
    return NextResponse.json({ key, routineCheck: await startRoutineCheck(pool, config, session, tripId) }, { headers });
  } catch (error) { return failure(error); }
}

/**
 * A saved key turns routine checks on by itself once it passes a web search check (JOB-096, D-108). The
 * check runs after the response; the key stays saved whatever happens to it, and the AI tab shows progress.
 */
async function startRoutineCheck(pool: Pool, config: AuthConfig, session: AuthenticatedSession, tripId: string): Promise<"running" | "limited" | null> {
  try {
    const claim = await claimRoutineAutoCheck(pool, session, tripId, { beforeCheck: () => limitRoutineSearchChecks(pool, config, session) });
    if (!claim) return null;
    after(() => runRoutineAutoCheck(pool, session, tripId, claim).then(() => undefined,
      () => console.warn(JSON.stringify({ routineAutoCheck: { error: "finish" } }))));
    return "running";
  } catch (error) {
    if (error instanceof RateLimitError) return "limited";
    console.warn(JSON.stringify({ routineAutoCheck: { error: "start" } }));
    return null;
  }
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
