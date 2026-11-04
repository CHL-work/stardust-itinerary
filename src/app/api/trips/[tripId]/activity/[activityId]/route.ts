import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/app/http";
import { AppForbiddenError, AppNotFoundError, getApprovalHistory } from "@/lib/app/repository";
import { loadActivityEntries } from "@/lib/app/activity-repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string; activityId: string }> }) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, activityId } = z.object({ tripId: z.uuid(), activityId: z.uuid() }).parse(await params);
    if (session.role !== "owner" || session.tripId !== tripId) throw new AppForbiddenError("Owner access is required.");
    const client = await getPool(config).connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const [entry] = await loadActivityEntries(client, session, { activityId });
      if (!entry) throw new AppNotFoundError("This activity is unavailable.");
      const page = entry.target?.kind === "request"
        ? await getApprovalHistory(client, session, tripId, undefined, entry.target.id) : null;
      // Reuse the authorized history display, not its internal/raw proposal patch.
      const history = page?.requests[0];
      const result = { entry, request: history ? { ...history, patch: {} } : null };
      await client.query("COMMIT");
      return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
