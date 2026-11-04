import { describe, expect, it } from "vitest";

import {
  countdownParts,
  itemsForTripDay,
  nextUpcomingItem,
  pickCurrentTripDay,
  shiftTripDay,
  tripLocalDateKey,
} from "./day-view";

const days = [
  { id: "day-1", date: "2026-08-28" },
  { id: "day-2", date: "2026-08-29" },
  { id: "day-3", date: "2026-08-30" },
];

describe("day view selection", () => {
  it("uses the trip-local date and falls forward or back outside the trip", () => {
    expect(tripLocalDateKey("2026-08-28T16:30:00Z", "Asia/Tokyo")).toBe("2026-08-29");
    expect(pickCurrentTripDay(days, "Asia/Tokyo", new Date("2026-08-28T16:30:00Z"))?.id).toBe("day-2");
    expect(pickCurrentTripDay(days, "Asia/Tokyo", new Date("2026-08-20T00:00:00Z"))?.id).toBe("day-1");
    expect(pickCurrentTripDay(days, "Asia/Tokyo", new Date("2026-09-20T00:00:00Z"))?.id).toBe("day-3");
  });

  it("moves one day at a time without wrapping at trip boundaries", () => {
    expect(shiftTripDay(days, "2026-08-29", -1)?.id).toBe("day-1");
    expect(shiftTripDay(days, "2026-08-29", 1)?.id).toBe("day-3");
    expect(shiftTripDay(days, "2026-08-28", -1)).toBeNull();
    expect(shiftTripDay(days, "2026-08-30", 1)).toBeNull();
  });
});

describe("day view events", () => {
  const items = [
    { id: "past", tripDayId: "day-2", startsAt: "2026-08-29T01:00:00Z", status: "planned" },
    { id: "later", tripDayId: "day-2", startsAt: "2026-08-29T05:00:00Z", status: "planned" },
    { id: "next", tripDayId: "day-2", startsAt: "2026-08-29T03:00:00Z", status: "planned" },
    { id: "cancelled", tripDayId: "day-2", startsAt: "2026-08-29T02:30:00Z", status: "cancelled" },
    { id: "other-day", tripDayId: "day-3", startsAt: "2026-08-30T02:00:00Z", status: "planned" },
  ];

  it("filters the overview list to the selected trip day", () => {
    expect(itemsForTripDay(items, "day-2").map((item) => item.id)).toEqual(["past", "later", "next", "cancelled"]);
  });

  it("selects the nearest non-cancelled future event", () => {
    const selected = nextUpcomingItem(itemsForTripDay(items, "day-2"), new Date("2026-08-29T02:00:00Z").getTime());
    expect(selected?.id).toBe("next");
  });

  it("calculates a rounded-up countdown", () => {
    expect(countdownParts(new Date("2026-08-30T04:05:01Z").getTime(), new Date("2026-08-29T02:00:00Z").getTime()))
      .toEqual({ days: 1, hours: 2, minutes: 6 });
    expect(countdownParts(100, 100)).toBeNull();
  });
});
