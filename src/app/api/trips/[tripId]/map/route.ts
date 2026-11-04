import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/app/http";
import { AppForbiddenError, AppInvalidInputError, assertTrip, getAppOverview } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { isPlatformOperator } from "@/lib/auth/operator-access";
import { getPool } from "@/lib/db/pool";
import { dayMapInput, generateDayMap } from "@/lib/maps/service";
import { withMapAbort } from "@/lib/maps/google";

export const runtime = "nodejs";
export const maxDuration = 30;
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

async function readInput(request: NextRequest): Promise<unknown> {
  const invalid = () => new AppInvalidInputError("map_invalid_input");
  const length = request.headers.get("content-length");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")
    || (length && (!/^\d+$/u.test(length) || Number(length) > 2048)) || !request.body) throw invalid();
  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await withMapAbort(reader.read(), signal); if (part.done) break;
      size += part.value.byteLength;
      if (size > 2048) { void reader.cancel().catch(() => {}); throw invalid(); }
      chunks.push(part.value);
    }
  } catch { void reader.cancel().catch(() => {}); throw invalid(); }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalid(); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    assertTrip(session, z.uuid().parse(tripId));
    const parsed = dayMapInput.safeParse(await readInput(request));
    if (!parsed.success) throw new AppInvalidInputError("map_invalid_input");
    const loadOverview = async () => {
      const current = await requireAuthenticatedSession(request, config);
      if (current.sessionId !== session.sessionId || current.userId !== session.userId || current.memberId !== session.memberId
        || current.tripId !== session.tripId || current.generation !== session.generation || current.role !== session.role) throw new AppForbiddenError("map_forbidden");
      return getAppOverview(getPool(config), current);
    };
    // Trip ownership is not platform administration. Resolve this entitlement
    // from the stored verified Google identity after authentication and scoping.
    const bypassRequestQuota = await isPlatformOperator(getPool(config), session.userId);
    const result = await generateDayMap({ userId: session.userId, input: parsed.data, loadOverview, signal: request.signal, bypassRequestQuota });
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    const response = apiError(error);
    for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
    return response;
  }
}
