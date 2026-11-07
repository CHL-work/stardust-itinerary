import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { withAiRequestSlot } from "@/lib/ai/concurrency";
import { runAiPlanner } from "@/lib/ai/planner";
import { prepareAiImages, readAiRequestJson } from "@/lib/ai/image-input";
import { AiConversationChangedError } from "@/lib/ai/conversation";
import { readAiRequestRecovery } from "@/lib/ai/request-recovery";
import { aiProviderFailureDetails } from "@/lib/ai/provider-failure";
import { apiError } from "@/lib/app/http";
import { AppInvalidInputError, assertNotGuest } from "@/lib/app/repository";
import { GUEST_FREE_MODEL } from "@/lib/app/types";
import { aiRequestSchema, aiRecoveryQuerySchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export const maxDuration = 300;

const noStoreHeaders = { "cache-control": "no-store" };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const requestId = randomUUID();
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    if (session.tripId !== tripId) {
      return NextResponse.json(
        { error: "This trip is not available to the current member." },
        { status: 403, headers: { ...noStoreHeaders, "x-request-id": requestId } },
      );
    }
    const body = aiRequestSchema.parse(await readAiRequestJson(request));
    // Reject an explicit text-only choice before image decoding/normalization or planner work.
    if (body.model === GUEST_FREE_MODEL && body.images?.length) {
      throw new AppInvalidInputError("Free AI accepts text only. Remove the pictures or choose a model on your own key.");
    }
    // Pictures are stored until the guest is purged; free accounts could fill the database (JOB-064).
    if (body.images?.length) assertNotGuest(session, "attach pictures");
    if (body.conversationId === undefined) throw new AiConversationChangedError();
    const images = await prepareAiImages(body.images);
    // Provider CLIs run in this pod: past the per-process cap, refuse with a retry delay (429).
    const result = await withAiRequestSlot(() => body.freeModel
      ? runAiPlanner(getPool(config), session, body.prompt, body.model, body.locale,
        body.clientRequestId, body.conversationId, images, body.freeModel)
      : runAiPlanner(getPool(config), session, body.prompt, body.model, body.locale,
        body.clientRequestId, body.conversationId, ...(images.length ? [images] as const : [])));
    return NextResponse.json(result, {
      headers: { ...noStoreHeaders, "x-request-id": requestId },
    });
  } catch (error) {
    const providerFailure = aiProviderFailureDetails(error);
    const imageCode = error instanceof Error && ["AI_IMAGE_INVALID", "AI_IMAGE_EXTRACTION_FAILED"].includes(error.name) ? error.name : null;
    const providerStatus = providerFailure?.code === "AI_PROVIDER_RATE_LIMITED" ? 429
      : providerFailure?.code === "AI_PROVIDER_MODEL_UNAVAILABLE" || providerFailure?.code === "AI_PROVIDER_OUTPUT_INVALID" ? 502 : 503;
    const response = providerFailure ? NextResponse.json({ error: providerFailure.code, code: providerFailure.code, providerFailure },
      { status: providerStatus }) : imageCode ? NextResponse.json({ error: imageCode, code: imageCode },
      { status: imageCode === "AI_IMAGE_INVALID" ? 400 : 502 }) : apiError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-request-id", requestId);
    if (response.status >= 500) {
      console.error("AI HTTP request failed", {
        requestId,
        errorName: providerFailure?.code ?? (error instanceof Error ? error.name : typeof error),
      });
    }
    return response;
  }
}

/** Self-only result delivery; reading never starts or retries provider work. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    if (session.tripId !== tripId) {
      return NextResponse.json({ error: "This trip is not available to the current member." }, { status: 403, headers: noStoreHeaders });
    }
    const query = aiRecoveryQuerySchema.parse({
      clientRequestId: request.nextUrl.searchParams.get("clientRequestId") ?? undefined,
    });
    return NextResponse.json(
      await readAiRequestRecovery(getPool(config), session, tripId, query.clientRequestId),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    const response = apiError(error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
