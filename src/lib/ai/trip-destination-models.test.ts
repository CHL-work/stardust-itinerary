import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderFailureError } from "@/lib/ai/provider-failure";

const mocks = vi.hoisted(() => ({ freeModel: vi.fn() }));
vi.mock("@/lib/ai/free-model", () => ({ generateWithFreeModel: mocks.freeModel }));

import { FREE_LOOKUP_OUTPUT_TOKENS, lookupTripDestinationWith } from "@/lib/ai/trip-destination-models";

const tokyo = JSON.stringify({ status: "resolved", countryCode: "JP", timeZone: "Asia/Tokyo", timeZoneCandidates: [], currency: "JPY", currencyCandidates: [] });

// A block body: vitest would call a returned function (the mock itself) as teardown.
beforeEach(() => { mocks.freeModel.mockReset(); });

describe("free trip-setup lookup (JOB-099)", () => {
  it("gives free reasoning models room to think before the small validated answer", async () => {
    mocks.freeModel.mockResolvedValue({ text: tokyo, model: "reflection/beam-free", inputTokens: 304, outputTokens: 2300, cachedInputTokens: null });
    const result = await lookupTripDestinationWith({ kind: "free" }, { destination: "Tokyo, Japan", locale: "en" });
    expect(FREE_LOOKUP_OUTPUT_TOKENS).toBe(4096);
    expect(mocks.freeModel).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 4096 }));
    expect(mocks.freeModel.mock.calls[0]![0]).not.toHaveProperty("selectedModel");
    expect(result).toMatchObject({ effectiveModel: "reflection/beam-free", defaults: { countryCode: "JP", timeZone: "Asia/Tokyo", currency: "JPY" } });
  });

  it("still refuses an oversized or invalid answer and maps provider failures", async () => {
    mocks.freeModel.mockResolvedValue({ text: `${tokyo}${" ".repeat(5000)}`, model: "reflection/beam-free", inputTokens: 1, outputTokens: 1, cachedInputTokens: null });
    await expect(lookupTripDestinationWith({ kind: "free" }, { destination: "Tokyo, Japan", locale: "en" })).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    mocks.freeModel.mockRejectedValue(new AiProviderFailureError({ code: "AI_PROVIDER_RATE_LIMITED", provider: "kilo" }));
    await expect(lookupTripDestinationWith({ kind: "free" }, { destination: "Tokyo, Japan", locale: "en" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
