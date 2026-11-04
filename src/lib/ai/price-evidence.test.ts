import { describe, expect, it } from "vitest";
import { assessPublishedPriceQuotes, containsUnsupportedPriceService, publishedPriceQuoteSchema, type PublishedPriceQuote } from "@/lib/ai/price-evidence";
import { sanitizePublicResearchSource } from "@/lib/ai/public-research";

const source = "https://synthetic-wellness.example.test/central/menu";
const quote: PublishedPriceQuote = {
  service: "Relaxation massage", durationMinutes: 60, currency: "JPY", baseFeeMinor: 7000,
  priceUnit: "per_person", tax: "included", fees: [], conditions: "Central branch standard menu",
  source, validFrom: null, validThrough: null,
};
const assess = (raw: unknown, date: string | null = null) => assessPublishedPriceQuotes(raw, [source], date, sanitizePublicResearchSource, "2030-04-01");

describe("published tariff evidence, not payment arithmetic", () => {
  it("retains exact published duration tiers and does not interpolate or sum a bill", () => {
    const tiers = [quote, { ...quote, durationMinutes: 90, baseFeeMinor: 10000 }];
    expect(assess(tiers)).toEqual(tiers);
    expect(assess(tiers)).not.toHaveProperty("totalMinor");
    expect(assess(tiers)).toHaveLength(2);
  });
  it("preserves an unknown extra fee, unit and tax without claiming a zero charge or final total", () => {
    const partial = { ...quote, priceUnit: "unknown", tax: "unknown", fees: [
      { name: "Optional aromatherapy", amountMinor: null, requirement: "optional", conditions: "Amount not published" },
      { name: "Service surcharge", amountMinor: null, requirement: "mandatory", conditions: "10% published surcharge; no arithmetic performed" },
    ] };
    expect(assess([partial])).toEqual([partial]);
  });
  it("allows an explicit free published price without creating a zero-value expense", () => {
    expect(assess([{ ...quote, service: "Garden entry", durationMinutes: null, baseFeeMinor: 0, tax: "not_applicable" }]))
      .toMatchObject([{ baseFeeMinor: 0, durationMinutes: null }]);
  });
  it.each([
    { baseFeeMinor: -1 }, { baseFeeMinor: 0.5 }, { baseFeeMinor: Number.MAX_SAFE_INTEGER + 1 },
    { durationMinutes: 0 }, { durationMinutes: 60.5 }, { durationMinutes: "60" },
    { currency: "yen" }, { currency: "ZZZ" }, { currency: "KWD" }, { currency: "VND" }, { priceUnit: "per_booking_guess" },
    { source: "https://other.example.test/menu" }, { source: "http://synthetic-wellness.example.test/central/menu" },
    { source: "https://synthetic-wellness.example.test/account/menu" }, { source: "" },
    { service: "" }, { service: "   " }, { service: "Visit with traveler@example.test" },
    { conditions: "PIN: 1234" }, { conditions: "https://booking.example.test/private" },
    { extra: "unsupported" }, { fees: [{ name: "Fee", amountMinor: -1, requirement: "mandatory", conditions: "" }] },
  ])("rejects unsupported or unsafe tariff %j", (patch) => expect(assess([{ ...quote, ...patch }])).toBeNull());
  it("requires all nullable quote fields and bounds rows", () => {
    const missing = { ...quote, durationMinutes: undefined };
    expect(publishedPriceQuoteSchema.safeParse(missing).success).toBe(false);
    expect(assess([])).toBeNull(); expect(assess(undefined)).toBeNull();
    expect(assess(Array.from({ length: 13 }, (_, index) => ({ ...quote, service: `Tier ${index}` })))).toBeNull();
  });
  it("rejects duplicate and conflicting tariff identities rather than choosing an amount", () => {
    expect(assess([quote, quote])).toBeNull();
    expect(assess([quote, { ...quote, baseFeeMinor: 8000 }])).toBeNull();
    expect(assess([quote, { ...quote, service: " RELAXATION  MASSAGE " }])).toBeNull();
  });
  it("keeps dated promotions inside their published applicability, using as-of date for latest", () => {
    const dated = { ...quote, validFrom: "2030-04-01", validThrough: "2030-04-30" };
    expect(assess([dated])).toEqual([dated]);
    expect(assess([dated], "2030-04-30")).toEqual([dated]);
    expect(assess([dated], "2030-05-01")).toBeNull();
    expect(assess([dated], "2030-03-31")).toBeNull();
    expect(assess([{ ...dated, validFrom: "2030-05-01" }])).toBeNull();
    expect(assess([{ ...dated, validThrough: "2030-02-31" }])).toBeNull();
  });
  it("requires the quote source to match a separately accepted fact source", () => {
    expect(assessPublishedPriceQuotes([quote], [], null, sanitizePublicResearchSource, "2030-04-01")).toBeNull();
    expect(assess([{ ...quote, source: `${source}?utm_source=synthetic#prices` }])).toEqual([quote]);
  });
  it("retains independently supported tiers while omitting malformed, expired and conflicting rows", () => {
    const valid = { ...quote, durationMinutes: 90, baseFeeMinor: 10000 };
    expect(assess([quote, { ...quote, baseFeeMinor: 8000 }, valid,
      { ...quote, service: "Old promotion", validThrough: "2029-12-31" }, { service: "Malformed" },
    ])).toEqual([valid]);
    expect(assess([valid, { ...quote, source: "https://wrong.example.test/menu" }])).toEqual([valid]);
  });
  it("excludes explicitly sexual services without excluding ordinary massage or museum admission", () => {
    for (const value of ["sexual services", "erotic massage", "性服務", "デリヘル"]) {
      expect(containsUnsupportedPriceService(value)).toBe(true);
      expect(assess([{ ...quote, service: value }])).toBeNull();
    }
    for (const value of ["Non-sexual relaxation massage", "Non-sexual services", "Non sexual services", "Ordinary spa", "Museum admission", "Sports massage", "風俗博物館"]) {
      expect(containsUnsupportedPriceService(value)).toBe(false);
    }
  });
});
