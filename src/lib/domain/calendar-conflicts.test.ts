import { describe, expect, it } from "vitest";

import { findCalendarConflicts, type TimedCalendarEntry } from "@/lib/domain/calendar-conflicts";

const meal: TimedCalendarEntry = { id: "meal", title: "星空新宿 晚餐", itemType: "meal",
  location: "星空新宿", startsAt: "2030-04-01T10:00:00Z", endsAt: "2030-04-01T11:30:00Z" };
const appointment: TimedCalendarEntry = { id: "appointment", title: "Appointment",
  startsAt: "2030-04-01T11:00:00Z", endsAt: "2030-04-01T12:00:00Z" };
const stay: TimedCalendarEntry = { id: "stay", title: "Hotel Example", itemType: "lodging",
  startsAt: "2030-04-01T06:00:00Z", endsAt: "2030-04-05T02:00:00Z" };
const conflictsFor = (item: TimedCalendarEntry, event: TimedCalendarEntry) =>
  findCalendarConflicts([item], [event], new Map());

describe("calendar conflicts", () => {
  it("detects overlaps but excludes the linked copy of the same itinerary item", () => {
    const conflicts = findCalendarConflicts(
      [{ id: "museum", title: "Museum", startsAt: "2030-04-01T01:00:00Z", endsAt: "2030-04-01T03:00:00Z" }],
      [
        { id: "linked", title: "Museum", startsAt: "2030-04-01T01:00:00Z", endsAt: "2030-04-01T03:00:00Z" },
        { id: "dentist", title: "Dentist", startsAt: "2030-04-01T02:30:00Z", endsAt: "2030-04-01T04:00:00Z" },
      ],
      new Map([["museum", "linked"]]),
    );
    expect(conflicts).toEqual([{
      itineraryItemId: "museum",
      itineraryTitle: "Museum",
      calendarEventId: "dentist",
      calendarTitle: "Dentist",
    }]);
  });

  it("does not flag touching boundaries", () => {
    expect(findCalendarConflicts(
      [{ id: "a", title: "A", startsAt: "2030-04-01T01:00:00Z", endsAt: "2030-04-01T02:00:00Z" }],
      [{ id: "b", title: "B", startsAt: "2030-04-01T02:00:00Z", endsAt: "2030-04-01T03:00:00Z" }],
      new Map(),
    )).toEqual([]);
  });

  it("does not reserve the whole hotel stay or a note as attendance", () => {
    expect(conflictsFor(stay, appointment)).toEqual([]);
    expect(conflictsFor({ ...meal, itemType: "note" }, appointment)).toEqual([]);
    expect(conflictsFor(stay, { ...stay, id: "other-hotel" })).toEqual([]);
  });

  it.each(["Stay at Hotel Example", "Staying at Hotel Example", "Hotel reservation Example",
    "ホテル架空 宿泊", "架空酒店 住宿"])("recognizes explicit imported lodging: %s", (title) => {
    expect(conflictsFor(meal, { ...stay, itemType: undefined, title })).toEqual([]);
  });

  it.each(["Dinner at Hotel Example", "Meeting at Hotel Example", "Hotel Example",
    "Hotel reservation check-in", "酒店辦理入住", "Hotel conference", "Stay at Hotel Example — dinner"])(
    "does not turn a hotel appointment or unclear title into lodging: %s", (title) => {
      expect(conflictsFor(meal, { ...appointment, title })).toHaveLength(1);
    });

  it("trusts explicit canonical activity type instead of inferring a stay from its title", () => {
    expect(conflictsFor(meal, { ...appointment, itemType: "activity", title: "Stay at Hotel Example" })).toHaveLength(1);
  });

  it("uses the visible lodging type for both linked Google copies and source itinerary rows", () => {
    expect(findCalendarConflicts([meal, stay], [{ ...stay, id: "google-stay", itemType: undefined,
      title: "Translated booking" }], new Map([[stay.id, "google-stay"]]))).toEqual([]);
    expect(findCalendarConflicts([meal, stay], [{ ...stay, id: "old-google-stay", itemType: undefined,
      title: "Translated booking", linkedItineraryItemId: stay.id }], new Map())).toEqual([]);
  });

  it.each([{ transparency: "transparent" }, { selfDeclined: true },
    { eventType: "workingLocation" }, { eventType: "birthday" }])(
    "does not flag explicitly nonblocking Calendar metadata %j", (metadata) => {
      expect(conflictsFor(meal, { ...appointment, ...metadata })).toEqual([]);
    });

  it.each(["default", "fromGmail", "focusTime", "outOfOffice", "unknown"])(
    "retains other busy Google event types: %s", (eventType) => {
      expect(conflictsFor(meal, { ...appointment, eventType, transparency: "opaque", selfDeclined: false })).toHaveLength(1);
    });

  it("keeps opaque all-day obligations but excludes explicitly free all-day entries", () => {
    const allDay = { ...appointment, allDay: true, startsAt: "2030-04-01T00:00:00Z", endsAt: "2030-04-02T00:00:00Z" };
    expect(conflictsFor(meal, allDay)).toHaveLength(1);
    expect(conflictsFor(meal, { ...allDay, transparency: "transparent" })).toEqual([]);
  });

  it("recognizes matching imported flight number and start time despite translated titles", () => {
    const flight = { ...meal, itemType: "transport", title: "Example AIR XY184 — Airport A to B" };
    expect(conflictsFor(flight, { ...appointment, title: "Flight to TOKYO (XY 0184)", startsAt: meal.startsAt })).toEqual([]);
    expect(conflictsFor(flight, { ...appointment, title: "Flight to TOKYO (XY 185)", startsAt: meal.startsAt })).toHaveLength(1);
    expect(conflictsFor(flight, { ...appointment, title: "Flight to TOKYO (XY 184)" })).toHaveLength(1);
    expect(conflictsFor({ ...flight, title: "Train XY184" }, { ...appointment,
      title: "Flight XY184", startsAt: meal.startsAt })).toHaveLength(1);
  });

  it("matches an imported restaurant reservation only at the same named venue and start", () => {
    const reservation = { ...appointment, title: "Reservation at #星空新宿", startsAt: meal.startsAt };
    expect(conflictsFor(meal, reservation)).toEqual([]);
    expect(conflictsFor({ ...meal, title: "Dinner", location: "星空新宿" }, reservation)).toEqual([]);
    expect(conflictsFor(meal, { ...reservation, title: "Reservation at #星空池袋" })).toHaveLength(1);
    expect(conflictsFor(meal, { ...reservation, startsAt: "2030-04-01T10:30:00Z" })).toHaveLength(1);
    expect(conflictsFor({ ...meal, title: "Restaurant", location: null },
      { ...reservation, title: "Reservation at Restaurant" })).toHaveLength(1);
  });

  it("does not collapse distinct known canonical events using import heuristics", () => {
    expect(conflictsFor(meal, { ...appointment, title: "Reservation at #星空新宿",
      startsAt: meal.startsAt, linkedItineraryItemId: "another-item" })).toHaveLength(1);
  });

  it("excludes every linked self-copy and deduplicates other copies per itinerary item", () => {
    const other = { ...appointment, id: "other", itemType: "activity" };
    expect(findCalendarConflicts([meal, other], [
      { ...meal, id: "copy-1", linkedItineraryItemId: meal.id },
      { ...meal, id: "copy-2", linkedItineraryItemId: meal.id },
      { ...other, id: "copy-3", linkedItineraryItemId: other.id },
    ], new Map())).toEqual([
      expect.objectContaining({ itineraryItemId: meal.id, calendarEventId: "copy-3" }),
      expect.objectContaining({ itineraryItemId: other.id, calendarEventId: "copy-1" }),
    ]);
  });

  it("retains both directions of a cross-day linked conflict for date-filtered Overview", () => {
    const late = { ...meal, startsAt: "2030-04-01T14:30:00Z", endsAt: "2030-04-01T16:30:00Z" };
    const early = { ...appointment, startsAt: "2030-04-01T15:30:00Z", endsAt: "2030-04-01T17:00:00Z" };
    expect(findCalendarConflicts([late, early], [
      { ...late, id: "late-copy", linkedItineraryItemId: late.id },
      { ...early, id: "early-copy", linkedItineraryItemId: early.id },
    ], new Map()).map((value) => value.itineraryItemId)).toEqual([late.id, early.id]);
  });

  it("handles invalid or absent timestamps without inventing overlaps", () => {
    expect(conflictsFor(meal, { ...appointment, startsAt: "invalid" })).toEqual([]);
    expect(conflictsFor(meal, { ...appointment, endsAt: "invalid" })).toEqual([]);
    expect(conflictsFor(meal, { ...appointment, startsAt: null })).toEqual([]);
    expect(conflictsFor(meal, { ...appointment, endsAt: appointment.startsAt })).toEqual([]);
    expect(conflictsFor(meal, { ...appointment, endsAt: null })).toHaveLength(1);
    expect(conflictsFor(meal, { ...appointment, endsAt: null, invalidTime: true })).toEqual([]);
  });
});
