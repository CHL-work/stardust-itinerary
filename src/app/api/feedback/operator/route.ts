import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { getFeedbackOperatorStatus, listOperatorFeedback } from "@/lib/feedback/repository";
import { feedbackApiError, feedbackPrivateHeaders } from "@/lib/feedback/http";

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    return NextResponse.json({ reports: await listOperatorFeedback(getPool(config), session), status: await getFeedbackOperatorStatus(getPool(config), session) }, { headers: feedbackPrivateHeaders });
  } catch (error) { return feedbackApiError(error); }
}
