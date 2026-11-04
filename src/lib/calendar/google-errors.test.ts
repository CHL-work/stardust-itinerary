import { describe, expect, it } from "vitest";

import { createGoogleCalendarError } from "@/lib/calendar/repository";

describe("Google Calendar API errors", () => {
  it("turns an API-disabled 403 into an actionable local message", () => {
    const error = createGoogleCalendarError(403, {
      error: { errors: [{ reason: "accessNotConfigured" }] },
    });

    expect(error.status).toBe(403);
    expect(error.reason).toBe("accessNotConfigured");
    expect(error.message).toContain("Enable Google Calendar API");
  });

  it("asks for reconnection when Calendar permission is missing", () => {
    const error = createGoogleCalendarError(403, {
      error: { errors: [{ reason: "insufficientPermissions" }] },
    });

    expect(error.message).toContain("Reconnect Google Calendar");
  });
});
