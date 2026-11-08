import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FlightChangeBadge } from "@/components/flight-change-badge";
import type { FlightChange } from "@/lib/app/flight";
import { flightChangeNote, flightMessages } from "@/lib/app/flight-i18n";
import { locales } from "@/lib/i18n";

const delayed: FlightChange = {
  kind: "schedule", previousStartsAt: "2031-05-01T01:00:00.000Z", previousEndsAt: "2031-05-01T02:10:00.000Z",
  startsAt: "2031-05-01T02:30:00.000Z", endsAt: "2031-05-01T03:45:00.000Z", checkedAt: "2031-04-30T19:10:00.000Z",
};
const cancelled: FlightChange = { ...delayed, kind: "cancelled", startsAt: delayed.previousStartsAt, endsAt: delayed.previousEndsAt };

describe("flight change badge (JOB-083)", () => {
  it("says briefly what moved and when it was checked", () => {
    expect(flightChangeNote(delayed, "en", "Asia/Tokyo"))
      .toBe("Departure moved from May 1, 10:00 AM to May 1, 11:30 AM. Arrival is now May 1, 12:45 PM. Checked May 1, 04:10 AM.");
    expect(flightChangeNote(cancelled, "en", "Asia/Tokyo"))
      .toBe("The airline lists this flight as cancelled. The event is kept. Checked May 1, 04:10 AM.");
  });

  it("shows departure and arrival changes on their own endpoint clocks, with no zone names (D-109)", () => {
    const text = flightChangeNote(delayed, "en", "America/Chicago", "America/Denver");
    expect(text).toContain("Departure moved from Apr 30, 08:00 PM to Apr 30, 09:30 PM.");
    expect(text).toContain("Arrival is now Apr 30, 09:45 PM.");
    expect(text).not.toMatch(/CDT|MDT|GMT/u);
  });

  it.each(locales)("renders a changed badge and a red cancelled warning with their notes in %s", (locale) => {
    const copy = flightMessages(locale);
    const changedMarkup = renderToStaticMarkup(createElement(FlightChangeBadge, { change: delayed, locale, timeZone: "Asia/Tokyo" }));
    expect(changedMarkup).toContain('data-flight-change="schedule"');
    expect(changedMarkup).toContain(`aria-label="${copy.changedLabel}"`);
    expect(changedMarkup).toContain(copy.changedShort);
    expect(changedMarkup).toContain('popover="auto"');
    expect(changedMarkup).toContain(flightChangeNote(delayed, locale, "Asia/Tokyo"));
    const cancelledMarkup = renderToStaticMarkup(createElement(FlightChangeBadge, { change: cancelled, locale, timeZone: "Asia/Tokyo" }));
    expect(cancelledMarkup).toContain('data-flight-change="cancelled"');
    expect(cancelledMarkup).toContain(`aria-label="${copy.cancelledLabel}"`);
    expect(cancelledMarkup).toContain(copy.cancelledNote);
  });

  it("is shown on timeline rows and the next-up card", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(shell.match(/<FlightChangeBadge change=\{item(?:\?)?\.flightChange\}/gu)).toHaveLength(2);
  });
});
