import { describe, expect, it } from "vitest";

import { readSectionOpen, saveSectionOpen } from "@/lib/ai/section-preference";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe("AI tab section memory (JOB-093)", () => {
  it("remembers each section separately and keeps the default otherwise", () => {
    const store = storage();
    expect(readSectionOpen("usage", false, store)).toBe(false);
    saveSectionOpen("usage", true, store);
    saveSectionOpen("chat", false, store);
    expect(readSectionOpen("usage", false, store)).toBe(true);
    expect(readSectionOpen("chat", true, store)).toBe(false);
    expect(readSectionOpen("keys", true, store)).toBe(true);
    expect(JSON.parse(store.values.get("stardust.ai-tab.sections")!)).toEqual({ usage: true, chat: false });
  });

  it("falls back to defaults when storage is missing, corrupt or throws", () => {
    expect(readSectionOpen("usage", true, null)).toBe(true);
    expect(readSectionOpen("usage", false, storage({ "stardust.ai-tab.sections": "{not json" }))).toBe(false);
    expect(readSectionOpen("usage", false, storage({ "stardust.ai-tab.sections": '{"usage":"yes"}' }))).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readSectionOpen("usage", true, broken)).toBe(true);
    expect(() => saveSectionOpen("usage", false, broken)).not.toThrow();
  });
});
