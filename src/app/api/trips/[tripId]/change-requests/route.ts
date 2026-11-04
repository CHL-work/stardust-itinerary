import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/app/http";
import { applyPermittedChangeRequest, createChangeRequest, getApprovalHistory } from "@/lib/app/repository";
import { changeRequestSchema } from "@/lib/app/validation";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const result = await getApprovalHistory(
      getPool(config),
      session,
      tripId,
      request.nextUrl.searchParams.get("cursor"),
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    const body = changeRequestSchema.parse(await request.json());
    const pool = getPool(config);
    const created = await createChangeRequest(pool, session, tripId, {
      entityType: body.entityType,
      entityId: body.entityId,
      operation: body.operation,
      baseRevision: body.baseRevision,
      patch: body.patch,
      reason: body.reason,
      source: body.source,
    });
    if (body.applyNow) {
      const reviewed = await applyPermittedChangeRequest(pool, session, tripId, created.id);
      return NextResponse.json({ ...created, ...reviewed }, { status: 201 });
    }
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
