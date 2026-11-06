import { NextRequest, NextResponse } from "next/server";
import { assertNotGuest } from "@/lib/app/repository";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { feedbackSubmissionSchema } from "@/lib/feedback/contracts";
import { FeedbackRateLimitError, listSelfFeedback, submitFeedback } from "@/lib/feedback/repository";
import { recordRefusal } from "@/lib/admin/daily-counts";
import { feedbackApiError, feedbackPrivateHeaders, readFeedbackJson } from "@/lib/feedback/http";

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();
    requireSameOrigin(request, config);
    const session = await requireAuthenticatedSession(request, config);
    // Anonymous guests cannot send reports, which can become public GitHub issues (JOB-064).
    assertNotGuest(session, "send feedback");
    const input = feedbackSubmissionSchema.parse(await readFeedbackJson(request));
    const pool = getPool(config);
    const result = await submitFeedback(pool, session, input, config.authSecret).catch(async (error: unknown) => {
      // Refused reports show on the admin page (JOB-069).
      if (error instanceof FeedbackRateLimitError) await recordRefusal(pool, "feedback", session.userId);
      throw error;
    });
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
