import { createElement, isValidElement, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "synthetic-time-fields" }));
import { EventTimeFields } from "./event-time-fields";
import { eventEditorMessages } from "@/lib/app/event-editor-i18n";

const props = { startsLabel:"Departure", endsLabel:"Arrival", durationLabel:"Duration", copy:eventEditorMessages("en"),
  startsAt:"2026-09-11T16:00", endsAt:"2026-09-11T14:00", durationMinutes:"720", min:"2026-09-11T00:00",max:"2026-09-12T23:59",busy:false,
  changeStart:vi.fn(),changeEnd:vi.fn(),changeDuration:vi.fn(),fillNow:vi.fn() };
function descendants(node:ReactNode):ReactElement<Record<string,unknown>>[] {
  if(Array.isArray(node))return node.flatMap(descendants);
  return isValidElement<Record<string,unknown>>(node) ? [node,...descendants(node.props.children as ReactNode)] : [];
}
describe("endpoint-zoned time controls",()=>{
  it("shows each endpoint zone and does not compare departure/arrival wall-clock values",()=>{
    const html=renderToStaticMarkup(createElement(EventTimeFields,{...props,startTimeZone:"Asia/Tokyo",endTimeZone:"America/Chicago"}));
    expect(html).toContain("Asia/Tokyo");expect(html).toContain("America/Chicago");
    const inputs=html.match(/<input\b[^>]*>/gu)!;
    expect(inputs[0]).not.toContain('min=');expect(inputs[0]).not.toContain('max=');
    expect(inputs[1]).not.toContain('min=');expect(inputs[1]).not.toContain('max=');
  });
  it("passes the matching endpoint zone to each non-submit Now action",()=>{
    const fillNow=vi.fn();
    const tree=descendants(EventTimeFields({...props,fillNow,startTimeZone:"Asia/Tokyo",endTimeZone:"America/Chicago"}));
    const buttons=tree.filter(node=>node.type==="button");
    for(const button of buttons){expect(button.props.type).toBe("button");(button.props.onClick as ()=>void)();}
    expect(fillNow.mock.calls).toEqual([["startsAt","Asia/Tokyo"],["endsAt","America/Chicago"]]);
  });
  it("does not repeat zones already included in labels, or reject an earlier wall time in the same-zone DST fold",()=>{
    const html=renderToStaticMarkup(createElement(EventTimeFields,{...props,
      startsLabel:"Departure (America/New_York)",endsLabel:"Arrival (America/New_York)",
      startsAt:"2026-11-01T01:50",endsAt:"2026-11-01T01:10",startTimeZone:"America/New_York",endTimeZone:"America/New_York"}));
    expect(html.match(/America\/New_York/gu)).toHaveLength(2);
    const inputs=html.match(/<input\b[^>]*>/gu)!;
    expect(inputs[1]).not.toContain('min=');
  });
  it("preserves legacy generic-event trip-zone bounds when endpoint zones were not supplied",()=>{
    const html=renderToStaticMarkup(createElement(EventTimeFields,props));
    const inputs=html.match(/<input\b[^>]*>/gu)!;
    expect(inputs[0]).toContain(`min="${props.min}"`);expect(inputs[0]).toContain(`max="${props.max}"`);
    expect(inputs[1]).toContain(`min="${props.startsAt}"`);expect(inputs[1]).toContain(`max="${props.max}"`);
  });
});
