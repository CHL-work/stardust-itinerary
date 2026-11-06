import { NextRequest, NextResponse } from "next/server";

import { adminAccountId, adminError, adminHeaders } from "@/lib/admin/http";
import { adminAccountDetail } from "@/lib/admin/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

type Context = { params: Promise<{ userId: string }> };

/** One account's activity: sessions, trip sizes, daily counts and recent actions, for the operator only. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const userId = adminAccountId((await params).userId);
    return NextResponse.json(await adminAccountDetail(getPool(config), session, userId), { headers: adminHeaders });
  } catch (error) { return adminError(error); }
}
