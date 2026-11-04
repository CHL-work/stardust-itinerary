import { describe, expect, it } from "vitest";

import {
  containsPrivateIdentifier,
  sanitizePublicSourceUrl,
  sanitizePublicText,
} from "@/lib/disruptions/privacy";

describe("disruption privacy", () => {
  it("redacts identifiers before public search context or logs", () => {
    const value = sanitizePublicText(
      "mail owner@example.com booking 999999999999 id 31000000-0000-4000-8000-000000000004",
    );
    expect(value).toBe("mail [redacted] booking [redacted] id [redacted]");
    expect(containsPrivateIdentifier(value)).toBe(false);
  });

  it("keeps only public source URLs and removes sensitive query material", () => {
    expect(sanitizePublicSourceUrl("https://status.example.com/notices/train?lang=en#today"))
      .toBe("https://status.example.com/notices/train?lang=en");
    expect(sanitizePublicSourceUrl("https://status.example.com/train?session=secret"))
      .toBe("https://status.example.com/train");
    expect(sanitizePublicSourceUrl("https://hotels.example.com/reserves/999999999999/complete"))
      .toBeNull();
    expect(sanitizePublicSourceUrl("http://status.example.com/notices/train"))
      .toBeNull();
    expect(sanitizePublicSourceUrl("http://127.0.0.1/internal"))
      .toBeNull();
  });
});
