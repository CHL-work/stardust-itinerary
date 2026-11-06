import { NextRequest, NextResponse } from "next/server";

import { adminError, adminHeaders } from "@/lib/admin/http";
import { adminOverview } from "@/lib/admin/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/** Instance-wide totals and the last 14 days, for the operator only. */
export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    return NextResponse.json(await adminOverview(getPool(config), session), { headers: adminHeaders });
  } catch (error) { return adminError(error); }
}
