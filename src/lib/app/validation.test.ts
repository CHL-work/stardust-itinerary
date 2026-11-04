import { describe, expect, it } from "vitest";

import {
  aiRequestSchema,
  aiConversationActionSchema,
  createTripSchema,
  expensePatchSchema,
  expenseSplitAmountsSchema,
  itineraryPatchSchema,
  linkedExpenseSchema,
  reviewRequestSchema,
  tripSettingsSchema,
} from "@/lib/app/validation";
import { locales } from "@/lib/i18n";

describe("custom expense share validation", () => {
  const payer = "10000000-0000-4000-8000-000000000001";
  const guest = "10000000-0000-4000-8000-000000000002";
  const linked = {
    description: "Synthetic dinner", amountMinor: 1000, currency: "JPY",
    payerMemberId: payer, occurredAt: "2030-04-01T10:00:00Z", splitMemberIds: [payer, guest],
  };

  it("keeps equal sharing optional by omission for existing clients", () => {
    expect(linkedExpenseSchema.parse(linked)).toEqual(linked);
    expect(expensePatchSchema.parse({ description: "Edited description" }))
      .toEqual({ description: "Edited description" });
  });

  it("preserves exact custom amounts including explicit zero in both entry points", () => {
    const splitAmounts = [{ memberId: payer, amountMinor: 1000 }, { memberId: guest, amountMinor: 0 }];
    expect(linkedExpenseSchema.parse({ ...linked, splitAmounts }).splitAmounts).toEqual(splitAmounts);
    expect(expensePatchSchema.parse({ splitAmounts })).toEqual({ splitAmounts });
    expect(itineraryPatchSchema.parse({ linkedExpense: { ...linked, splitAmounts } }).linkedExpense?.splitAmounts)
      .toEqual(splitAmounts);
  });

  it.each([-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "100"])(
    "rejects non-integer or unsafe share amounts: %s", (amountMinor) => {
      expect(expenseSplitAmountsSchema.safeParse([{ memberId: payer, amountMinor }]).success).toBe(false);
    },
  );

  it("rejects empty, duplicate, invalid, unknown-field and null maps", () => {
    for (const shares of [[], null,
      [{ memberId: payer, amountMinor: 500 }, { memberId: payer, amountMinor: 500 }],
      [{ memberId: "unknown", amountMinor: 1000 }],
      [{ memberId: payer, amountMinor: 1000, weight: 1 }],
    ]) expect(expenseSplitAmountsSchema.safeParse(shares).success).toBe(false);
  });
});

describe("change request review validation", () => {
  it.each(["approve", "reject"])("requires the rendered proposal version when deciding to %s", (decision) => {
    expect(reviewRequestSchema.parse({ decision, proposalRevision: 3, note: " Reviewed " }))
      .toEqual({ decision, proposalRevision: 3, note: "Reviewed" });
  });

  it.each([undefined, null, 0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1])(
    "rejects an absent or invalid proposal version: %s",
    (proposalRevision) => {
      expect(reviewRequestSchema.safeParse({ decision: "approve", proposalRevision }).success).toBe(false);
    },
  );
});

describe("AI request validation", () => {
  it.each(locales)("accepts the supported %s locale", (locale) => {
    expect(aiRequestSchema.parse({ prompt: "Plan dinner", locale }).locale).toBe(locale);
  });

  it("keeps locale optional for existing clients", () => {
    expect(aiRequestSchema.parse({ prompt: "Plan dinner" })).toEqual({ prompt: "Plan dinner" });
  });

  it("rejects unsupported response locales", () => {
    expect(aiRequestSchema.safeParse({ prompt: "Plan dinner", locale: "fr" }).success).toBe(false);
  });
});

describe("itinerary endpoint validation", () => {
  it("accepts named transport endpoints and their Maps URLs", () => {
    expect(itineraryPatchSchema.parse({
      itemType: "transport",
      departureLocationName: " Haneda Airport ",
      departureMapUrl: "https://www.google.com/maps/place/Haneda+Airport",
      destinationLocationName: null,
    }).departureLocationName).toBe("Haneda Airport");
  });

  it("rejects blank endpoint names and invalid endpoint URLs", () => {
    expect(itineraryPatchSchema.safeParse({ departureLocationName: "  " }).success).toBe(false);
    expect(itineraryPatchSchema.safeParse({ destinationMapUrl: "not a URL" }).success).toBe(false);
    expect(itineraryPatchSchema.safeParse({
      destinationMapUrl: "https://example.test/not-google-maps",
    }).success).toBe(false);
    expect(itineraryPatchSchema.safeParse({
      destinationMapUrl: "http://www.google.com/maps/place/Tokyo",
    }).success).toBe(false);
    expect(itineraryPatchSchema.safeParse({
      mapUrl: "https://example.test/not-google-maps",
    }).success).toBe(false);
  });
});

describe("retired preference conversation boundary", () => {
  it("accepts normal trip chats but rejects the removed preference mode", () => {
    expect(aiConversationActionSchema.parse({ action: "new" })).toEqual({ action: "new" });
    expect(aiConversationActionSchema.parse({ action: "new", purpose: "trip" })).toEqual({ action: "new", purpose: "trip" });
    expect(aiConversationActionSchema.safeParse({ action: "new", purpose: "preferences" }).success).toBe(false);
  });
});

describe("new trip validation", () => {
  const validTrip = {
    name: "Japan 2030",
    destinationName: "Japan",
    timeZone: "Asia/Tokyo",
    defaultLocale: "zh-HK-lihkg" as const,
    defaultCurrency: "jpy",
    startsOn: "2030-04-01",
    endsOn: "2030-04-07",
    maxMembers: 10,
  };

  it("normalizes a valid owner-created trip", () => {
    expect(createTripSchema.parse(validTrip)).toEqual({
      ...validTrip,
      defaultCurrency: "JPY",
    });
  });

  it("rejects reversed, oversized, and invalid-time-zone trips", () => {
    expect(createTripSchema.safeParse({ ...validTrip, endsOn: "2030-03-31" }).success).toBe(false);
    expect(createTripSchema.safeParse({ ...validTrip, endsOn: "2031-04-02" }).success).toBe(false);
    expect(createTripSchema.safeParse({ ...validTrip, timeZone: "Japan-ish" }).success).toBe(false);
  });
});

describe("trip settings validation", () => {
  it("accepts both boundaries and their paired compare-and-set originals", () => {
    const input = { startsOn: "2030-03-30", endsOn: "2030-04-10", expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-07" };
    expect(tripSettingsSchema.parse(input)).toEqual(input);
    expect(tripSettingsSchema.parse({ startsOn: "2030-03-30" })).toEqual({ startsOn: "2030-03-30" });
  });
  it("rejects reversed, excessive, malformed or incomplete date changes", () => {
    for (const input of [
      { startsOn: "2030-04-02", endsOn: "2030-04-01" },
      { startsOn: "2024-02-29", endsOn: "2025-03-01" },
      { startsOn: "2030-02-30" }, { startsOn: "0000-01-01" },
      { startsOn: "2030-04-01", expectedStartsOn: "2030-04-02" },
      { endsOn: "2030-04-01", expectedEndsOn: "2030-04-02" },
      { expectedStartsOn: "2030-04-01", expectedEndsOn: "2030-04-02" },
    ]) expect(tripSettingsSchema.safeParse(input).success).toBe(false);
  });
  it("accepts an ISO end-date extension", () => {
    expect(tripSettingsSchema.parse({ endsOn: "2030-04-10" })).toEqual({ endsOn: "2030-04-10" });
  });

  it("rejects malformed trip end dates", () => {
    expect(tripSettingsSchema.safeParse({ endsOn: "10 April 2030" }).success).toBe(false);
  });
});
