import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CalendarTimelineCard, safeCalendarUrl } from "./calendar-timeline-card";
import { calendarImportMessages } from "@/lib/calendar/import-i18n";
import { projectPersonalCalendarEvents } from "@/lib/calendar/timeline";
import { locales } from "@/lib/i18n";

const point = projectPersonalCalendarEvents([{ id: "synthetic-source", title: "Synthetic <appointment>", startsAt: "2030-04-01T14:00:00Z", endsAt: "2030-04-01T16:00:00Z", location: "Synthetic venue", htmlLink: "https://calendar.google.com/calendar/event?eid=synthetic", linkedItineraryItemId: null }], ["2030-04-01", "2030-04-02"], "Asia/Tokyo")[0];
function buttons(node: ReactNode): Array<{ onClick?: () => void; disabled?: boolean }> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return [];
  return node.type === "button" ? [node.props] : buttons(node.props.children);
}
const defaults = { point, locale: "en" as const, timeZone: "Asia/Tokyo", canImport: true, busy: false, openImport: vi.fn() };
describe("personal Calendar timeline card", () => {
  it("shows a Salt Lake City hotel in local time inside a Dallas trip", () => {
    const event = { ...point.event, startsAt: "2030-04-01T21:00:00Z", endsAt: "2030-04-02T17:00:00Z",
      location: "Synthetic hotel, Salt Lake City, Utah", timeZones: { start: "America/Chicago", end: "America/Chicago" } };
    const localPoint = projectPersonalCalendarEvents([event], ["2030-04-01", "2030-04-02"], "America/Chicago")[0];
    const html = renderToStaticMarkup(createElement(CalendarTimelineCard, { ...defaults, point: localPoint, timeZone: "America/Chicago" }));
    expect(html).toContain("03:00 PM MDT"); expect(html).toContain("Apr 2, 11:00 AM MDT");
    expect(html).not.toContain("Trip time"); expect(localPoint.date).toBe("2030-04-01");
  });
  it.each(locales)("renders a private source, real local range and explicit import in %s", (locale) => {
    const openImport = vi.fn(); const node = CalendarTimelineCard({ ...defaults, locale, openImport });
    const html = renderToStaticMarkup(node); const copy = calendarImportMessages(locale);
    expect(html).toContain(copy.personal); expect(html).toContain(copy.add); expect(html).toContain(copy.open);
    expect(html).toContain("Synthetic &lt;appointment&gt;"); expect(html).toContain("Synthetic venue");
    expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noreferrer"');
    expect(openImport).not.toHaveBeenCalled(); buttons(node)[0].onClick?.(); expect(openImport).toHaveBeenCalledExactlyOnceWith(point.event.id);
  });
  it.each(["pending", "approved", "rejected", "invalidated"])("does not offer duplicate add for %s source receipt", (status) => {
    const html = renderToStaticMarkup(createElement(CalendarTimelineCard, { ...defaults, point: { ...point, event: { ...point.event, importState: { status } } } }));
    expect(html).not.toContain(calendarImportMessages("en").add);
  });
  it("keeps the source link but no import control for viewers and linked sources", () => {
    expect(buttons(CalendarTimelineCard({ ...defaults, canImport: false }))).toEqual([]);
    expect(buttons(CalendarTimelineCard({ ...defaults, point: { ...point, event: { ...point.event, linkedItineraryItemId: "canonical" } } }))).toEqual([]);
    expect(buttons(CalendarTimelineCard({ ...defaults, busy: true }))[0].disabled).toBe(true);
  });
  it("shows an all-day label rather than inventing a 09:00 start", () => {
    const html = renderToStaticMarkup(createElement(CalendarTimelineCard, { ...defaults, point: { ...point, allDay: true, at: null } }));
    expect(html).toContain("All day"); expect(html).not.toContain("09:00"); expect(html).not.toContain("23:00");
  });
  it("owns actions only once in itinerary but enables selected-day continuation actions", () => {
    const continuation = { ...point, ownsActions: false, continued: true };
    expect(buttons(CalendarTimelineCard({ ...defaults, point: continuation }))).toEqual([]);
    expect(buttons(CalendarTimelineCard({ ...defaults, point: continuation, allowActionFallback: true }))).toHaveLength(1);
  });
  it.each(["javascript:alert(1)", "http://calendar.google.com", "https://evil.example.test/calendar", "https://user:secret@calendar.google.com/calendar"])("does not render unsafe Calendar URL %s", (url) => {
    expect(safeCalendarUrl(url)).toBeNull();
    expect(renderToStaticMarkup(createElement(CalendarTimelineCard, { ...defaults, point: { ...point, event: { ...point.event, htmlLink: url } } }))).not.toContain('target="_blank"');
  });
});
