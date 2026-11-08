import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventTypeIcon, eventIconKind } from "./event-type-icon";

describe("lightweight event type icons", () => {
  it.each([
    ["activity", "compass"], ["meal", "utensils-crossed"], ["lodging", "hotel"],
    ["transport", "route"], ["note", "notebook-pen"], ["unknown-old-type", "compass"],
  ])("uses a local SVG for %s without an image, request or focus target", (itemType, glyph) => {
    const markup = renderToStaticMarkup(createElement(EventTypeIcon, { itemType }));
    expect(markup).toContain(`lucide-${glyph}`);
    expect(markup).toContain('width="18"');
    expect(markup).toContain('height="18"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).not.toMatch(/<(?:img|image|use|script)|\b(?:src|href|tabindex|aria-label)=/iu);
    expect(markup).not.toContain("<title");
  });

  it("uses structured flight state only for transport and distinguishes its endpoints", () => {
    expect(eventIconKind({ itemType: "transport", isFlight: true })).toBe("flight");
    expect(eventIconKind({ itemType: "transport", isFlight: true, endpoint: "departure" })).toBe("flight-departure");
    expect(eventIconKind({ itemType: "transport", isFlight: true, endpoint: "arrival" })).toBe("flight-arrival");
    expect(eventIconKind({ itemType: "transport", endpoint: "arrival" })).toBe("transport");
    expect(eventIconKind({ itemType: "meal", isFlight: true })).toBe("meal");
    expect(eventIconKind({ itemType: "Flight to Tokyo" })).toBe("activity");
  });

  it("renders flight takeoff and arrival glyphs at the caller's fixed size", () => {
    for (const [endpoint, glyph] of [["departure", "plane-takeoff"], ["arrival", "plane-landing"]] as const) {
      const markup = renderToStaticMarkup(createElement(EventTypeIcon, { itemType: "transport", isFlight: true, endpoint, size: 16 }));
      expect(markup).toContain(`lucide-${glyph}`);
      expect(markup).toContain('width="16"');
      expect(markup).toContain('height="16"');
    }
  });
});
