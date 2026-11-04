import { describe, expect, it } from "vitest";

import {
  parsePendingCalendarSync,
  serializePendingCalendarSync,
} from "@/lib/calendar/pending-sync";

describe("pending Calendar sync", () => {
  it("round-trips a connect-only intent", () => {
    expect(parsePendingCalendarSync(serializePendingCalendarSync({ mode: "connect" }))).toEqual({ mode: "connect" });
  });

  it("round-trips an add-all request", () => {
    expect(parsePendingCalendarSync(serializePendingCalendarSync({ mode: "all" }))).toEqual({ mode: "all" });
  });

  it("round-trips a single-event request", () => {
    const intent = { mode: "item" as const, itemId: "8b639b39-f27b-4ad8-b681-ad5a978b1330" };
    expect(parsePendingCalendarSync(serializePendingCalendarSync(intent))).toEqual(intent);
  });

  it("rejects malformed or untrusted browser storage", () => {
    expect(parsePendingCalendarSync("not-json")).toBeNull();
    expect(parsePendingCalendarSync(JSON.stringify({ mode: "item", itemId: "not-a-uuid" }))).toBeNull();
    expect(parsePendingCalendarSync(JSON.stringify({ mode: "delete", itemId: crypto.randomUUID() }))).toBeNull();
  });
});
