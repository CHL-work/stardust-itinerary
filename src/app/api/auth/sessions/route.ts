import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { listSessions, revokeSession } from "@/lib/auth/repository";
import {
  clearSessionCookie,
  requireAuthenticatedSession,
  requireSameOrigin,
} from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

const revokeSchema = z.object({ sessionId: z.uuid() });

export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  const session = await requireAuthenticatedSession(request, config);
  const devices = await listSessions(getPool(config), session.userId, session.sessionId);
  return NextResponse.json({ devices });
}

export async function DELETE(request: NextRequest) {
  const config = getAuthConfig();
  requireSameOrigin(request, config);
  const session = await requireAuthenticatedSession(request, config);
  const parsed = revokeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid session identifier." }, { status: 400 });
  }
  await revokeSession(getPool(config), parsed.data.sessionId, session.userId);
  const response = NextResponse.json({ revoked: true });
  if (parsed.data.sessionId === session.sessionId) {
    clearSessionCookie(response, config);
  }
  return response;
}
