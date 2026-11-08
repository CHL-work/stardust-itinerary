import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuestBanner } from "@/components/app-shell";
import { GuestSignIn } from "@/components/guest-sign-in";
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

  it("starts blank and explains that sign-in does not transfer guest data", () => {
    const html = renderToStaticMarkup(createElement(GuestSignIn,{siteKey:null}));
    expect(html).not.toContain("demo");
    expect(html).toContain("Guest data is not transferred when you sign in");
  });

  it("waits for the person check when a site key is configured", () => {
    expect(renderToStaticMarkup(createElement(GuestSignIn, { siteKey: "synthetic-site-key" }))).toContain('disabled=""');
    expect(renderToStaticMarkup(createElement(GuestSignIn, { siteKey: null }))).not.toContain('disabled=""');
  });

  it.each(locales)("tells a guest in one line when everything is deleted, in %s", (locale) => {
    const expiresAt = "2030-01-02T03:04:00.000Z";
    const copy = guestMessages(locale);
    for (const needsKey of [false, true]) {
      const html = renderToStaticMarkup(createElement(GuestBanner, { locale, expiresAt, needsKey }));
      expect(html).toContain(copy.signIn.replaceAll("'", "&#x27;"));
      expect(html).toContain('href="/auth/sign-in"');
      expect(html).toContain("2030");
      // The key comes up only when AI here needs one, never while free guest AI is on (JOB-077).
      expect(html.includes("API")).toBe(needsKey);
    }
    expect(renderToStaticMarkup(createElement(GuestBanner, { locale, expiresAt }))).not.toContain("API");
  });

  it("keeps the guest notice to one short line, the same in both Cantonese tones (JOB-077, D-088)", () => {
    expect(guestMessages("en")).toMatchObject({
      banner: "This guest trip is deleted on {time}.",
      bannerNeedsKey: "This guest trip is deleted on {time}. AI needs your own API key.",
      signIn: "Sign in for saved trips.",
      separateAccount: "Guest data is not transferred when you sign in.",
    });
    for (const locale of locales) {
      const { banner, bannerNeedsKey, signIn } = guestMessages(locale);
      expect(banner).toContain("{time}");
      expect(bannerNeedsKey.startsWith(banner)).toBe(true);
      // Latin and Cyrillic translations run about a third longer than the English (JOB-084).
      expect(`${bannerNeedsKey} ${signIn}`.length).toBeLessThan(/^(?:en|zh|ja)/u.test(locale) ? 90 : 120);
    }
    expect(guestMessages("zh-HK-lihkg")).toBe(guestMessages("zh-HK"));
  });
});
