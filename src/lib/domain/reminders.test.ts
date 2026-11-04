import { describe, expect, it } from "vitest";

import { calculateReminderSchedule } from "./reminders";

describe("calculateReminderSchedule", () => {
  it("moves a two-hour journey reminder before the two-hour boundary", () => {
    const result = calculateReminderSchedule({
      eventStart: new Date("2026-10-18T14:00:00+09:00"),
      routeDurationMinutes: 120,
      requiredBufferMinutes: 20,
      headsUpMinutes: 30,
    });

    expect(result.leaveBy.toISOString()).toBe("2026-10-18T02:40:00.000Z");
    expect(result.headsUpAt.toISOString()).toBe("2026-10-18T02:10:00.000Z");
  });

  it("uses a thirty-minute heads-up by default", () => {
    const result = calculateReminderSchedule({
      eventStart: new Date("2026-10-18T10:00:00Z"),
      routeDurationMinutes: 15,
      requiredBufferMinutes: 5,
    });

    expect(result.leaveBy.toISOString()).toBe("2026-10-18T09:40:00.000Z");
    expect(result.headsUpAt.toISOString()).toBe("2026-10-18T09:10:00.000Z");
  });

  it("rejects invalid durations instead of scheduling late", () => {
    expect(() =>
      calculateReminderSchedule({
        eventStart: new Date("2026-10-18T10:00:00Z"),
        routeDurationMinutes: -1,
        requiredBufferMinutes: 0,
      }),
    ).toThrow(/routeDurationMinutes/);
  });
});
