import { supportedLedgerCurrencies } from "@/lib/app/supported-currencies";
import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

export type TripCreationOption = { value: string; label: string };
export type TripCreationOptions = {
  timeZones: TripCreationOption[];
  currencies: TripCreationOption[];
};

const timeZones = [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])].sort();
const labelInstant = new Date("2020-01-01T00:00:00.000Z");
export const commonTimeZoneLabels = {
  en: {
    "America/Chicago": "Dallas / US Central",
    "Asia/Tokyo": "Japan / Tokyo",
    "Asia/Hong_Kong": "Hong Kong",
    UTC: "Coordinated Universal Time",
  },
  "zh-HK": {
    "America/Chicago": "達拉斯 / 美國中部",
    "Asia/Tokyo": "日本 / 東京",
    "Asia/Hong_Kong": "香港",
    UTC: "協調世界時",
  },
  "ja-JP": {
    "America/Chicago": "ダラス / 米国中部",
    "Asia/Tokyo": "日本 / 東京",
    "Asia/Hong_Kong": "香港",
    UTC: "協定世界時",
  },
} as const;

const optionsByLocale = new Map<Locale, TripCreationOptions>();

/** Generate in the server page and pass plain option data to the client.
 * Code ordering and a fixed label instant avoid clock-dependent option changes;
 * the browser never regenerates labels from its potentially different ICU data.
 * The labels never change while the server runs, so each locale's are built once (JOB-084); every caller
 * still gets its own copy.
 */
export function getTripCreationOptions(locale: Locale): TripCreationOptions {
  let options = optionsByLocale.get(locale);
  if (!options) {
    options = buildTripCreationOptions(locale);
    optionsByLocale.set(locale, options);
  }
  return structuredClone(options);
}

function buildTripCreationOptions(locale: Locale): TripCreationOptions {
  const displayLocale = locale === "zh-HK-lihkg" ? "zh-HK" : locale;
  const commonLabels = localizedCatalog<Record<keyof typeof commonTimeZoneLabels.en, string>>(locale, "tripTimeZones", commonTimeZoneLabels);
  const currencyNames = new Intl.DisplayNames(displayLocale, { type: "currency" });
  return {
    timeZones: timeZones.map((value) => {
      const commonLabel = commonLabels[value as keyof typeof commonLabels];
      const name = commonLabel ?? new Intl.DateTimeFormat(displayLocale, {
        timeZone: value, timeZoneName: "longGeneric",
      }).formatToParts(labelInstant).find((part) => part.type === "timeZoneName")?.value ?? value;
      return { value, label: `${name} — ${value}` };
    }),
    currencies: supportedLedgerCurrencies.map((value) => ({
      value, label: `${currencyNames.of(value) ?? value} — ${value}`,
    })),
  };
}
