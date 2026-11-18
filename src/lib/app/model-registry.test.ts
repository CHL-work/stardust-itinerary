import { describe, expect, it } from "vitest";

import {
  DEFAULT_OWNER_MODEL,
  GUEST_FREE_MODEL,
  MEMBER_MODEL,
  normalizeRetiredModelId,
  normalizeStoredOwnerModel,
  ownerModelRegistry,
  ownerModels,
  providerDefaultModels,
  retiredOwnerModelReplacements,
  selectableOwnerModels,
} from "@/lib/app/types";
import { aiRequestSchema, aiSettingsSchema } from "@/lib/app/validation";

describe("owner AI model registry", () => {
  it("offers GPT-6.2 Astra through the OpenAI Codex transport at a supported effort", () => {
    expect(ownerModels).toContain("gpt-6.2-astra");
    expect(ownerModels.filter((model) => model === "gpt-6.2-astra")).toHaveLength(1);
    expect(ownerModelRegistry["gpt-6.2-astra"]).toEqual({
      provider: "openai",
      transport: "codex_sdk",
      authenticationMode: "api_key",
      reasoningEffort: "medium",
    });
  });

  it("keeps both owner and member defaults on Sol", () => {
    expect(DEFAULT_OWNER_MODEL).toBe("gpt-6.2-sol");
    expect(MEMBER_MODEL).toBe("gpt-6.2-sol");
    expect(providerDefaultModels.openai).toBe("gpt-6.2-sol");
    expect(ownerModels[0]).toBe(DEFAULT_OWNER_MODEL);
  });

  it("preserves every existing model's reasoning effort", () => {
    expect(ownerModelRegistry["gpt-6.2-sol"].reasoningEffort).toBe("low");
    expect(ownerModelRegistry["gpt-6.2-astra"].reasoningEffort).toBe("medium");
    expect(ownerModelRegistry["claude-haiku-5-5"].effort).toBe("low");
    expect(ownerModelRegistry["claude-sonnet-5-5"].effort).toBe("low");
    expect(ownerModelRegistry["claude-opus-5-5"].effort).toBe("low");
    expect(ownerModelRegistry["claude-fable-5-1"].effort).toBe("low");
  });

  it("offers free AI per request, never as the trip's keyed default (JOB-086)", () => {
    expect([...ownerModels]).toEqual([...selectableOwnerModels, GUEST_FREE_MODEL]);
    expect(selectableOwnerModels).not.toContain(GUEST_FREE_MODEL);
    expect(ownerModelRegistry[GUEST_FREE_MODEL]).toEqual({ provider: "kilo", transport: "kilo_gateway", authenticationMode: "anonymous" });
    expect(aiRequestSchema.safeParse({ prompt: "Plan dinner", model: GUEST_FREE_MODEL }).success).toBe(true);
    expect(aiSettingsSchema.safeParse({ ownerDefaultModel: GUEST_FREE_MODEL }).success).toBe(false);
  });

  it("offers only GPT 6.2 and preserves the other providers", () => {
    expect([...selectableOwnerModels]).toEqual([
      "gpt-6.2-sol", "gpt-6.2-astra",
      "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1",
      "gemini-4-argon", "gemini-3.8-flash", "gemini-3.5-flash-lite",
    ]);
    for (const retired of [
      "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
      "claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5", "claude-fable-5",
    ]) {
      expect(aiRequestSchema.safeParse({ prompt: "Plan dinner", model: retired }).success).toBe(false);
      expect(aiSettingsSchema.safeParse({ ownerDefaultModel: retired }).success).toBe(false);
    }
  });

  it("accepts the exact current Astra id and refuses guessed variants", () => {
    expect(aiRequestSchema.parse({ prompt: "Plan dinner", model: "gpt-6.2-astra" }).model)
      .toBe("gpt-6.2-astra");
    expect(aiSettingsSchema.parse({ ownerDefaultModel: "gpt-6.2-astra" }).ownerDefaultModel)
      .toBe("gpt-6.2-astra");
    expect(aiRequestSchema.safeParse({ prompt: "Plan dinner", model: "gpt-6.2-astra-latest" }).success)
      .toBe(false);
    expect(aiSettingsSchema.safeParse({ ownerDefaultModel: "GPT-6.2 Astra" }).success)
      .toBe(false);
  });

  it.each(Object.entries(retiredOwnerModelReplacements))("maps stale %s selections to %s without offering the retired model", (retired, replacement) => {
    expect(selectableOwnerModels).not.toContain(retired);
    expect(ownerModelRegistry).not.toHaveProperty(retired);
    expect(normalizeRetiredModelId(retired)).toBe(replacement);
    expect(normalizeStoredOwnerModel(retired)).toBe(replacement);
    expect(aiRequestSchema.parse({ prompt: "Plan dinner", model: retired }).model).toBe(replacement);
    expect(aiSettingsSchema.parse({ ownerDefaultModel: retired }).ownerDefaultModel).toBe(replacement);
  });

  it("preserves exact current stored models and never treats free as a keyed default", () => {
    for (const model of selectableOwnerModels) expect(normalizeStoredOwnerModel(model)).toBe(model);
    expect(normalizeRetiredModelId(GUEST_FREE_MODEL)).toBe(GUEST_FREE_MODEL);
    expect(normalizeStoredOwnerModel(GUEST_FREE_MODEL)).toBe(DEFAULT_OWNER_MODEL);
  });

  it.each([undefined, null, 42, {}, [], "gpt-6.2-sol-latest", "toString", "constructor", "__proto__"])("defaults invalid stored values but preserves invalid explicit input for schema rejection: %j", (value) => {
    expect(normalizeStoredOwnerModel(value)).toBe(DEFAULT_OWNER_MODEL);
    expect(normalizeRetiredModelId(value)).toBe(value);
    // Omission is allowed, but malformed explicit model choices must not silently select a paid model.
    if (value !== undefined) expect(aiRequestSchema.safeParse({ prompt: "Plan dinner", model: value }).success).toBe(false);
  });
});
