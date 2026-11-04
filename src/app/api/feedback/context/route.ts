import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { getFeedbackContext } from "@/lib/feedback/repository";
import { feedbackApiError, feedbackPrivateHeaders } from "@/lib/feedback/http";

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    return NextResponse.json(await getFeedbackContext(getPool(config), session, config.authSecret), { headers: feedbackPrivateHeaders });
  } catch (error) { return feedbackApiError(error); }
}
