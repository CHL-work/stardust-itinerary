import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  destinationDraftProblem, destinationDrafts, destinationsFromDrafts, destinationZoneOptions, TripDestinationsEditor,
} from "@/components/trip-destinations-editor";
import { tripDestinationsMessages } from "@/lib/app/trip-destinations-i18n";
import { locales } from "@/lib/i18n";

const drafts = destinationDrafts([
  { name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: null, endsOn: null },
  { name: "New York", timeZone: "America/New_York", startsOn: "2031-05-04", endsOn: "2031-05-07" },
]);

describe("trip destinations editor (JOB-098)", () => {
  it("round-trips drafts and finds date problems", () => {
    expect(destinationsFromDrafts(drafts)).toEqual([
      { name: "Tokyo", timeZone: "Asia/Tokyo", startsOn: null, endsOn: null },
      { name: "New York", timeZone: "America/New_York", startsOn: "2031-05-04", endsOn: "2031-05-07" },
    ]);
    expect(destinationDraftProblem(drafts, "2031-05-01", "2031-05-07")).toBeNull();
    expect(destinationDraftProblem(drafts, "2031-05-01", "2031-05-06")).toBe("datesOutside");
    expect(destinationDraftProblem([{ startsOn: "2031-05-04", endsOn: "" }], "2031-05-01", "2031-05-07")).toBe("datesIncomplete");
  });

  it.each(locales)("edits every row in settings, with moves and removal, in %s", (locale) => {
    const copy = tripDestinationsMessages(locale);
    const html = renderToStaticMarkup(createElement(TripDestinationsEditor, { drafts, onChange: vi.fn(), locale,
      zoneOptions: destinationZoneOptions(locale), tripStartsOn: "2031-05-01", tripEndsOn: "2031-05-07" }));
    expect(html).toContain(copy.title);
    expect(html.match(/<input required="" maxLength="160"/gu)).toHaveLength(2);
    expect(html).toContain('value="America/New_York" selected=""');
    expect(html).toContain(`aria-label="${copy.moveUp}"`);
    expect(html).toContain(copy.add);
    expect(html).not.toContain('role="alert"');
  });

  it("shows trip creation's first destination as fixed text and only its days", () => {
    const html = renderToStaticMarkup(createElement(TripDestinationsEditor, { drafts, onChange: vi.fn(), locale: "en",
      zoneOptions: destinationZoneOptions("en"), tripStartsOn: "2031-05-01", tripEndsOn: "2031-05-06",
      fixedFirst: { name: "Tokyo", zoneLabel: "Japan / Tokyo" } }));
    expect(html).toContain("<strong>Tokyo</strong> · Japan / Tokyo");
    expect(html.match(/<input required="" maxLength="160"/gu)).toHaveLength(1);
    expect(html).not.toContain("Move up");
    expect(html).toContain(`role="alert" class="trip-destinations-error">${tripDestinationsMessages("en").datesOutside.replaceAll("'", "&#x27;")}`);
  });
});
