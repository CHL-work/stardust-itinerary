import { describe, expect, it } from "vitest";

import {
  DEFAULT_OWNER_MODEL,
  GUEST_FREE_MODEL,
  MEMBER_MODEL,
  ownerModelRegistry,
  ownerModels,
  selectableOwnerModels,
} from "@/lib/app/types";
import { aiRequestSchema, aiSettingsSchema } from "@/lib/app/validation";

describe("owner AI model registry", () => {
  it("offers GPT-6 Astra through the OpenAI Codex transport at a supported effort", () => {
    expect(ownerModels).toContain("gpt-6-astra");
    expect(ownerModels.filter((model) => model === "gpt-6-astra")).toHaveLength(1);
    expect(ownerModelRegistry["gpt-6-astra"]).toEqual({
      provider: "openai",
      transport: "codex_sdk",
      authenticationMode: "api_key",
      reasoningEffort: "medium",
    });
  });

  it("keeps both owner and member defaults on Sol", () => {
    expect(DEFAULT_OWNER_MODEL).toBe("gpt-6.1-sol");
    expect(MEMBER_MODEL).toBe("gpt-6.1-sol");
    expect(ownerModels[0]).toBe(DEFAULT_OWNER_MODEL);
  });

  it("preserves every existing model's reasoning effort", () => {
    expect(ownerModelRegistry["gpt-6.1-sol"].reasoningEffort).toBe("low");
    expect(ownerModelRegistry["gpt-6.1-terra"].reasoningEffort).toBe("medium");
    expect(ownerModelRegistry["gpt-6-luna"].reasoningEffort).toBe("medium");
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

  it("offers exactly the newest model of each family and rejects the replaced ids", () => {
    expect([...selectableOwnerModels]).toEqual([
      "gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna",
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

  it("accepts only the exact Astra id in owner request and settings input", () => {
    expect(aiRequestSchema.parse({ prompt: "Plan dinner", model: "gpt-6-astra" }).model)
      .toBe("gpt-6-astra");
    expect(aiSettingsSchema.parse({ ownerDefaultModel: "gpt-6-astra" }).ownerDefaultModel)
      .toBe("gpt-6-astra");
    expect(aiRequestSchema.safeParse({ prompt: "Plan dinner", model: "gpt-6-astra-latest" }).success)
      .toBe(false);
    expect(aiSettingsSchema.safeParse({ ownerDefaultModel: "GPT-6 Astra" }).success)
      .toBe(false);
  });
});
