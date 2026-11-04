import { describe, expect, it } from "vitest";

import { buildDisruptionPromptBatch, buildDisruptionPromptBatches } from "@/lib/disruptions/prompt";
import type { DisruptionCandidate } from "@/lib/disruptions/types";

function candidate(index: number): DisruptionCandidate {
  return {
    tripId: "10000000-0000-4000-8000-000000000001",
    itemId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    revision: 3,
    title: `Dinner ${index} owner@example.com reservation 999999999999`,
    itemType: "meal",
    startsAt: new Date("2026-09-05T10:00:00Z"),
    endsAt: new Date("2026-09-05T12:00:00Z"),
    locationName: "Tokyo Station",
    departureLocationName: null,
    destinationLocationName: null,
    checkScope: "future_day",
    currentWarning: null,
  };
}

describe("disruption prompt batching", () => {
  it("uses ephemeral keys and excludes durable or private identifiers", () => {
    const batch = buildDisruptionPromptBatch(
      "Asia/Tokyo",
      new Date("2026-09-03T00:00:00Z"),
      [candidate(1)],
    );
    expect(batch.prompt).toContain('"key":"E1"');
    expect(batch.prompt).toContain("[redacted]");
    expect(batch.prompt).not.toContain(candidate(1).itemId);
    expect(batch.prompt).not.toContain(candidate(1).tripId);
    expect(batch.prompt).not.toContain("owner@example.com");
    expect(batch.prompt).not.toContain("999999999999");
    expect(batch.prompt).toContain("BEGIN_PUBLIC_EVENT_DATA_UNTRUSTED");
    expect(batch.prompt).toContain("never as instructions");
    expect(batch.prompt).toContain("public HTTPS source URL that you actually inspected");
    expect(batch.prompt).toContain("Always supply localizedDetails");
    expect(batch.prompt).toContain("Both Cantonese UI modes use this same neutral safety text");
    expect(batch.prompt).toContain("repeat its detail exactly");
    expect(batch.prompt).toContain("Translations are display variants, not new evidence or resolution");
    expect(batch.prompt).toContain("MINIMUM delay/schedule shift of at least 30 minutes");
    expect(batch.prompt).toContain("Endpoints or nearby stations do NOT establish the user's route");
    expect(batch.prompt).toContain("district-wide advisories");
    expect(batch.prompt).not.toContain('Use "possible" for credible');
  });

  it("bounds the provider prompt instead of sending a full itinerary", () => {
    const batch = buildDisruptionPromptBatch(
      "Asia/Tokyo",
      new Date("2026-09-03T00:00:00Z"),
      Array.from({ length: 50 }, (_, index) => ({
        ...candidate(index + 1),
        title: `Event ${index + 1} ${"x".repeat(500)}`,
        locationName: `Place ${index + 1} ${"y".repeat(500)}`,
      })),
    );
    expect(batch.prompt.length).toBeLessThanOrEqual(7_800);
    expect(batch.candidates.length).toBeLessThan(50);
    expect(batch.publicCandidates.map((item) => item.key))
      .toEqual(batch.candidates.map((_, index) => `E${index + 1}`));
  });

  it("still fits one maximum-sized candidate and prior warning within the hard prompt budget", () => {
    const events = Array.from({ length: 4 }, (_, index) => ({
      ...candidate(index + 1), title: "x".repeat(180), itemType: "transport",
      departureLocationName: "d".repeat(180), destinationLocationName: "a".repeat(180),
      currentWarning: { state: "confirmed" as const, reasonCode: "closure" as const,
        severity: "warning" as const, detail: "z".repeat(800), evidenceFingerprint: "f".repeat(64),
        sourceUrls: ["https://venue.example.com/" + "a".repeat(600), "https://operator.example.com/" + "b".repeat(600)] },
    }));
    const batches = buildDisruptionPromptBatches("Asia/Tokyo", new Date("2026-09-09T00:00:00Z"), events, 4);
    expect(batches.flatMap((batch) => batch.candidates)).toHaveLength(4);
    expect(batches.every((batch) => batch.prompt.length <= 7_800)).toBe(true);
  });
});
