import { describe, expect, it } from "vitest";

import { decryptCalendarToken, encryptCalendarToken } from "@/lib/calendar/tokens";

describe("calendar token encryption", () => {
  it("round trips without storing plaintext", () => {
    const encrypted = encryptCalendarToken("a".repeat(32), "synthetic-refresh-token");
    expect(encrypted).not.toContain("synthetic-refresh-token");
    expect(decryptCalendarToken("a".repeat(32), encrypted)).toBe("synthetic-refresh-token");
  });

  it("rejects a modified envelope", () => {
    const encrypted = encryptCalendarToken("a".repeat(32), "synthetic-token");
    expect(() => decryptCalendarToken("b".repeat(32), encrypted)).toThrow();
  });
});
