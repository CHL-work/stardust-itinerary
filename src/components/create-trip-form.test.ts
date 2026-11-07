import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it,vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
import { CreateTripForm,createTripCopy } from "@/components/create-trip-form";
import { locales } from "@/lib/i18n";
import { getTripCreationOptions, type TripCreationOptions } from "@/lib/app/trip-creation-options";
const optionsByLocale = Object.fromEntries(locales.map((locale) => [locale,getTripCreationOptions(locale)])) as Record<typeof locales[number],TripCreationOptions>;
const defaults = {now:"2030-01-01T00:00:00Z",optionsByLocale,authenticated:true,signupEnabled:false,lookupEntitled:true};

describe("account trip creation form",() => {
  it.each(locales)("renders local-language identity, with the AI lookup disclosure behind a help button, for %s",(locale) => {
    const html = renderToStaticMarkup(createElement(CreateTripForm,{...defaults,locale}));
    expect(html).toContain(createTripCopy(locale).title);
    expect(html).toContain(createTripCopy(locale).intro);
    expect(html).toContain('name="name"');
    expect(html).toContain('value="2030-01-01"');
    expect(html).not.toContain('name="role"');
    expect(html).not.toContain('name="userId"');
    expect(html).toMatch(/<select[^>]*name="timeZone"/);
    expect(html).toMatch(/<select[^>]*name="defaultCurrency"/);
    expect(html).toContain('value="America/Chicago"');
    expect(html).toContain('value="USD"');
    expect(html).not.toContain('value="Asia/Tokyo" selected=""');
    expect(html).toContain('value="" selected=""');
    expect(html).toContain('value="JPY" selected=""');
    expect(html).toContain(createTripCopy(locale).auto);
    expect(html).toContain(createTripCopy(locale).find);
    expect(html.match(/<span id="[^"]+" popover="auto" role="note"[^>]*>([^<]*)<\/span>/u)?.[1]).toBe(createTripCopy(locale).aiDisclosure);
    expect(html).not.toContain(`<small>${createTripCopy(locale).aiDisclosure}`);
    expect(html).toMatch(/<details><summary class="auth-secondary">[^<]+<\/summary><label>[^<]+<select[^>]*name="timeZone"/u);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).not.toContain('value="USA"');
    expect(html).not.toMatch(/<input[^>]*name="(?:timeZone|defaultCurrency)"/);
  });
  it("does not expose a create form while signed out or imply public signup is enabled",() => {
    const html = renderToStaticMarkup(createElement(CreateTripForm,{...defaults,locale:"en",authenticated:false}));
    expect(html).toContain(createTripCopy("en").closed);
    expect(html).not.toContain('name="name"');
  });
  it("uses neutral money/auth errors in both Cantonese modes",() => {
    expect(createTripCopy("zh-HK-lihkg")).toEqual(createTripCopy("zh-HK"));
  });
  it.each(locales)("opens manual fallback without AI disclosure for a non-entitled %s principal",(locale) => {
    const html = renderToStaticMarkup(createElement(CreateTripForm,{...defaults,locale,lookupEntitled:false}));
    expect(html).toContain('<details open="">');
    expect(html).not.toContain(createTripCopy(locale).aiDisclosure);
    expect(html).not.toContain(createTripCopy(locale).find);
  });
  it("keeps live Overview day selection and swipe without previous/next buttons, retaining offline access",() => {
    const source = readFileSync("src/components/app-shell.tsx","utf8");
    const live = source.slice(source.indexOf('const openNewTrip'));
    expect(live).not.toContain("messages.previousDay"); expect(live).not.toContain("messages.nextDay");
    // The day chips select the day; the classic date selector went with the classic layout (JOB-081).
    expect(live).not.toContain("overview-date-picker");
    expect(live).toContain("<OverviewDayStrip"); expect(live).toContain("finishOverviewSwipe(touch.clientX, touch.clientY)");
    expect(source).toContain('className="offline-day-navigation"');
    expect(source).not.toContain("newTripDraft");
  });
});
