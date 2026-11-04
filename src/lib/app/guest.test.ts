import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuestBanner } from "@/components/app-shell";
import { GuestSignIn, guestLocale } from "@/components/guest-sign-in";
import { guestModeEnabled, turnstileMode, verifyTurnstile } from "@/lib/app/guest";
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

  it("checks Turnstile with the secret, for this site and action, never following redirects, and fails closed", async () => {
    const answer = (body: Record<string, unknown>) => vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url; void init;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const expected = { hostname: "stardust.test", action: "guest" };
    const env = { TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret" };
    const passing = answer({ success: true, hostname: "stardust.test", action: "guest" });
    await expect(verifyTurnstile("token", "203.0.113.4", expected, env, passing as unknown as typeof fetch)).resolves.toBe(true);
    const [url, init] = passing.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(String(init?.body)).toContain("remoteip=203.0.113.4");
    for (const reply of [{ success: false }, { success: true, hostname: "evil.test", action: "guest" }, { success: true, hostname: "stardust.test", action: "login" },
      { success: true }]) {
      await expect(verifyTurnstile("token", null, expected, env, answer(reply) as unknown as typeof fetch)).resolves.toBe(false);
    }
    await expect(verifyTurnstile(undefined, null, expected, env, passing as unknown as typeof fetch)).resolves.toBe(false);
    const broken = vi.fn(async () => { throw new Error("network"); });
    await expect(verifyTurnstile("token", null, expected, env, broken as unknown as typeof fetch)).resolves.toBe(false);
    await expect(verifyTurnstile("token", null, expected, {}, passing as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("requires Turnstile unless the operator explicitly waives it", () => {
    expect(turnstileMode({ TURNSTILE_SECRET_KEY: "synthetic" })).toBe("required");
    expect(turnstileMode({ TURNSTILE_SITE_KEY: "synthetic-site" })).toBe("misconfigured");
    expect(turnstileMode({})).toBe("misconfigured");
    expect(turnstileMode({ GUEST_ALLOW_WITHOUT_TURNSTILE: "true" })).toBe("waived");
    expect(turnstileMode({ TURNSTILE_SECRET_KEY: "synthetic", GUEST_ALLOW_WITHOUT_TURNSTILE: "true" })).toBe("required");
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
