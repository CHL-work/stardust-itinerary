import { describe, expect, it } from "vitest";

import { aiRecoveryReply, aiRecoveryStatusMessage, aiRequestFailureMessage, JsonRequestError } from "@/components/app-shell";
import type { AiRecoveryState } from "@/lib/ai/request-recovery-client";
import { locales, messages } from "@/lib/i18n";
import { aiImageMessages } from "@/lib/ai/image-i18n";

const idle: AiRecoveryState = { phase: "idle", request: null, result: null, error: null };

describe("AI mobile recovery language", () => {
  it.each(locales)("localizes a saved picture extraction failure in %s", (locale) => {
    const request = {
      requestId: "synthetic", clientRequestId: null, conversationId: "synthetic-conversation", status: "failed" as const,
      createdAt: "2030-04-01T00:00:00Z", completedAt: null, errorCode: "AI_IMAGE_EXTRACTION_FAILED", message: "Raw diagnostic", result: null,
    };
    expect(aiRecoveryReply({ ...idle, request }, messages[locale], aiImageMessages(locale))).toBe(aiImageMessages(locale).requestFailed);
  });
  it.each(locales)("uses %s for all recovery progress states", (locale) => {
    const copy = messages[locale];
    expect(aiRecoveryStatusMessage({ ...idle, phase: "checking" }, copy)).toBe(copy.aiRestoringRequest);
    expect(aiRecoveryStatusMessage({ ...idle, phase: "running" }, copy)).toBe(copy.aiProcessingInBackground);
    expect(aiRecoveryStatusMessage({ ...idle, phase: "reconnecting" }, copy)).toBe(copy.aiReconnectingRequest);
    expect(aiRecoveryStatusMessage({ ...idle, phase: "busy_elsewhere" }, copy)).toBe(copy.aiBusyInAnotherTrip);
    expect(aiRecoveryStatusMessage(idle, copy)).toBeNull();
  });

  it.each(locales)("shows safe %s timeout/interruption feedback rather than raw provider errors", (locale) => {
    const request = {
      requestId: "synthetic", clientRequestId: null, conversationId: "synthetic-conversation",
      status: "failed" as const, createdAt: "2030-04-01T00:00:00Z", completedAt: null,
      errorCode: "AbortError", message: "raw provider error must not display", result: null,
    };
    expect(aiRecoveryReply({ ...idle, request }, messages[locale])).toBe(messages[locale].aiRequestTimedOut);
    expect(aiRecoveryReply({ ...idle, request: { ...request, status: "interrupted" } }, messages[locale]))
      .toBe(messages[locale].aiRequestInterrupted);
    expect(aiRecoveryReply({ ...idle, request: { ...request, errorCode: "SecretProviderDiagnostic" } }, messages[locale]))
      .toBe(messages[locale].aiRequestFailed);
  });

  it.each(locales)("says in %s that a date is outside the trip, live or after reconnecting (JOB-100)", (locale) => {
    const copy = messages[locale];
    expect(copy.aiOutsideTrip).toBeTruthy();
    const conflict = new JsonRequestError("The event dates must be within the current trip dates.", 409, "TRIP_DATES_OUTSIDE");
    expect(aiRequestFailureMessage(conflict, copy)).toBe(copy.aiOutsideTrip);
    const planner = new JsonRequestError("AI proposal 2 references a day outside this trip.", 409, "TRIP_DATES_OUTSIDE");
    expect(aiRequestFailureMessage(planner, copy)).toBe(copy.aiOutsideTrip);
    const request = {
      requestId: "synthetic", clientRequestId: null, conversationId: "synthetic-conversation", status: "failed" as const,
      createdAt: "2030-04-01T00:00:00Z", completedAt: null, errorCode: "TRIP_DATES_OUTSIDE", message: "Raw diagnostic", result: null,
    };
    expect(aiRecoveryReply({ ...idle, request }, copy)).toBe(copy.aiOutsideTrip);
    if (locale !== "en") expect(copy.aiOutsideTrip).not.toBe(messages.en.aiOutsideTrip);
  });

  it("restores a legacy saved answer without inventing quota or memory metadata", () => {
    const request = {
      requestId: "synthetic", clientRequestId: null, conversationId: "synthetic-conversation",
      status: "succeeded" as const, createdAt: "2030-04-01T00:00:00Z", completedAt: "2030-04-01T00:00:20Z",
      errorCode: null, message: "Saved answer", result: null,
    };
    expect(aiRecoveryReply({ ...idle, request }, messages.en)).toBe("Saved answer");
  });
});
