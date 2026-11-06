import { NextRequest, NextResponse } from "next/server";

import { adminSignupLimitSchema } from "@/lib/admin/contracts";
import { adminError, adminHeaders } from "@/lib/admin/http";
import { setSignupDailyLimit } from "@/lib/admin/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/** Set the daily cap on new public sign-ups (`null` removes it, `0` pauses sign-ups), for the operator only. */
export async function PUT(request: NextRequest) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { dailyLimit } = adminSignupLimitSchema.parse(await request.json());
    return NextResponse.json(await setSignupDailyLimit(getPool(config), session, dailyLimit), { headers: adminHeaders });
  } catch (error) { return adminError(error); }
}
