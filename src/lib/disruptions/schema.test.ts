import { describe, expect, it } from "vitest";

import { disruptionOutputSchema, parseDisruptionLocalizations, parseDisruptionOutput } from "@/lib/disruptions/schema";

const validAlert = {
  eventKey: "E1",
  state: "confirmed",
  reasonCode: "closure",
  severity: "warning",
  detail: "The venue posted an exceptional closure for the event period.",
  sourceUrls: ["https://venue.example.com/notices/closure#details"],
  affectedFrom: "2026-09-05T01:00:00Z",
  affectedUntil: "2026-09-05T08:00:00Z",
  validForMinutes: 30,
};

describe("disruption structured output", () => {
  const impactAssessment = {
    confidence: "high", sourceAuthority: "official", match: "exact_venue",
    effect: "unavailable", minimumDelayMinutes: null, affectedEntity: "Example Venue",
    evidenceSummary: "The venue confirms it is closed at this event time.", ongoing: false,
  };
  it("requires structured impact facts in new provider output while retaining readable legacy evidence", () => {
    expect(disruptionOutputSchema.properties.alerts.items.required).toContain("impactAssessment");
    const factsSchema = disruptionOutputSchema.properties.alerts.items.properties.impactAssessment;
    expect([...factsSchema.required].sort()).toEqual(Object.keys(impactAssessment).sort());
    expect(parseDisruptionOutput(JSON.stringify({ alerts: [{ ...validAlert, impactAssessment }] }),
      new Set(["E1"]))[0]?.impactAssessment).toEqual(impactAssessment);
    expect(parseDisruptionOutput(JSON.stringify({ alerts: [validAlert] }), new Set(["E1"]))[0]?.impactAssessment)
      .toBeUndefined();
  });
  it.each([
    { confidence: "certain" }, { minimumDelayMinutes: -1 }, { minimumDelayMinutes: 30.5 },
    { ongoing: "yes" }, { invented: true }, { evidenceSummary: "" },
  ])("rejects malformed assessment facts: %j", (change) => {
    expect(() => parseDisruptionOutput(JSON.stringify({ alerts: [{ ...validAlert,
      impactAssessment: { ...impactAssessment, ...change } }] }), new Set(["E1"]))).toThrow();
  });
  it("sanitizes potentially identifying assessment text before it is logged", () => {
    const result = parseDisruptionOutput(JSON.stringify({ alerts: [{ ...validAlert, impactAssessment: {
      ...impactAssessment, affectedEntity: "Venue owner@example.com",
      evidenceSummary: "Closed; contact owner@example.com reservation 999999999999",
    } }] }), new Set(["E1"]));
    expect(JSON.stringify(result)).not.toContain("owner@example.com");
    expect(JSON.stringify(result)).not.toContain("999999999999");
  });
  it("retains all three neutral display variants without changing source evidence", () => {
    const localizedDetails = { en: validAlert.detail, "zh-HK": "場地公布活動期間會暫停開放。", "ja-JP": "施設はイベント時間中の臨時休業を発表しました。" };
    const result = parseDisruptionOutput(JSON.stringify({ alerts: [{ ...validAlert, localizedDetails }] }), new Set(["E1"]));
    expect(result[0]).toMatchObject({ detail: validAlert.detail, localizedDetails });
    expect(parseDisruptionLocalizations(localizedDetails)).toEqual(localizedDetails);
  });

  it.each([undefined, null, {}, { en: "Missing translations" },
    { en: "x".repeat(801), "zh-HK": "關閉", "ja-JP": "休業" }])(
    "retains valid evidence when translations are missing or invalid", (localizedDetails) => {
      const result = parseDisruptionOutput(JSON.stringify({ alerts: [{ ...validAlert, localizedDetails }] }), new Set(["E1"]));
      expect(result[0]?.detail).toBe(validAlert.detail);
      expect(result[0]?.localizedDetails).toBeUndefined();
    });
  it("accepts a strict sourced alert and sanitizes its URL", () => {
    expect(parseDisruptionOutput(
      JSON.stringify({ alerts: [validAlert] }),
      new Set(["E1"]),
    )[0]?.sourceUrls).toEqual(["https://venue.example.com/notices/closure"]);
  });

  it("rejects unknown aliases, duplicate aliases, and private links", () => {
    expect(() => parseDisruptionOutput(
      JSON.stringify({ alerts: [{ ...validAlert, eventKey: "E2" }] }),
      new Set(["E1"]),
    )).toThrow(/unknown event key/u);
    expect(() => parseDisruptionOutput(
      JSON.stringify({ alerts: [validAlert, validAlert] }),
      new Set(["E1"]),
    )).toThrow(/repeated an event key/u);
    expect(() => parseDisruptionOutput(
      JSON.stringify({ alerts: [{
        ...validAlert,
        sourceUrls: ["https://venue.example.com/reservations/999999999999/complete"],
      }] }),
      new Set(["E1"]),
    )).toThrow(/non-public source URL/u);
  });

  it("rejects extra fields and invalid affected ranges", () => {
    expect(() => parseDisruptionOutput(
      JSON.stringify({ alerts: [{ ...validAlert, invented: true }] }),
      new Set(["E1"]),
    )).toThrow();
    expect(() => parseDisruptionOutput(
      JSON.stringify({ alerts: [{
        ...validAlert,
        affectedFrom: "2026-09-05T08:00:00Z",
        affectedUntil: "2026-09-05T01:00:00Z",
      }] }),
      new Set(["E1"]),
    )).toThrow(/affectedUntil/u);
  });
});
