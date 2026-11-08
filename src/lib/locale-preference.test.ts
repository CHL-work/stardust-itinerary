import { describe, expect, it, vi } from "vitest";
import { preferredLocale } from "@/lib/locale-preference";
import { saveLocalePreference } from "@/lib/locale-preference-client";

describe("remembered interface language", () => {
  it("defaults to English even with invalid values", () => {
    expect(preferredLocale(null, undefined)).toBe("en");
    expect(preferredLocale("not-a-locale", "<script>bad</script>")).toBe("en");
  });
  it("prefers the account to this browser, and explicit routes only choose this view", () => {
    expect(preferredLocale("ja-JP", "fr")).toBe("ja-JP");
    expect(preferredLocale(null, "zh-HK-lihkg")).toBe("zh-HK-lihkg");
    expect(preferredLocale("ja-JP", "fr", "de")).toBe("de");
    expect(preferredLocale("ja-JP", "fr", "untrusted")).toBe("ja-JP");
  });
  it("saves a choice through a same-origin request before navigation", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({locale:"ja-JP"}));
    expect(await saveLocalePreference("ja-JP", fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/account/locale", expect.objectContaining({method:"PUT",body:'{"locale":"ja-JP"}'}));
  });
  it("does not claim a save when offline or signed out in another tab", async () => {
    expect(await saveLocalePreference("en", vi.fn().mockRejectedValue(new Error("offline")))).toBe(false);
    expect(await saveLocalePreference("en", vi.fn().mockResolvedValue(new Response(null,{status:401})))).toBe(false);
  });
});
