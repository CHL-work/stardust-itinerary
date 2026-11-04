import { NextRequest, NextResponse } from "next/server";
import { listAiConversationMessages } from "@/lib/ai/conversation-history";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string; conversationId: string }> }) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, conversationId } = await params;
    if (session.tripId !== tripId) return NextResponse.json({ error: "This trip is not available to the current member." },
      { status: 403, headers: { "cache-control": "no-store" } });
    return NextResponse.json(await listAiConversationMessages(getPool(config), session, tripId, conversationId,
      request.nextUrl.searchParams.get("cursor") ?? undefined), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
