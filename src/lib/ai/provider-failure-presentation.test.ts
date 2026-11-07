import { describe, expect, it } from "vitest";
import { aiProviderFailureCodes, type AiProviderFailureDetails } from "./provider-failure";
import { aiProviderFailureCopy, aiProviderFailureMessage } from "./provider-failure-presentation";
import { formatMessage, locales, messages } from "@/lib/i18n";

const limited: AiProviderFailureDetails = { code: "AI_PROVIDER_RATE_LIMITED", provider: "anthropic", retryAt: "2026-09-10T01:00:00.000Z" };

describe("safe localized provider failure presentation", () => {
  it.each(locales)("explains each allowlisted terminal category in %s", (locale) => {
    const copy = aiProviderFailureCopy(locale);
    for (const code of aiProviderFailureCodes) {
      const message = aiProviderFailureMessage({ errorCode: code, providerFailure: { code, provider: "anthropic" } }, { locale, timeZone: "Asia/Tokyo", isOwner: true });
      expect(message).toContain(formatMessage(copy[code], { provider: "Anthropic (Claude)" }));
      expect(message).toContain(copy.unchanged);
      expect(message).toContain(code === "AI_PROVIDER_AUTH_REQUIRED" || code === "AI_PROVIDER_BILLING" ? copy.ownerAccount : copy.owner);
      expect(message).not.toContain(copy.member); expect(message).not.toContain(code);
    }
  });
  it.each(locales)("formats the reported reset estimate in the trip zone in %s", (locale) => {
    const copy = aiProviderFailureCopy(locale);
    const message = aiProviderFailureMessage({ errorCode: limited.code, providerFailure: limited }, { locale, timeZone: "Asia/Tokyo", isOwner: false });
    const time = new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { timeZone: "Asia/Tokyo", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(limited.retryAt!));
    expect(message).toContain(formatMessage(copy.reset, { time, timeZone: "Asia/Tokyo" }));
    expect(message).toContain(copy.member); expect(message).not.toContain(copy.owner); expect(message).not.toContain(copy.ownerAccount);
    expect(message).toMatch(/10[:.]00/u);
  });
  it("handles OpenAI without assuming every failure is Claude", () => {
    const message = aiProviderFailureMessage({ errorCode: limited.code, providerFailure: { code: limited.code, provider: "openai" } }, { locale: "en", timeZone: "UTC", isOwner: true });
    expect(message).toContain("OpenAI has reached"); expect(message).not.toContain("Claude"); expect(message).not.toContain("reset estimate");
  });
  it("keeps provider/service reliability and quota copy neutral in both Cantonese modes", () => {
    expect(aiProviderFailureCopy("zh-HK-lihkg")).toEqual(aiProviderFailureCopy("zh-HK"));
    expect(messages["zh-HK-lihkg"].aiOwnerPolicy).toBe(messages["zh-HK"].aiOwnerPolicy);
    expect(messages.en.aiOwnerPolicy).toContain("wait for your approval");
  });
  it.each([
    undefined, { ...limited, retryAt: "not-a-date" }, { ...limited, retryAt: "2026-02-30T01:00:00.000Z" },
    { ...limited, provider: "secret-account@example.invalid" }, { ...limited, raw: "credential diagnostic" },
    { code: "AI_PROVIDER_AUTH_REQUIRED", provider: "anthropic" },
  ])("does not invent reset or identity details from malformed/mismatched metadata %#", (providerFailure) => {
    const message = aiProviderFailureMessage({ errorCode: limited.code, providerFailure }, { locale: "en", timeZone: "Asia/Tokyo", isOwner: false });
    expect(message).toContain("The AI provider has reached"); expect(message).not.toContain("Anthropic");
    expect(message).not.toContain("reset estimate"); expect(message).not.toContain("credential"); expect(message).not.toContain("secret-account");
  });
  it("does not crash for an invalid display zone or suggest reset on a non-rate failure", () => {
    const invalidZone = aiProviderFailureMessage({ errorCode: limited.code, providerFailure: limited }, { locale: "en", timeZone: "Invalid/Zone", isOwner: true });
    expect(invalidZone).toContain("Anthropic (Claude) has reached"); expect(invalidZone).not.toContain("reset estimate");
    const nonRate = aiProviderFailureMessage({ errorCode: "AI_PROVIDER_UNAVAILABLE", providerFailure: { ...limited, code: "AI_PROVIDER_UNAVAILABLE" } }, { locale: "en", timeZone: "UTC", isOwner: true });
    expect(nonRate).not.toContain("reset estimate");
  });
  it.each([null, "Error", "AI_REQUEST_FAILED", "SecretProviderDiagnostic", "AI_PROVIDER_SECRET", "owner", "__proto__"])("leaves unknown or legacy code %s generic", (errorCode) => {
    expect(aiProviderFailureMessage({ errorCode, providerFailure: limited }, { locale: "en", timeZone: "Asia/Tokyo", isOwner: false })).toBeNull();
  });
});
