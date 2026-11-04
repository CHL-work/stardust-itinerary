import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TripDeletionCard, TripDeletionReview } from "@/components/trip-deletion-controls";
import { matchesTripName, tripDeletionInputSchema, type TripDeletionPreview } from "@/lib/app/trip-deletion-contract";
import { tripDeletionMessages } from "@/lib/app/trip-deletion-i18n";
import { formatMessage, locales } from "@/lib/i18n";

const preview: TripDeletionPreview = {
  trip: { id: "trip", name: "Synthetic <trip>" }, blockedReason: null, nextTripName: "Synthetic next trip",
  counts: { otherMembers: 3, events: 12, expenses: 4, repayments: 1, pendingRequests: 2 },
};
const render = (value = preview, locale: (typeof locales)[number] = "en", busy = false) => renderToStaticMarkup(createElement(TripDeletionReview, {
  preview: value, locale, busy, submit: () => undefined, cancel: () => undefined, createTrip: () => undefined,
}));

describe("trip name confirmation", () => {
  it("forgives only invisible spacing and composition differences", () => {
    expect(matchesTripName("  Kyoto spring ", "Kyoto spring")).toBe(true);
    expect(matchesTripName("Kyoto spring", "Kyoto  spring")).toBe(true);
    expect(matchesTripName("Kyoto\u00a0spring", "Kyoto spring")).toBe(true);
    expect(matchesTripName("Café trip", "Café trip")).toBe(true);
    expect(matchesTripName("京都", "京都")).toBe(true);
  });

  it("rejects a different, partial, differently cased or empty name", () => {
    expect(matchesTripName("kyoto spring", "Kyoto spring")).toBe(false);
    expect(matchesTripName("Kyoto", "Kyoto spring")).toBe(false);
    expect(matchesTripName("   ", "   ")).toBe(false);
    expect(matchesTripName("", "")).toBe(false);
  });

  it("accepts only the confirmation field", () => {
    expect(tripDeletionInputSchema.safeParse({ confirmationName: "Trip" }).success).toBe(true);
    expect(tripDeletionInputSchema.safeParse({ confirmationName: "" }).success).toBe(false);
    expect(tripDeletionInputSchema.safeParse({ confirmationName: "Trip", force: true }).success).toBe(false);
    expect(tripDeletionInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("trip deletion dialog", () => {
  it.each(locales)("explains the effect and honest limits in %s", (locale) => {
    const copy = tripDeletionMessages(locale);
    const markup = render(preview, locale);
    for (const text of [copy.money, copy.limits, copy.events, copy.expenses, copy.repayments, copy.pendingRequests, copy.confirmAction, copy.close]) expect(markup).toContain(text.replaceAll("'", "&#x27;"));
    expect(markup).toContain(formatMessage(copy.othersMany, { count: 3 }));
    expect(markup).toContain(formatMessage(copy.nextTrip, { name: "Synthetic next trip" }));
    expect(markup).toContain("Synthetic &lt;trip&gt;");
    expect(markup).not.toContain("<trip>");
  });

  it("starts with deletion disabled and focus on Cancel", () => {
    const markup = render();
    expect(markup).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(markup).toMatch(/<button type="button"[^>]*data-feedback-action="dialog_close"/);
    expect(markup).not.toContain("confirmationName");
  });

  it("uses correct wording for one or no other members", () => {
    const copy = tripDeletionMessages("en");
    expect(render({ ...preview, counts: { ...preview.counts, otherMembers: 1 } })).toContain(copy.othersOne);
    expect(render({ ...preview, counts: { ...preview.counts, otherMembers: 0 } })).toContain(copy.othersNone);
  });

  it.each(locales)("blocks the user's only trip and offers Create Trip in %s", (locale) => {
    const copy = tripDeletionMessages(locale);
    const markup = render({ ...preview, blockedReason: "last_trip", nextTripName: null }, locale);
    expect(markup).toContain(copy.lastTrip);
    expect(markup).toContain(copy.createTrip);
    expect(markup).not.toContain(copy.confirmAction);
    expect(markup).not.toContain("<input");
  });

  it("offers one clear entry point on the Settings card", () => {
    const open = vi.fn();
    const copy = tripDeletionMessages("en");
    const markup = renderToStaticMarkup(createElement(TripDeletionCard, { locale: "en", busy: false, open }));
    expect(markup).toContain(copy.cardTitle);
    expect(markup).toContain(copy.cardAction);
    expect(markup).toContain("danger-button");
  });
});

describe("trip deletion copy", () => {
  it("has identical non-empty keys and placeholders in every locale, with neutral Cantonese", () => {
    const keys = Object.keys(tripDeletionMessages("en")) as Array<keyof ReturnType<typeof tripDeletionMessages>>;
    const placeholders = (text: string) => (text.match(/\{[a-z]+\}/giu) ?? []).sort();
    for (const locale of locales) {
      const copy = tripDeletionMessages(locale);
      expect(Object.keys(copy)).toEqual(keys);
      for (const key of keys) {
        expect(copy[key].trim()).not.toBe("");
        expect(placeholders(copy[key])).toEqual(placeholders(tripDeletionMessages("en")[key]));
      }
    }
    expect(tripDeletionMessages("zh-HK-lihkg")).toEqual(tripDeletionMessages("zh-HK"));
  });
});

describe("trip deletion wiring", () => {
  const shell = readFileSync("src/components/app-shell.tsx", "utf8");
  const route = readFileSync("src/app/api/trips/[tripId]/deletion/route.ts", "utf8");

  it("shows the Settings card only to owners", () => {
    expect(shell).toContain("overview.session.isOwner && !activityAccessLost ? <TripDeletionCard");
  });

  it("offers a reload, not a re-preview, when the outcome is uncertain", () => {
    const start = shell.indexOf("const confirmTripDeletion");
    const body = shell.slice(start, shell.indexOf("const saveProfileName", start));
    expect(body).toContain("[400, 401, 403, 409].includes(status)");
    expect(body).toContain("uncertain: !refused");
    expect(shell).toContain("tripDeletion.uncertain ? <button");
    expect(shell).toContain("onClick={() => window.location.reload()}>{tripDeletionCopy.reload}");
  });

  it("closes the dialog when a background refresh loses access", () => {
    const branch = shell.slice(shell.indexOf("[401, 403].includes(result.error.status)"));
    expect(branch.slice(0, branch.indexOf("setLoadError("))).toContain("setTripDeletion(null)");
  });

  it("never replays a failed deletion and clears this device's copy after success", () => {
    const start = shell.indexOf("const confirmTripDeletion");
    const body = shell.slice(start, shell.indexOf("const saveProfileName", start));
    expect(body).toContain("confirmInstructionsLeave()");
    expect(body.match(/\/deletion`/g)).toHaveLength(1);
    expect(body.indexOf("clearOfflineItinerarySnapshot()")).toBeGreaterThan(body.indexOf("return;\n    }"));
    expect(body.indexOf("clearOfflineItinerarySnapshot()")).toBeLessThan(body.indexOf("window.location.reload()"));
  });

  it("requires same-origin only on the delete and issues the next trip's cookie", () => {
    const handler = route.slice(route.indexOf("export async function DELETE"));
    expect(handler).toContain("requireSameOrigin(request, config)");
    expect(handler).toContain("setSessionCookie(response, config, result.grant)");
    expect(route.slice(route.indexOf("export async function GET"), route.indexOf("export async function DELETE"))).not.toContain("requireSameOrigin");
  });

  it("keeps the disruption worker away from deleted trips without deadlocking a deletion", () => {
    const monitor = readFileSync("src/lib/disruptions/monitor.ts", "utf8").replace(/\r\n/gu, "\n");
    expect(monitor).toContain("AND trip.deleted_at IS NULL");
    expect(monitor).toContain("FOR UPDATE OF settings SKIP LOCKED\n        FOR KEY SHARE OF trip SKIP LOCKED");
  });

  it("uses wall-clock time for rows that may postdate the transaction start", () => {
    const deletion = readFileSync("src/lib/app/trip-deletion.ts", "utf8");
    expect(deletion).not.toMatch(/=\s*CURRENT_TIMESTAMP/u);
    expect(deletion.match(/clock_timestamp\(\)/gu)?.length).toBeGreaterThanOrEqual(6);
    expect(deletion).toContain("disruptionChecksEnabled");
  });
});
