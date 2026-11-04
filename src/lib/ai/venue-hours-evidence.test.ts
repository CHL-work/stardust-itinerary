import { describe, expect, it } from "vitest";
import { assessReusableVenueHours, type VenueHoursEvidence } from "@/lib/ai/venue-hours-evidence";

const target = { key: "V1", venueName: "Synthetic Sakura Park, Tokyo", date: "2030-04-01", timeZone: "Asia/Tokyo" };
const hours: VenueHoursEvidence = { ...target, status: "hours_found", intervals: [{
  opensAt: "2030-04-01T09:00:00+09:00", closesAt: "2030-04-01T17:00:00+09:00", lastAdmissionAt: null,
}], sources: ["https://example.test/park"] };
const observed = new Set([target.key]);
const empty = { hoursEvidence: [], attemptedHoursTargets: [] };

describe("reusable dated venue-hours evidence", () => {
  it("retains exact structured source-backed evidence separately from its completed attempt", () => {
    expect(assessReusableVenueHours([target], [hours], observed)).toEqual({ hoursEvidence: [hours], attemptedHoursTargets: [target] });
  });
  it("retains supported closed dates without inventing opening or visit times", () => {
    const closed = { ...hours, status: "closed", intervals: [] };
    expect(assessReusableVenueHours([target], [closed], observed)).toEqual({ hoursEvidence: [closed], attemptedHoursTargets: [target] });
  });
  it("records an explicit valid unknown as a completed attempt, not as open/closed evidence", () => {
    expect(assessReusableVenueHours([target], [{ ...hours, status: "unknown", intervals: [], sources: [] }], observed))
      .toEqual({ hoursEvidence: [], attemptedHoursTargets: [target] });
  });
  it.each([undefined, null, {}, [], ["unknown"], [null]])("does not turn missing/invalid output into a completed attempt (%j)", (raw) => {
    expect(assessReusableVenueHours([target], raw, observed)).toEqual(empty);
  });
  it("requires observed search for this exact target including explicit unknown", () => {
    for (const row of [hours, { ...hours, status: "unknown", intervals: [], sources: [] }]) {
      expect(assessReusableVenueHours([target], [row], new Set())).toEqual(empty);
      expect(assessReusableVenueHours([target], [row], new Set(["V2"]))).toEqual(empty);
    }
  });
  it.each([{ venueName: "Other branch" }, { date: "2030-04-02" }, { timeZone: "UTC" },
    { date: "2030-02-30" }, { status: "open" }, { key: "V2" }, { notes: "private" },
    { sources: [] }, { sources: ["http://example.test/park"] }, { sources: ["https://localhost/park"] },
    { intervals: [] }])("does not bind invalid or unsupported evidence to the target %j", (override) => {
    expect(assessReusableVenueHours([target], [{ ...hours, ...override }], observed)).toEqual(empty);
  });
  it.each([
    { closesAt: "2030-04-01T08:00:00+09:00" }, { closesAt: "2030-04-04T09:00:00+09:00" },
    { opensAt: "2030-04-02T09:00:00+09:00", closesAt: "2030-04-02T17:00:00+09:00" },
    { opensAt: "2030-02-30T09:00:00+09:00" }, { lastAdmissionAt: undefined },
    { lastAdmissionAt: "2030-04-01T18:00:00+09:00" }, { opensAt: "2030-04-01T09:00:00" },
  ])("shares final deterministic interval rejection %j", (override) => {
    expect(assessReusableVenueHours([target], [{ ...hours, intervals: [{ ...hours.intervals[0], ...override }] }], observed)).toEqual(empty);
  });
  it("does not admit overlapping opening sessions", () => {
    expect(assessReusableVenueHours([target], [{ ...hours, intervals: [hours.intervals[0], hours.intervals[0]] }], observed)).toEqual(empty);
  });
  it("accepts supported split and prior-day overnight periods", () => {
    const evidence = { ...hours, intervals: [
      { opensAt: "2030-03-31T22:00:00+09:00", closesAt: "2030-04-01T02:00:00+09:00", lastAdmissionAt: "2030-04-01T01:00:00+09:00" },
      ...hours.intervals,
      { opensAt: "2030-04-01T19:00:00+09:00", closesAt: "2030-04-01T22:00:00+09:00", lastAdmissionAt: null },
    ] };
    expect(assessReusableVenueHours([target], [evidence], observed).hoursEvidence).toEqual([evidence]);
  });
  it("omits unsafe URLs without discarding a separate supported source", () => {
    expect(assessReusableVenueHours([target], [{ ...hours, sources: ["javascript:bad", ...hours.sources] }], observed).hoursEvidence).toEqual([hours]);
  });
  it("does not use malformed unknowns to suppress a future fallback", () => {
    expect(assessReusableVenueHours([target], [{ ...hours, status: "unknown" }], observed)).toEqual(empty);
    expect(assessReusableVenueHours([target], [{ ...hours, status: "unknown", intervals: [] }], observed)).toEqual(empty);
  });
  it("rejects duplicate/foreign envelopes and preserves independently omitted targets", () => {
    expect(assessReusableVenueHours([target], [hours, hours], observed)).toEqual(empty);
    expect(assessReusableVenueHours([target], [hours, { ...hours, key: "V3" }], observed)).toEqual(empty);
    const other = { ...target, key: "V2", venueName: "Synthetic Maple Museum" };
    expect(assessReusableVenueHours([target, other], [hours], new Set(["V1", "V2"]))).toEqual({ hoursEvidence: [hours], attemptedHoursTargets: [target] });
  });
});
