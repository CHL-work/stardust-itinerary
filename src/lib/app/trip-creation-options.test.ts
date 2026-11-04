import { describe, expect, it, vi } from "vitest";

import { getTripCreationOptions } from "@/lib/app/trip-creation-options";
import { createTripSchema } from "@/lib/app/validation";
import { isSupportedLedgerCurrency, supportedLedgerCurrencies } from "@/lib/app/supported-currencies";
import { locales } from "@/lib/i18n";

const dallasTrip = {
  name: "Synthetic Dallas October test", destinationName: "Dallas",
  startsOn: "2026-10-08", endsOn: "2026-10-31", timeZone: "America/Chicago",
  defaultCurrency: "USD", defaultLocale: "en", maxMembers: 10,
};

describe("server-generated trip creation options", () => {
  it.each(locales)("offers valid, unique, code-sorted choices with Japan defaults for %s", (locale) => {
    const options = getTripCreationOptions(locale);
    expect(options.timeZones.length).toBeGreaterThan(100);
    expect(options.currencies.length).toBeGreaterThan(50);
    for (const list of [options.timeZones, options.currencies]) {
      const values = list.map((option) => option.value);
      expect(values).toEqual([...new Set(values)].sort());
      for (const option of list) {
        expect(option.label).toContain(option.value);
        expect(option.label).not.toMatch(/[\u0000-\u001f<>]/u);
      }
    }
    for (const timeZone of ["Asia/Tokyo", "Asia/Hong_Kong", "America/Chicago", "UTC"]) {
      expect(options.timeZones.some((option) => option.value === timeZone)).toBe(true);
    }
    for (const defaultCurrency of ["JPY", "KRW", "HKD", "USD", "EUR", "GBP"]) {
      expect(options.currencies.some((option) => option.value === defaultCurrency)).toBe(true);
    }
    for (const { value: timeZone } of options.timeZones) {
      expect(createTripSchema.safeParse({ ...dallasTrip, timeZone, defaultLocale: locale }).success).toBe(true);
    }
    for (const { value: defaultCurrency } of options.currencies) {
      expect(createTripSchema.safeParse({ ...dallasTrip, defaultCurrency, defaultLocale: locale }).success).toBe(true);
      expect(isSupportedLedgerCurrency(defaultCurrency)).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(options))).toEqual(options);
  });

  it("makes Dallas's canonical zone discoverable in each language without a fixed offset", () => {
    for (const [locale, label] of [
      ["en", "Dallas / US Central — America/Chicago"],
      ["zh-HK", "達拉斯 / 美國中部 — America/Chicago"],
      ["zh-HK-lihkg", "達拉斯 / 美國中部 — America/Chicago"],
      ["ja-JP", "ダラス / 米国中部 — America/Chicago"],
    ] as const) {
      expect(getTripCreationOptions(locale).timeZones.find((option) => option.value === "America/Chicago")?.label).toBe(label);
    }
  });

  it.each(locales)("uses localized currency names with canonical values for %s", (locale) => {
    const displayLocale = locale === "zh-HK-lihkg" ? "zh-HK" : locale;
    const options = getTripCreationOptions(locale);
    const names = new Intl.DisplayNames(displayLocale, { type: "currency" });
    expect(options.currencies.find((option) => option.value === "USD")?.label).toBe(`${names.of("USD")} — USD`);
    expect(options.currencies.map((option) => option.value)).toEqual(supportedLedgerCurrencies);
    expect(options.timeZones.map((option) => option.value)).toEqual(getTripCreationOptions("en").timeZones.map((option) => option.value));
  });

  it("shares neutral Cantonese for account and currency controls", () => {
    expect(getTripCreationOptions("zh-HK-lihkg")).toEqual(getTripCreationOptions("zh-HK"));
  });

  it("does not expose mutable shared choices to callers", () => {
    const options = getTripCreationOptions("en");
    options.timeZones[0].label = "Changed only in this result";
    options.currencies.splice(0, 1);
    const next = getTripCreationOptions("en");
    expect(next.timeZones[0].label).not.toBe(options.timeZones[0].label);
    expect(next.currencies).toHaveLength(supportedLedgerCurrencies.length);
  });

  it("never offers a city as a zone, a country as currency, or unsupported currency precision", () => {
    const options = getTripCreationOptions("en");
    expect(options.timeZones.some((option) => option.value === "Dallas")).toBe(false);
    for (const currency of ["USA", "ZZZ", "KWD", "VND"]) {
      expect(options.currencies.some((option) => option.value === currency)).toBe(false);
    }
  });
});

describe("trip currency validation and existing ledger precision", () => {
  it.each(locales)("accepts corrected Dallas values for %s", (defaultLocale) => {
    expect(createTripSchema.parse({ ...dallasTrip, defaultLocale })).toEqual({ ...dallasTrip, defaultLocale });
  });

  it("identifies both invalid fields in the reported city/country input", () => {
    const result = createTripSchema.safeParse({ ...dallasTrip, timeZone: "Dallas", defaultCurrency: "USA" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toEqual([["timeZone"], ["defaultCurrency"]]);
  });

  it("retains lowercase and surrounding-space normalization before currency validation", () => {
    expect(createTripSchema.parse({ ...dallasTrip, defaultCurrency: " usd " }).defaultCurrency).toBe("USD");
  });

  it.each(["USA", "ZZZ", "KWD", "VND", "US", "USDD", "", " "])("rejects invalid or unsupported trip currency %j", (defaultCurrency) => {
    const result = createTripSchema.safeParse({ ...dallasTrip, defaultCurrency });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.every((issue) => issue.path[0] === "defaultCurrency")).toBe(true);
  });

  it("keeps each reviewed code within the pre-existing published-price support rule", () => {
    const recognized = Intl.supportedValuesOf("currency");
    for (const currency of supportedLedgerCurrencies) {
      expect(recognized).toContain(currency);
      expect(currency === "JPY" || currency === "KRW"
        || new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits === 2).toBe(true);
      expect(isSupportedLedgerCurrency(currency)).toBe(true);
    }
    expect(Object.isFrozen(supportedLedgerCurrencies)).toBe(true);
  });

  it("validates the pinned currency choices without querying browser ICU", () => {
    const supportedValuesOf = vi.spyOn(Intl, "supportedValuesOf").mockImplementation(() => { throw new Error("Unsupported browser API"); });
    try {
      for (const currency of supportedLedgerCurrencies) expect(isSupportedLedgerCurrency(currency)).toBe(true);
      for (const currency of ["USA", "ZZZ", "KWD", "VND", "usd", " USD", "", "<script>"]) {
        expect(isSupportedLedgerCurrency(currency)).toBe(false);
      }
      expect(createTripSchema.safeParse(dallasTrip).success).toBe(true);
      expect(supportedValuesOf).not.toHaveBeenCalled();
    } finally { supportedValuesOf.mockRestore(); }
  });

  it("retains UTC and recognized IANA aliases accepted by the existing API", () => {
    for (const timeZone of ["UTC", "US/Central"]) {
      expect(createTripSchema.safeParse({ ...dallasTrip, timeZone }).success).toBe(true);
    }
  });
});
