import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { enforceRateLimit, previewJoinLink } from "@/lib/auth/repository";
import { authCookieNames, requestRateLimitKey, requireSameOrigin, secureCookie } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

const joinIntentSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export async function POST(request: NextRequest) {
  const config = getAuthConfig();
  requireSameOrigin(request, config);
  const parsed = joinIntentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid invitation." }, { status: 400 });
  }

  const pool = getPool(config);
  await enforceRateLimit(pool, config, {
    scope: "join-preview",
    key: requestRateLimitKey(request),
    maximum: 20,
    windowSeconds: 300,
  });
  const invitation = await previewJoinLink(pool, config, parsed.data.token);
  if (!invitation) {
    return NextResponse.json({ error: "Invitation unavailable." }, { status: 410 });
  }

  const response = NextResponse.json(
    { accepted: true },
    { headers: { "cache-control": "no-store" } },
  );
  response.cookies.set(authCookieNames.joinIntent, parsed.data.token, {
    httpOnly: true,
    secure: secureCookie(config),
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
    priority: "high",
  });
  response.cookies.delete(authCookieNames.claimIntent);
  return response;
}
