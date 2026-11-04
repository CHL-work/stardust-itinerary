import { describe, expect, it } from "vitest";
import { calendarEventCanImport, projectCalendarAwareTimelinePoints, projectPersonalCalendarEvents, type PersonalCalendarEvent } from "./timeline";

const event: PersonalCalendarEvent = { id: "synthetic-source", title: "Synthetic appointment", startsAt: "2030-04-01T14:00:00Z", endsAt: "2030-04-01T16:00:00Z", location: "Synthetic venue", htmlLink: null, linkedItineraryItemId: null };
const dates = ["2030-04-01", "2030-04-02", "2030-04-03"];
const project = (value: Partial<PersonalCalendarEvent> = {}, days = dates, zone = "Asia/Tokyo") => projectPersonalCalendarEvents([{ ...event, ...value }], days, zone);

describe("personal Calendar half-open day projection", () => {
  it("shows an overnight source on both local dates with one logical action owner", () => {
    expect(project().map(({ date, continued, ownsActions }) => ({ date, continued, ownsActions }))).toEqual([
      { date: dates[0], continued: false, ownsActions: true }, { date: dates[1], continued: true, ownsActions: false },
    ]);
    expect(project({}, [dates[1]])[0]).toMatchObject({ continued: true, ownsActions: true });
  });
  it("does not include the exclusive midnight endpoint", () => {
    expect(project({ endsAt: "2030-04-01T15:00:00Z" }).map((point) => point.date)).toEqual([dates[0]]);
  });
  it("uses actual trip-local dates across a DST transition, not fixed 24-hour windows", () => {
    const points = project({ startsAt: "2030-03-10T05:30:00Z", endsAt: "2030-03-11T05:00:00Z" }, ["2030-03-09", "2030-03-10", "2030-03-11"], "America/Chicago");
    expect(points.map((point) => point.date)).toEqual(["2030-03-09", "2030-03-10"]);
  });
  it.each(["Asia/Tokyo", "America/Chicago"])("retains date-only all-day ranges in %s without UTC-to-local shift", (zone) => {
    const points = project({ allDay: true, startsAt: null, endsAt: null, startDate: dates[0], endDateExclusive: dates[2] }, dates, zone);
    expect(points.map((point) => point.date)).toEqual(dates.slice(0, 2));
    expect(points.every((point) => point.allDay && point.at === null)).toBe(true);
  });
  it.each([
    { startsAt: null }, { startsAt: "invalid" }, { endsAt: "invalid" }, { endsAt: event.startsAt },
    { endsAt: "2030-03-31T00:00:00Z" }, { invalidTime: true },
    { allDay: true, startDate: "2030-02-30", endDateExclusive: "2030-03-02" },
    { allDay: true, startDate: dates[1], endDateExclusive: dates[1] },
  ])("does not invent a usable date from invalid source %j", (invalid) => { expect(project(invalid)).toEqual([]); });
  it("shows an unknown end only on its actual start day and excludes out-of-trip rows", () => {
    expect(project({ endsAt: null }).map((point) => point.date)).toEqual([dates[0]]);
    expect(project({}, [dates[2]])).toEqual([]);
  });
  it("deduplicates exact source IDs and preserves separate same-title sources", () => {
    const points = projectPersonalCalendarEvents([event, event, { ...event, id: "other-source" }], [dates[0]], "Asia/Tokyo");
    expect(points).toHaveLength(2);
    expect(new Set(points.map((point) => point.key)).size).toBe(2);
  });
  it.each(["pending", "approved", "cancelled", "removed"])("suppresses already represented %s sources", (status) => {
    expect(project({ importState: { status } })).toEqual([]);
    expect(calendarEventCanImport({ ...event, importState: { status } })).toBe(false);
  });
  it("suppresses exact canonical links regardless of title differences", () => {
    expect(project({ linkedItineraryItemId: "linked-item" })).toEqual([]);
  });
  it.each(["rejected", "invalidated"])("keeps %s outcome visible but not addable", (status) => {
    const points = project({ importState: { status } });
    expect(points.length).toBe(2);
    expect(calendarEventCanImport(points[0].event)).toBe(false);
  });
});

describe("imported all-day canonical and pending timeline metadata", () => {
  const tripDays = dates.map((date, index) => ({ id: `day-${index}`, date }));
  const item = { id: "imported", tripDayId: "day-0", status: "planned", itemType: "activity", startsAt: "2030-03-31T15:00:00Z", endsAt: "2030-04-02T15:00:00Z",
    sourceCalendar: { allDay: true, startDate: dates[0], endDateExclusive: dates[2] } };
  it.each(["planned", "pending"])("expands %s into date groups with stable unique keys and actions once", (status) => {
    const points = projectCalendarAwareTimelinePoints([{ ...item, status }], { tripDays, timeZone: "Asia/Tokyo" });
    expect(points.map((point) => point.tripDayId)).toEqual(["day-0", "day-1"]);
    expect(points.map((point) => point.ownsActions)).toEqual([true, false]);
    expect(new Set(points.map((point) => point.key)).size).toBe(2);
    expect(points.every((point) => point.item.startsAt === item.startsAt)).toBe(true);
  });
  it("does not change normal timed and transport endpoint semantics", () => {
    const timed = { ...item, sourceCalendar: null };
    const transport = { ...timed, id: "transport", itemType: "transport", departureLocationName: "Origin", destinationLocationName: "Destination" };
    const points = projectCalendarAwareTimelinePoints([timed, transport], { tripDays, timeZone: "Asia/Tokyo" });
    expect(points.map((point) => point.kind)).toEqual(["event", "departure", "arrival"]);
    expect(points.filter((point) => point.ownsActions)).toHaveLength(2);
  });
  it.each(["planned", "pending"])("keeps overnight %s imports visible after raw Calendar suppression", (status) => {
    const overnight = { ...item, status, startsAt: event.startsAt, endsAt: event.endsAt, sourceCalendar: { allDay: false, startDate: null, endDateExclusive: null } };
    const points = projectCalendarAwareTimelinePoints([overnight], { tripDays, timeZone: "Asia/Tokyo" });
    expect(points.map((point) => point.tripDayId)).toEqual(["day-0", "day-1"]);
    expect(points.map((point) => point.ownsActions)).toEqual([true, false]);
    expect(projectCalendarAwareTimelinePoints([{ ...overnight, endsAt: "2030-04-01T15:00:00Z" }], { tripDays, timeZone: "Asia/Tokyo" })).toHaveLength(1);
  });
});
