import { describe, expect, it, vi } from "vitest";

import { withFreeAiCredential, withOperatorAiCredential } from "@/lib/ai/credential-context";
import { DEFAULT_FREE_MODELS, FREE_AI_ENDPOINT, freeModelLabel, generateWithFreeModel, guestFreeAiSettings } from "@/lib/ai/free-model";

const schema = { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string" } } };
const settings = { ...guestFreeAiSettings({ GUEST_FREE_AI_ENABLED: "true" }), models: ["vendor/first:free", "vendor/second:free"] };
const answer = (content: string, model = "vendor/first:free") => Response.json({
  model, choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30 },
});

describe("free guest AI on keyless free models (JOB-071)", () => {
  it("is off unless enabled, and accepts only https endpoints and ':free' models", () => {
    expect(guestFreeAiSettings({}).enabled).toBe(false);
    const enabled = guestFreeAiSettings({ GUEST_FREE_AI_ENABLED: "true" });
    expect(enabled).toMatchObject({ enabled: true, models: [...DEFAULT_FREE_MODELS], endpoint: FREE_AI_ENDPOINT,
      perGuestDaily: 10, hourly: 60, daily: 500 });
    const custom = guestFreeAiSettings({ GUEST_FREE_AI_ENABLED: "true", GUEST_FREE_AI_MODELS: "vendor/paid-model, vendor/ok:free ,bad id:free",
      GUEST_FREE_AI_ENDPOINT: "http://gateway.example/v1/chat/completions", GUEST_FREE_AI_HOURLY: "500", GUEST_FREE_AI_PER_GUEST_DAILY: "3" });
    expect(custom).toMatchObject({ models: ["vendor/ok:free"], endpoint: FREE_AI_ENDPOINT, hourly: 60, perGuestDaily: 3 });
    expect(guestFreeAiSettings({ GUEST_FREE_AI_ENABLED: "true", GUEST_FREE_AI_MODELS: "vendor/paid-model" }).enabled).toBe(false);
    expect(freeModelLabel("nvidia/nemotron-3.5-super-vl:free")).toBe("NVIDIA Nemotron 3.5 Super");
    expect(freeModelLabel("vendor/unknown:free")).toBe("vendor/unknown");
  });

  it("refuses to run outside a free context, so keyed requests can never reach the free gateway", async () => {
    const fetchImpl = vi.fn();
    await expect(withOperatorAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings, fetchImpl })))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_AUTH_REQUIRED", provider: "kilo" } });
    await expect(generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings, fetchImpl })).rejects.toThrow(/credential context/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends no key, names Stardust honestly, enforces the schema and never follows redirects", async () => {
    const fetchImpl = vi.fn(async () => answer('{"message":"Here is a plan."}'));
    const result = await withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan a day", responseJsonSchema: schema, settings,
      fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(result).toEqual({ text: '{"message":"Here is a plan."}', model: "vendor/first:free", inputTokens: 120, outputTokens: 30, cachedInputTokens: null });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(FREE_AI_ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("authorization");
    expect(headers["User-Agent"]).toMatch(/^StardustItinerary\//u);
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "vendor/first:free", messages: [{ role: "user", content: "Plan a day" }],
      response_format: { type: "json_schema", json_schema: { name: "stardust_planner", strict: true, schema } } });
  });

  it("falls back to the next free model when one is gone or empty, but stops at the per-address rate limit", async () => {
    const gone = vi.fn(async (_url: string, init: RequestInit) => JSON.parse(String(init.body)).model === "vendor/first:free"
      ? Response.json({ error: { message: "No such model" } }, { status: 404 }) : answer('{"message":"ok"}', "vendor/second:free"));
    const result = await withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings,
      fetchImpl: gone as unknown as typeof fetch }));
    expect(result.model).toBe("vendor/second:free");
    expect(gone).toHaveBeenCalledTimes(2);

    const limited = vi.fn(async () => Response.json({ error: { message: "Rate limit" } }, { status: 429 }));
    await expect(withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings,
      fetchImpl: limited as unknown as typeof fetch }))).rejects.toMatchObject({ details: { code: "AI_PROVIDER_RATE_LIMITED", provider: "kilo" } });
    expect(limited).toHaveBeenCalledTimes(1);

    const empty = vi.fn(async () => answer(""));
    await expect(withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings,
      fetchImpl: empty as unknown as typeof fetch }))).rejects.toMatchObject({ details: { code: "AI_PROVIDER_OUTPUT_INVALID" } });
    expect(empty).toHaveBeenCalledTimes(2);
  });
});
