import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EventTimeZoneFields } from "./event-time-zone-fields";
import { flightMessages } from "@/lib/app/flight-i18n";
import { locales, messages } from "@/lib/i18n";

type SelectProps = { children?: ReactNode; value?: string; disabled?: boolean; onChange?: (event: { target: { value: string } }) => void };
function selects(node: ReactNode): SelectProps[] {
  if (Array.isArray(node)) return node.flatMap(selects);
  if (!isValidElement<SelectProps>(node)) return [];
  return node.type === "select" ? [node.props] : selects(node.props.children);
}
describe("optional location-local zone corrections", () => {
  it.each(locales)("renders one ordinary event correction and independent transport endpoints in %s", locale => {
    const props = { locale, label: messages[locale].timeZoneField, start: "", end: "America/Denver", busy: false, change: vi.fn() };
    const normal = EventTimeZoneFields({ ...props, transport: false });
    expect(selects(normal)).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(EventTimeZoneFields, { ...props, transport: false }));
    expect(html).toContain(flightMessages(locale).automaticZone);
    expect(html).toContain(messages[locale].timeZoneField);
    const endpoints = selects(EventTimeZoneFields({ ...props, transport: true }));
    expect(endpoints.map(field => field.value)).toEqual(["", "America/Denver"]);
    endpoints[1].onChange?.({ target: { value: "UTC" } });
    expect(props.change).toHaveBeenCalledWith("end", "UTC");
  });
  it("keeps an uncommon saved IANA correction visible and disables controls during save", () => {
    const props = { transport: false, locale: "en" as const, label: "Time zone", start: "Pacific/Chatham", end: "", busy: true, change: vi.fn() };
    expect(selects(EventTimeZoneFields(props))[0].disabled).toBe(true);
    expect(renderToStaticMarkup(createElement(EventTimeZoneFields, props))).toContain('value="Pacific/Chatham" selected=""');
  });
});
