import { describe, expect, it } from "vitest";
import { destinationCurrencyCodes, regionCurrencies, SUGGESTION_EXCLUDED_CURRENCIES } from "./region-currencies";

describe("pinned local currency defaults", () => {
  it("covers ISO territories without guessing a currency for Antarctica", () => {
    expect(Object.keys(regionCurrencies)).toHaveLength(248);
    expect(regionCurrencies.AQ).toBeUndefined();
    for (const [country, values] of Object.entries(regionCurrencies)) {
      expect(country).toMatch(/^[A-Z]{2}$/u);
      for (const code of [values.primary, ...values.alternates]) {
        expect(code).toMatch(/^[A-Z]{3}$/u);
        expect(SUGGESTION_EXCLUDED_CURRENCIES.has(code)).toBe(false);
      }
    }
  });
  it("uses current currency changes, local defaults and deliberate alternatives", () => {
    expect(regionCurrencies.BG?.primary).toBe("EUR"); expect(regionCurrencies.HR?.primary).toBe("EUR");
    expect(regionCurrencies.CW?.primary).toBe("XCG"); expect(regionCurrencies.SX?.primary).toBe("XCG");
    expect(regionCurrencies.ZW?.primary).toBe("ZWG");
    expect(regionCurrencies.KH).toEqual({ primary: "KHR", alternates: ["USD"] });
    expect(regionCurrencies.MO).toEqual({ primary: "MOP", alternates: ["HKD"] });
    expect(regionCurrencies.PA).toEqual({ primary: "PAB", alternates: ["USD"] });
    expect(destinationCurrencyCodes.has("IDR")).toBe(true);
    expect(destinationCurrencyCodes.has("ZZZ")).toBe(false);
  });
});
