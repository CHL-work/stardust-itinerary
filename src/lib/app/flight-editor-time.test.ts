import { describe, expect, it } from "vitest";
import { eventExpenseTimeFromStart, eventTimeInputsFromInstants, rebaseFlightTimeInputs } from "./flight-editor-time";
import { wallTimeToIso, ZonedEventTimeError } from "./zoned-event-time";

const flight = { itemType: "transport", title: "Flight AA123", flight: { flightNumber: "AA123" },
  departureLocationName: "Dallas Fort Worth (DFW)", destinationLocationName: "Salt Lake City (SLC)" };
const exact = { startsAt: "2026-09-11T15:00:12.345Z", endsAt: "2026-09-11T17:00:56.789Z" };

describe("linked expense date defaults from endpoint-local event starts", () => {
  it("converts a Dallas departure into the trip date and clock instead of copying its wall time", () => {
    const input = { startsAt: "2026-09-11T10:00", endsAt: "" };
    expect(eventExpenseTimeFromStart(input, flight, "Asia/Tokyo")).toBe("2026-09-12T00:00");
    expect(input).toEqual({ startsAt: "2026-09-11T10:00", endsAt: "" });
  });
  it("uses the preferred DST occurrence when translating an unchanged flight start", () => {
    const source = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "America/New_York" } };
    expect(eventExpenseTimeFromStart({ startsAt: "2026-11-01T01:30", endsAt: "",
      preferredStartsAt: "2026-11-01T06:30:12.345Z" }, source, "Asia/Tokyo")).toBe("2026-11-01T15:30");
  });
  it("keeps ordinary events and unidentified-airport flights in the trip clock", () => {
    const input = { startsAt: "2026-09-11T10:00", endsAt: "" };
    expect(eventExpenseTimeFromStart(input, { itemType: "meal" }, "Asia/Tokyo")).toBe(input.startsAt);
    expect(eventExpenseTimeFromStart(input, { ...flight, departureLocationName: "Unknown" }, "Asia/Tokyo"))
      .toBe(input.startsAt);
  });
  it.each(["", "not a time", "2026-03-08T02:30", "2026-11-01T01:30"])("leaves missing, invalid or unresolved start %s blank", (startsAt) => {
    const source = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "America/New_York" } };
    expect(eventExpenseTimeFromStart({ startsAt, endsAt: "" }, source, "Asia/Tokyo")).toBe("");
  });
});

describe("flight editor local time initialization", () => {
  it("opens each endpoint in its airport zone without losing stored precision", () => {
    const inputs = eventTimeInputsFromInstants({ ...flight, ...exact }, "Asia/Tokyo");
    expect(inputs).toEqual({ startsAt: "2026-09-11T10:00", endsAt: "2026-09-11T11:00",
      preferredStartsAt: exact.startsAt, preferredEndsAt: exact.endsAt });
    expect(wallTimeToIso(inputs.startsAt, "America/Chicago", inputs.preferredStartsAt)).toBe(exact.startsAt);
    expect(wallTimeToIso(inputs.endsAt, "America/Denver", inputs.preferredEndsAt)).toBe(exact.endsAt);
  });
  it("keeps missing ends unknown and generic transport in its endpoint zone", () => {
    const generic = { ...flight, flight: null, title: "Airport shuttle", startsAt: exact.startsAt, endsAt: null };
    expect(eventTimeInputsFromInstants(generic, "Asia/Tokyo")).toEqual({ startsAt: "2026-09-11T10:00", endsAt: "",
      preferredStartsAt: exact.startsAt, preferredEndsAt: null });
    expect(eventTimeInputsFromInstants({ ...flight, startsAt: null, endsAt: null }, "Asia/Tokyo"))
      .toEqual({ startsAt: "", endsAt: "", preferredStartsAt: null, preferredEndsAt: null });
  });
  it("uses the trip fallback for unidentified airports instead of guessing", () => {
    const unknown = { ...flight, departureLocationName: "Unknown departure", destinationLocationName: "Unknown arrival", ...exact };
    expect(eventTimeInputsFromInstants(unknown, "Asia/Tokyo"))
      .toMatchObject({ startsAt: "2026-09-12T00:00", endsAt: "2026-09-12T02:00" });
  });
});

describe("rebasing only the editor's clock representation", () => {
  it("changes both independent zones while retaining the exact instants across dates", () => {
    const input = eventTimeInputsFromInstants({ ...flight, ...exact }, "Asia/Tokyo");
    const after = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "UTC", arrivalTimeZone: "Asia/Tokyo" } };
    const next = rebaseFlightTimeInputs(input, flight, after, "Asia/Tokyo");
    expect(next).toEqual({ startsAt: "2026-09-11T15:00", endsAt: "2026-09-12T02:00",
      preferredStartsAt: exact.startsAt, preferredEndsAt: exact.endsAt });
    expect(input).toEqual(eventTimeInputsFromInstants({ ...flight, ...exact }, "Asia/Tokyo"));
    expect(wallTimeToIso(next.startsAt, "UTC", next.preferredStartsAt)).toBe(exact.startsAt);
    expect(wallTimeToIso(next.endsAt, "Asia/Tokyo", next.preferredEndsAt)).toBe(exact.endsAt);
  });
  it("changes an airport-derived arrival zone without changing the departure or duration", () => {
    const input = eventTimeInputsFromInstants({ ...flight, ...exact }, "Asia/Tokyo");
    const next = rebaseFlightTimeInputs(input, flight, { ...flight, destinationLocationName: "Haneda (HND)" }, "Asia/Tokyo");
    expect(next.startsAt).toBe(input.startsAt); expect(next.preferredStartsAt).toBe(exact.startsAt);
    expect(next.endsAt).toBe("2026-09-12T02:00"); expect(next.preferredEndsAt).toBe(exact.endsAt);
    expect(Date.parse(next.preferredEndsAt!) - Date.parse(next.preferredStartsAt!)).toBe(Date.parse(exact.endsAt) - Date.parse(exact.startsAt));
  });
  it("returns only time fields, never overwriting new identity, audience or expense edits", () => {
    const input = { ...eventTimeInputsFromInstants({ ...flight, ...exact }, "Asia/Tokyo"),
      title: "Original title", itemType: "transport", flight: { flightNumber: "AA123" },
      visibility: "private", viewerMemberIds: ["synthetic-viewer"], linkedExpense: { amount: "10" } };
    const before = structuredClone(input);
    const result = rebaseFlightTimeInputs(input, flight, flight, "Asia/Tokyo");
    expect(Object.keys(result).sort()).toEqual(["endsAt", "preferredEndsAt", "preferredStartsAt", "startsAt"]);
    expect(result).not.toHaveProperty("title"); expect(result).not.toHaveProperty("flight");
    expect(result).not.toHaveProperty("visibility"); expect(result).not.toHaveProperty("linkedExpense");
    expect(input).toEqual(before);
  });
  it("preserves both selected occurrences and seconds of a same-zone DST fold", () => {
    const before = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" } };
    const times = { startsAt: "2026-11-01T05:30:17.123Z", endsAt: "2026-11-01T06:30:41.789Z" };
    const input = eventTimeInputsFromInstants({ ...before, ...times }, "UTC");
    expect(input.startsAt).toBe(input.endsAt);
    const after = { ...before, flight: { flightNumber: "AA123", departureTimeZone: "UTC", arrivalTimeZone: "UTC" } };
    expect(rebaseFlightTimeInputs(input, before, after, "UTC")).toEqual({ startsAt: "2026-11-01T05:30", endsAt: "2026-11-01T06:30",
      preferredStartsAt: times.startsAt, preferredEndsAt: times.endsAt });
  });
  it("preserves elapsed chronology across a spring DST transition", () => {
    const before = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" } };
    const times = { startsAt: "2026-03-08T06:30:00.000Z", endsAt: "2026-03-08T08:30:00.000Z" };
    const input = eventTimeInputsFromInstants({ ...before, ...times }, "UTC");
    expect(input).toMatchObject({ startsAt: "2026-03-08T01:30", endsAt: "2026-03-08T04:30" });
    const after = { ...before, flight: { flightNumber: "AA123", departureTimeZone: "UTC", arrivalTimeZone: "UTC" } };
    const next = rebaseFlightTimeInputs(input, before, after, "UTC");
    expect(next).toMatchObject({ startsAt: "2026-03-08T06:30", endsAt: "2026-03-08T08:30" });
  });
  it("keeps instants when changing a flight to an ordinary event in the trip zone", () => {
    const input = eventTimeInputsFromInstants({ ...flight, ...exact }, "Asia/Tokyo");
    const next = rebaseFlightTimeInputs(input, flight, { itemType: "activity" }, "Asia/Tokyo");
    expect(next).toMatchObject({ startsAt: "2026-09-12T00:00", endsAt: "2026-09-12T02:00",
      preferredStartsAt: exact.startsAt, preferredEndsAt: exact.endsAt });
  });
  it("never fabricates an instant or an end for an unresolved fold, gap or absent time", () => {
    const before = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" } };
    const after = { ...before, flight: { flightNumber: "AA123", departureTimeZone: "UTC", arrivalTimeZone: "UTC" } };
    for (const startsAt of ["2026-11-01T01:30", "2026-03-08T02:30"]) {
      expect(() => rebaseFlightTimeInputs({ startsAt, endsAt: "" }, before, after, "UTC")).toThrow(ZonedEventTimeError);
    }
    expect(rebaseFlightTimeInputs({ startsAt: "", endsAt: "" }, before, after, "UTC"))
      .toMatchObject({ startsAt: "", endsAt: "" });
  });
  it("allows an explicit UTC correction by clearing only the unresolved endpoint", () => {
    const before = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" } };
    const after = { ...before, flight: { flightNumber: "AA123", departureTimeZone: "UTC", arrivalTimeZone: "UTC" } };
    for (const startsAt of ["2026-11-01T01:30", "2026-03-08T02:30"]) {
      const input = { startsAt, endsAt: "2026-11-01T03:30", preferredStartsAt: "2026-10-30T12:00:00Z",
        preferredEndsAt: "2026-11-01T08:30:56.789Z" };
      expect(rebaseFlightTimeInputs(input, before, after, "UTC", true)).toEqual({ startsAt: "", endsAt: "2026-11-01T08:30",
        preferredStartsAt: null, preferredEndsAt: input.preferredEndsAt });
      expect(input.startsAt).toBe(startsAt);
    }
  });
  it("clears an unresolved arrival without losing a valid selected departure occurrence", () => {
    const before = { ...flight, flight: { flightNumber: "AA123", departureTimeZone: "America/New_York", arrivalTimeZone: "America/New_York" } };
    const after = { ...before, flight: { flightNumber: "AA123", departureTimeZone: "UTC", arrivalTimeZone: "UTC" } };
    const input = { startsAt: "2026-11-01T01:30", endsAt: "2026-11-01T01:45",
      preferredStartsAt: "2026-11-01T05:30:12.345Z", preferredEndsAt: null };
    expect(rebaseFlightTimeInputs(input, before, after, "UTC", true)).toEqual({ startsAt: "2026-11-01T05:30", endsAt: "",
      preferredStartsAt: input.preferredStartsAt, preferredEndsAt: null });
  });
});
