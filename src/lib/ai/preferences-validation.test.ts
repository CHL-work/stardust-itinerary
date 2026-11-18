import { describe, expect, it } from "vitest";
import { aiPreferencesInputSchema } from "@/lib/ai/preferences";
import { retiredOwnerModelReplacements } from "@/lib/app/types";

describe("routine model compatibility", () => {
  it.each(Object.entries(retiredOwnerModelReplacements))("maps stale %s to %s", (model, expected) => {
    const parsed = aiPreferencesInputSchema.parse({ expectedRevision: 2, routine: { enabled: true, model } });
    expect(parsed.routine?.model).toBe(expected);
  });

  it.each(["guest-free", "gpt-6.2-terra", "gpt-6.2-sol-latest", "constructor", null, 42])("rejects unsupported explicit model %j", (model) => {
    expect(aiPreferencesInputSchema.safeParse({ expectedRevision: 2, routine: { enabled: true, model } }).success).toBe(false);
  });

  it("keeps omitted model and the non-OpenAI providers unchanged", () => {
    expect(aiPreferencesInputSchema.parse({ expectedRevision: 0, routine: { enabled: false } }).routine).toEqual({ enabled: false });
    for (const model of ["claude-opus-5-5", "gemini-4-argon"]) {
      expect(aiPreferencesInputSchema.parse({ expectedRevision: 0, routine: { enabled: true, model } }).routine?.model).toBe(model);
    }
  });
});
