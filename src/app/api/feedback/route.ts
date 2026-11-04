import { NextRequest, NextResponse } from "next/server";
import { assertNotGuest } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { feedbackSubmissionSchema } from "@/lib/feedback/contracts";
import { listSelfFeedback, submitFeedback } from "@/lib/feedback/repository";
import { feedbackApiError, feedbackPrivateHeaders, readFeedbackJson } from "@/lib/feedback/http";

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    // Anonymous guests cannot send reports, which can become public GitHub issues (JOB-064).
    assertNotGuest(session, "send feedback");
    const input = feedbackSubmissionSchema.parse(await readFeedbackJson(request));
    const result = await submitFeedback(getPool(config), session, input, config.authSecret);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: feedbackPrivateHeaders });
  } catch (error) { return feedbackApiError(error); }
}
export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    return NextResponse.json({ reports: await listSelfFeedback(getPool(config), session) }, { headers: feedbackPrivateHeaders });
  } catch (error) { return feedbackApiError(error); }
}
