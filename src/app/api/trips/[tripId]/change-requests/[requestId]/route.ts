import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import {
  getPendingItineraryRequestForEdit,
  reviewChangeRequest,
  updatePendingItineraryRequest,
} from "@/lib/app/repository";
import { pendingItineraryEditSchema, reviewRequestSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; requestId: string }> },
) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, requestId } = await params;
    const result = await getPendingItineraryRequestForEdit(
      getPool(config),
      session,
      tripId,
      requestId,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; requestId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, requestId } = await params;
    const body = reviewRequestSchema.parse(await request.json());
    const result = await reviewChangeRequest(
      getPool(config),
      session,
      tripId,
      requestId,
      body.decision,
      body.note,
      body.proposalRevision,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; requestId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, requestId } = await params;
    const body = pendingItineraryEditSchema.parse(await request.json());
    const result = await updatePendingItineraryRequest(
      getPool(config),
      session,
      tripId,
      requestId,
      body,
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
