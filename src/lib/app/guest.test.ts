import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuestBanner } from "@/components/app-shell";
import { GuestSignIn, guestLocale } from "@/components/guest-sign-in";
import { guestModeEnabled, verifyTurnstile } from "@/lib/app/guest";
import { guestMessages } from "@/lib/app/guest-i18n";
import { GUEST_ISSUER, isGuestSession } from "@/lib/auth/guest-identity";
import { locales } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

describe("guest accounts", () => {
  it("is off unless explicitly enabled", () => {
    expect(guestModeEnabled({})).toBe(false);
    expect(guestModeEnabled({ GUEST_MODE_ENABLED: "1" })).toBe(false);
    expect(guestModeEnabled({ GUEST_MODE_ENABLED: "true" })).toBe(true);
  });

  it("recognises guest sessions only by their own issuer", () => {
    expect(isGuestSession({ issuer: GUEST_ISSUER })).toBe(true);
    expect(isGuestSession({ issuer: "https://accounts.google.com" })).toBe(false);
  });

  it("checks Turnstile with the secret, never following redirects, and fails closed", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url; void init;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    const env = { TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret" };
    await expect(verifyTurnstile("token", "203.0.113.4", env, fetchImpl as unknown as typeof fetch)).resolves.toBe("passed");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(String(init?.body)).toContain("remoteip=203.0.113.4");
    await expect(verifyTurnstile(undefined, null, env, fetchImpl as unknown as typeof fetch)).resolves.toBe("failed");
    const refusing = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(verifyTurnstile("token", null, env, refusing as unknown as typeof fetch)).resolves.toBe("failed");
    const broken = vi.fn(async () => { throw new Error("network"); });
    await expect(verifyTurnstile("token", null, env, broken as unknown as typeof fetch)).resolves.toBe("failed");
    await expect(verifyTurnstile("token", null, {}, fetchImpl as unknown as typeof fetch)).resolves.toBe("not_configured");
  });

  it("writes the demo trip in the browser's language", () => {
    expect(guestLocale("ja")).toBe("ja-JP");
    expect(guestLocale("zh-HK")).toBe("zh-HK");
    expect(guestLocale("fr-FR")).toBe("en");
    expect(guestLocale(undefined)).toBe("en");
  });

  it("waits for the person check when a site key is configured", () => {
    expect(renderToStaticMarkup(createElement(GuestSignIn, { siteKey: "synthetic-site-key" }))).toContain('disabled=""');
    expect(renderToStaticMarkup(createElement(GuestSignIn, { siteKey: null }))).not.toContain('disabled=""');
  });

  it.each(locales)("tells a guest when everything is deleted, in %s", (locale) => {
    const html = renderToStaticMarkup(createElement(GuestBanner, { locale, expiresAt: "2030-01-02T03:04:00.000Z" }));
    const copy = guestMessages(locale);
    expect(html).toContain(copy.signIn.replaceAll("'", "&#x27;"));
    expect(html).toContain('href="/auth/sign-in"');
    expect(html).toContain("2030");
  });
});
