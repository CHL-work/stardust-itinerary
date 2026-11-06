import { NextRequest, NextResponse } from "next/server";

import { adminAccountQuerySchema } from "@/lib/admin/contracts";
import { adminError, adminHeaders } from "@/lib/admin/http";
import { listAdminAccounts } from "@/lib/admin/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

/** A page of accounts, most recently active first, for the operator only. */
export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const params = request.nextUrl.searchParams;
    const query = adminAccountQuerySchema.parse({
      filter: params.get("filter") ?? undefined, q: params.get("q") ?? undefined, offset: params.get("offset") ?? undefined,
    });
    return NextResponse.json(await listAdminAccounts(getPool(config), session, query), { headers: adminHeaders });
  } catch (error) { return adminError(error); }
}
