import { NextRequest, NextResponse } from "next/server";

import { resetAiConversation, resumeAiConversation } from "@/lib/ai/conversation";
import { aiConversationActionSchema } from "@/lib/app/validation";
import { AppInvalidInputError } from "@/lib/app/repository";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

const noStoreHeaders = { "cache-control": "no-store" };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    const { tripId } = await params;
    if (session.tripId !== tripId) {
      return NextResponse.json(
        { error: "This trip is not available to the current member." },
        { status: 403, headers: noStoreHeaders },
      );
    }

    const text = await request.text();
    let body: unknown = { action: "new" };
    if (text.trim()) {
      try { body = JSON.parse(text); } catch { throw new AppInvalidInputError("The conversation action is invalid."); }
    }
    const action = aiConversationActionSchema.parse(body);
    const result = action.action === "resume"
      ? await resumeAiConversation(getPool(config), session, tripId, action.conversationId)
      : await resetAiConversation(getPool(config), session, tripId);
    return NextResponse.json({ ...result, ...(action.action === "new" ? { reset: true } : {}) }, { headers: noStoreHeaders });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
