import { describe, expect, it } from "vitest";

import { assessDisruptionEligibility, DISRUPTION_QUALIFICATION_POLICY_VERSION } from "@/lib/disruptions/eligibility";
import type { DisruptionAlert, DisruptionImpactAssessment, PublicDisruptionCandidate } from "@/lib/disruptions/types";

const now = new Date("2026-09-09T08:00:00Z");
const event: PublicDisruptionCandidate = {
  key: "E1", title: "Dinner at Example Bistro", itemType: "meal",
  startsAt: "2026-09-09T08:30:00Z", endsAt: "2026-09-09T09:30:00Z",
  locations: ["Example Bistro, Tokyo"], currentWarning: null,
};
const assessment: DisruptionImpactAssessment = {
  confidence: "high", sourceAuthority: "official", match: "exact_venue",
  effect: "unavailable", minimumDelayMinutes: null, affectedEntity: "Example Bistro",
  evidenceSummary: "The venue's dated notice says it is closed throughout the planned visit.",
  ongoing: false,
};
const alert: DisruptionAlert = {
  eventKey: "E1", state: "confirmed", reasonCode: "closure", severity: "warning",
  detail: "The venue is closed at the planned visit time.",
  sourceUrls: ["https://venue.example.com/notices/closure"],
  affectedFrom: "2026-09-09T07:00:00Z", affectedUntil: "2026-09-09T10:00:00Z",
  validForMinutes: 30, impactAssessment: assessment,
};
function assess(
  facts: Partial<DisruptionImpactAssessment> = {},
  change: Partial<DisruptionAlert> = {},
  candidate: Partial<PublicDisruptionCandidate> = {},
) {
  return assessDisruptionEligibility({ ...alert, impactAssessment: { ...assessment, ...facts }, ...change },
    { ...event, ...candidate }, now);
}

describe("high-confidence material disruption qualification", () => {
  it("versions the application policy and accepts a directly matching official closure", () => {
    expect(DISRUPTION_QUALIFICATION_POLICY_VERSION).toBe(1);
    expect(assess()).toEqual({ eligible: true, reason: "high_confidence_material_impact" });
  });

  it.each(["cancelled", "unavailable", "access_blocked"] as const)(
    "accepts an exact confirmed %s without inventing a delay", (effect) => {
      expect(assess({ effect }).eligible).toBe(true);
    });

  it.each(["possible", "resolved"] as const)("does not qualify %s as a new warning", (state) => {
    expect(assess({}, { state }).reason).toBe("not_confirmed");
  });
  it("rejects informational notices and legacy output without an assessment", () => {
    expect(assess({}, { severity: "info" }).eligible).toBe(false);
    expect(assess({}, { impactAssessment: undefined }).reason).toBe("missing_impact_assessment");
  });
  it.each(["medium", "low"] as const)("rejects %s confidence even with an official source", (confidence) => {
    expect(assess({ confidence }).eligible).toBe(false);
  });
  it.each(["corroborated", "unknown"] as const)("rejects %s source authority", (sourceAuthority) => {
    expect(assess({ sourceAuthority }).eligible).toBe(false);
  });
  it("requires actual evidence facts and a public source, not just a confidence label", () => {
    expect(assess({ evidenceSummary: " " }).eligible).toBe(false);
    expect(assess({}, { sourceUrls: [] }).eligible).toBe(false);
  });
  it.each(["nearby", "unknown"] as const)("rejects a %s entity match", (match) => {
    expect(assess({ match }).reason).toBe("indirect_event_match");
  });
  it.each([null, "Unrelated Bistro", "ample", "a"])("requires a real stored entity match: %s", (affectedEntity) => {
    expect(assess({ affectedEntity }).eligible).toBe(false);
  });
  it("allows normalized stored venue spelling but not substring collisions", () => {
    expect(assess({ affectedEntity: "ＥＸＡＭＰＬＥ BISTRO" }).eligible).toBe(true);
    expect(assess({ affectedEntity: "Bistro" }, {}, { title: "Bistropolis", locations: [] }).eligible).toBe(false);
    expect(assess({ affectedEntity: "架空食堂" }, {}, { title: "架空食堂 午餐", locations: [] }).eligible).toBe(true);
  });
  it.each([
    ["渋谷", "架空商店 渋谷PARCO店", "架空商店 渋谷PARCO店（東京都渋谷区宇田川町15-1）"],
    ["宇田川町", "Visit the shop", "架空商店（東京都渋谷区宇田川町15-1）"],
    ["Tokyo", "Dinner", "Example Bistro, Tokyo"],
    ["North District", "Dinner", "Example Bistro, North District, 123 Example Road"],
    ["Example Road", "Dinner", "Example Bistro (123 Example Road, Tokyo)"],
    ["食堂", "架空食堂 午餐", "架空食堂"],
  ])("rejects an address/district/name fragment %s even when labeled exact_venue", (affectedEntity, title, location) => {
    expect(assess({ affectedEntity }, {}, { title, locations: [location] }).reason).toBe("affected_entity_not_in_event");
  });
  it.each([
    ["Example Bistro", "Dinner", "Example Bistro, Tokyo"],
    ["架空食堂", "午餐", "架空食堂（東京都架空区1-2-3）"],
    ["架空食堂", "架空食堂で昼食", "架空食堂"],
    ["Ｓｙｎｔｈｅｔｉｃ Ｃａｆｅ", "Coffee", "Synthetic Cafe (123 Example Road)"],
    ["カフェ", "休憩", "ｶﾌｪ"],
  ])("accepts the complete stored venue name %s rather than its address", (affectedEntity, title, location) => {
    expect(assess({ affectedEntity }, {}, { title, locations: [location] }).eligible).toBe(true);
  });

  it.each(["transit_disruption", "road_disruption", "strike"] as const)(
    "never assigns nearby %s to a meal, shop, or hotel", (reasonCode) => {
      for (const itemType of ["meal", "activity", "lodging"]) {
        expect(assess({ match: "exact_venue" }, { reasonCode }, { itemType }).reason)
          .toBe("unplanned_transport_route");
        expect(assess({ match: "explicit_transport" }, { reasonCode }, { itemType }).eligible).toBe(false);
      }
    });
  it("accepts a named planned train cancellation but not an inferred line from endpoints", () => {
    const facts = { match: "explicit_transport", affectedEntity: "Example Line", effect: "cancelled" } as const;
    const transport = { itemType: "transport", title: "Example Line train to Tokyo", locations: ["Shibuya", "Tokyo"] };
    expect(assess(facts, { reasonCode: "transit_disruption" }, transport).eligible).toBe(true);
    expect(assess(facts, { reasonCode: "transit_disruption" }, { ...transport, title: "Train to Tokyo",
      locations: ["Example Line Shibuya Station", "Tokyo Station"] }).reason).toBe("affected_entity_not_in_event");
  });
  it.each([
    ["Shibuya", "Shibuya to Shinjuku train", "Shibuya Station"],
    ["Shibuya Station", "Shibuya Station to Shinjuku", "Shibuya"],
    ["ＳＨＩＢＵＹＡ", "Shibuya to Shinjuku", "Shibuya railway station, Tokyo"],
    ["渋谷", "渋谷 から 新宿", "渋谷駅（ハチ公口）"],
    ["渋谷駅", "渋谷駅 から 新宿駅", "渋谷"],
    ["架空", "架空 去 新宿", "架空站"],
  ])("rejects endpoint-only transport entity %s even when present in the title", (affectedEntity, title, endpoint) => {
    expect(assess({ match: "explicit_transport", affectedEntity }, { reasonCode: "transit_disruption" },
      { itemType: "transport", title, locations: [endpoint, "Shinjuku Station"] }).reason)
      .toBe("transport_entity_is_only_endpoint");
  });
  it("keeps explicitly named services distinct from their endpoints, including normalized Japanese", () => {
    expect(assess({ match: "explicit_transport", affectedEntity: "架空線" }, { reasonCode: "transit_disruption" },
      { itemType: "transport", title: "架空線 — 渋谷駅→新宿駅", locations: ["渋谷駅", "新宿駅"] }).eligible).toBe(true);
    expect(assess({ match: "explicit_transport", affectedEntity: "ＪＲ架空線" }, { reasonCode: "transit_disruption" },
      { itemType: "transport", title: "JR架空線 渋谷→新宿", locations: ["渋谷駅", "新宿駅"] }).eligible).toBe(true);
    expect(assess({ match: "explicit_transport", affectedEntity: "Example Line" }, { reasonCode: "transit_disruption" },
      { itemType: "transport", title: "Example Line to Shinjuku", locations: ["Example Line Shibuya Station", "Shinjuku Station"] }).eligible).toBe(true);
  });
  it("does not count a note as an attendance event", () => {
    expect(assess({}, {}, { itemType: "note" }).eligible).toBe(false);
  });

  it.each([null, 0, 10, 29, 29.9])("suppresses a delay with unsupported/short minimum %s", (minimumDelayMinutes) => {
    expect(assess({ effect: "delay", minimumDelayMinutes }, { reasonCode: "delay" }).reason)
      .toBe("delay_below_material_threshold");
  });
  it.each([30, 45, 60])("accepts a source-supported schedule shift of at least %s minutes", (minimumDelayMinutes) => {
    expect(assess({ effect: "schedule_change", minimumDelayMinutes }, { reasonCode: "hours_change" }).eligible).toBe(true);
  });
  it("keeps 'up to 30 minutes' quiet when no 30-minute lower bound is supported", () => {
    expect(assess({ effect: "delay", minimumDelayMinutes: null,
      evidenceSummary: "The operator says delays may reach up to 30 minutes." }, { reasonCode: "delay" }).eligible).toBe(false);
  });
  it.each(["minor", "unknown"] as const)("rejects a %s effect even with a large delay field", (effect) => {
    expect(assess({ effect, minimumDelayMinutes: 90 }).eligible).toBe(false);
  });

  it("suppresses district-wide weather and ordinary forecasts but keeps confirmed venue closure", () => {
    expect(assess({ match: "nearby" }, { reasonCode: "weather" }, { itemType: "lodging" }).eligible).toBe(false);
    expect(assess({ effect: "delay", minimumDelayMinutes: 60 }, { reasonCode: "weather" }).reason)
      .toBe("weather_without_direct_blockage");
    expect(assess({ effect: "access_blocked" }, { reasonCode: "weather" }, { itemType: "lodging" }).eligible).toBe(true);
  });
  it("ignores normal hotel access procedures and non-blocking lodging schedule notices", () => {
    expect(assess({ effect: "minor" }, { reasonCode: "access_change" }, { itemType: "lodging" }).eligible).toBe(false);
    expect(assess({ effect: "schedule_change", minimumDelayMinutes: 60 }, { reasonCode: "hours_change" },
      { itemType: "lodging" }).reason).toBe("non_blocking_lodging_notice");
    expect(assess({ effect: "delay", minimumDelayMinutes: 60 }, { reasonCode: "access_change" }).reason)
      .toBe("routine_access_change");
    expect(assess({ effect: "access_blocked" }, { reasonCode: "access_change" }).eligible).toBe(true);
  });

  it.each([
    { affectedFrom: null, affectedUntil: null },
    { affectedFrom: null },
    { affectedUntil: null },
    { affectedFrom: "2026-09-10T07:00:00Z", affectedUntil: "2026-09-10T10:00:00Z" },
    { affectedFrom: "2026-09-08T07:00:00Z", affectedUntil: "2026-09-08T10:00:00Z" },
    { affectedUntil: "2026-09-09T08:30:00Z" },
    { affectedFrom: "2026-09-09T09:30:00Z" },
  ])("requires supported overlap, not missing dates or touching intervals: %j", (change) => {
    expect(assess({}, change).reason).toBe("no_supported_time_overlap");
  });
  it("assesses an event with no end only at its known start", () => {
    expect(assess({}, {}, { endsAt: null }).eligible).toBe(true);
    expect(assess({}, { affectedFrom: "2026-09-09T08:31:00Z" }, { endsAt: null }).eligible).toBe(false);
    expect(assess({}, {}, { startsAt: null, endsAt: null }).eligible).toBe(false);
  });
  it("allows fresh ongoing closure for an imminent event but never projects it to tomorrow", () => {
    expect(assess({ ongoing: true }, { affectedUntil: null }).eligible).toBe(true);
    expect(assess({ ongoing: false }, { affectedUntil: null }).eligible).toBe(false);
    expect(assess({ ongoing: true }, { affectedUntil: null }, { startsAt: "2026-09-09T08:31:00Z" }).eligible).toBe(false);
    expect(assess({ ongoing: true }, { affectedUntil: null }, { startsAt: "2026-09-10T08:30:00Z",
      endsAt: "2026-09-10T09:30:00Z" }).eligible).toBe(false);
    expect(assess({ ongoing: true }, { affectedUntil: null, affectedFrom: "2026-09-09T08:15:00Z" }).eligible).toBe(false);
    expect(assess({ ongoing: true }, { affectedUntil: null }, { startsAt: "2026-09-09T06:00:00Z",
      endsAt: "2026-09-09T07:59:00Z" }).eligible).toBe(false);
  });
  it("allows an ongoing incident during a still-running event", () => {
    expect(assess({ ongoing: true }, { affectedUntil: null }, { startsAt: "2026-09-09T07:30:00Z" }).eligible).toBe(true);
  });
});
