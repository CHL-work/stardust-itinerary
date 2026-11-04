import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/app/http";
import { AppInvalidInputError } from "@/lib/app/repository";
import { runTripDestinationLookup } from "@/lib/app/trip-destination-service";
import { accountCookieName, verifyAccountOnboarding } from "@/lib/auth/account-session";
import { getAuthConfig } from "@/lib/auth/config";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { authenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { locales } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const lookupInput = z.object({ destination: z.string().trim().min(2).max(160),
  locale: z.enum(locales), requestId: z.uuid() }).strict();

async function readInput(request: NextRequest): Promise<unknown> {
  const invalid = () => new AppInvalidInputError("The destination lookup input is invalid.");
  const length = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    || (length !== null && (!/^\d+$/u.test(length) || Number(length) > 4096)) || !request.body) throw invalid();
  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const chunks: Uint8Array[] = [];
  let size = 0;
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw invalid();
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw invalid();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw invalid();
      chunks.push(part.value);
    }
    if (length !== null && Number(length) !== size) throw invalid();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { cancel(); throw invalid(); }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const pool = getPool(config);
    const principal = await authenticatedSession(request, config)
      ?? await verifyAccountOnboarding(pool, config, request.cookies.get(accountCookieName)?.value);
    if (!principal) throw new SessionUnavailableError("Sign in with Google before looking up a trip destination.");
    const input = lookupInput.parse(await readInput(request));
    const result = await runTripDestinationLookup(pool, config, principal, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    const result = apiError(error);
    result.headers.set("Cache-Control", "no-store, private");
    return result;
  }
}
