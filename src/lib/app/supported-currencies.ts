/**
 * Reviewed 2026-10-08 from Node 24.19.0's recognized currencies, retaining the
 * existing price/ledger rule: JPY/KRW whole units, otherwise two decimal places.
 * Pin the codes so older browser ICU data cannot reject a server-provided choice
 * and a runtime upgrade cannot silently expand the financial support boundary.
 * Localized names remain server-generated; new codes need explicit review.
 */
export const supportedLedgerCurrencies: readonly string[] = Object.freeze([
  "AED", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD",
  "BDT", "BGN", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN",
  "BZD", "CAD", "CDF", "CHF", "CNY", "CRC", "CUC", "CUP", "CVE", "CZK",
  "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP",
  "GEL", "GHS", "GIP", "GMD", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG",
  "ILS", "INR", "JMD", "JPY", "KES", "KGS", "KHR", "KRW", "KYD", "KZT",
  "LKR", "LRD", "LSL", "MAD", "MDL", "MKD", "MNT", "MOP", "MRU", "MUR",
  "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR",
  "NZD", "PAB", "PEN", "PGK", "PHP", "PLN", "QAR", "RON", "RSD", "RUB",
  "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SRD", "SSP",
  "STN", "SVC", "SZL", "THB", "TJS", "TMT", "TOP", "TRY", "TTD", "TWD",
  "TZS", "UAH", "USD", "UYU", "UZS", "VES", "WST", "XCD", "XCG", "XDR",
  "XSU", "ZAR", "ZMW", "ZWG", "ZWL",
]);

const supportedCurrencies = new Set(supportedLedgerCurrencies);

/** Callers normalize user input first; canonical currency identifiers are uppercase. */
export function isSupportedLedgerCurrency(currency: string): boolean {
  return supportedCurrencies.has(currency);
}
