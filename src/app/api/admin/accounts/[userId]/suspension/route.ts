import { NextRequest, NextResponse } from "next/server";

import { adminSuspensionSchema } from "@/lib/admin/contracts";
import { adminAccountId, adminError, adminHeaders } from "@/lib/admin/http";
import { setAccountSuspension } from "@/lib/admin/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

type Context = { params: Promise<{ userId: string }> };

/** Suspend (`{ "suspended": true }`) or restore an account, for the operator only. */
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const userId = adminAccountId((await params).userId);
    const { suspended } = adminSuspensionSchema.parse(await request.json());
    return NextResponse.json({ account: await setAccountSuspension(getPool(config), session, userId, suspended) }, { headers: adminHeaders });
  } catch (error) { return adminError(error); }
}
