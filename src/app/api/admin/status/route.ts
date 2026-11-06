import { NextRequest, NextResponse } from "next/server";

import { adminError, adminHeaders } from "@/lib/admin/http";
import { adminAccess } from "@/lib/admin/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/** Whether the signed-in account may open the admin page, so Settings shows its entry only to the operator. */
export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    return NextResponse.json({ operator: await adminAccess(getPool(config), session) }, { headers: adminHeaders });
  } catch (error) { return adminError(error); }
}
