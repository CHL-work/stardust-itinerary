import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiError } from "@/lib/app/http";
import { FeedbackPolicyChangedError, FeedbackRateLimitError, FeedbackScopeChangedError } from "@/lib/feedback/repository";

export const feedbackPrivateHeaders = { "Cache-Control": "private, no-store" };
export async function readFeedbackJson(request: NextRequest): Promise<unknown> {
  const maximumBytes = 65_536;
  if (Number(request.headers.get("content-length")) > maximumBytes) throw new Error("FEEDBACK_BODY_INVALID");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("FEEDBACK_BODY_INVALID");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) { await reader.cancel(); throw new Error("FEEDBACK_BODY_INVALID"); }
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { throw new Error("FEEDBACK_BODY_INVALID"); }
  finally { reader.releaseLock(); }
}
export function feedbackApiError(error: unknown): NextResponse {
  // Older clients clear drafts on 409; this distinct precondition response keeps
  // their unconfirmed draft intact instead of silently changing consent.
  if (error instanceof FeedbackPolicyChangedError) return NextResponse.json({ error: error.message, code: "FEEDBACK_POLICY_CHANGED" }, { status: 428, headers: feedbackPrivateHeaders });
  if (error instanceof FeedbackScopeChangedError) return NextResponse.json({ error: error.message, code: "FEEDBACK_SCOPE_CHANGED" }, { status: 409, headers: feedbackPrivateHeaders });
  if (error instanceof ZodError || (error instanceof Error && error.message === "FEEDBACK_BODY_INVALID")) {
    return NextResponse.json({ error: "The feedback values are invalid.", code: "FEEDBACK_INVALID" }, { status: 400, headers: feedbackPrivateHeaders });
  }
  if (error instanceof FeedbackRateLimitError) {
    return NextResponse.json({ error: error.message, code: "FEEDBACK_RATE_LIMITED" },
      { status: 429, headers: { ...feedbackPrivateHeaders, "Retry-After": String(error.retryAfterSeconds) } });
  }
  if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
    return NextResponse.json({ error: "Feedback is temporarily unavailable.", code: "FEEDBACK_UNAVAILABLE" }, { status: 503, headers: feedbackPrivateHeaders });
  }
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
