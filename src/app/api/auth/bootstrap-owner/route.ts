import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { issueClaim } from "@/lib/auth/repository";
import { buildClaimUrl, constantTimeSecretMatches } from "@/lib/auth/tokens";
import { getPool } from "@/lib/db/pool";

const bootstrapSchema = z.object({
  tripId: z.uuid(),
  memberId: z.uuid(),
});

export async function POST(request: NextRequest) {
  const config = getAuthConfig();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (
    !config.ownerBootstrapSecret ||
    !constantTimeSecretMatches(config.ownerBootstrapSecret, provided)
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const parsed = bootstrapSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid bootstrap request." }, { status: 400 });
  }
  const claim = await issueClaim(getPool(config), config, {
    ...parsed.data,
    actorMemberId: null,
  });
  return NextResponse.json(
    {
      claimUrl: buildClaimUrl(config.appBaseUrl, claim.rawToken),
      expiresAt: claim.expiresAt,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
