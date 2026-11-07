import { describe, expect, it, vi } from "vitest";
import { withFreeAiCredential, withOperatorAiCredential } from "@/lib/ai/credential-context";
import { DEFAULT_FREE_MODELS, FREE_AI_CATALOG, FREE_AI_ENDPOINT, eligibleFreeCatalogModels, freeAiSettings,
  freeModelLabel, generateWithFreeModel, guestFreeAiSettings, listAvailableFreeModels } from "@/lib/ai/free-model";

const schema = { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string" } } };
const settings = { ...freeAiSettings({ FREE_AI_ENABLED: "true" }), models: ["vendor/first:free", "vendor/second-free"] };
const row = (id: string) => ({ id, isFree: true, pricing: { prompt: "0", completion: "0" },
  supported_parameters: ["response_format", "structured_outputs"], top_provider: { max_completion_tokens: 8192 } });
const answer = (content = '{"message":"Plan dinner"}') => Response.json({ choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 120, completion_tokens: 30 } });
function mockGateway(reply: (init: RequestInit) => Response | Promise<Response> = () => answer(), rows: unknown[] = settings.models.map(row)) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url) === FREE_AI_CATALOG
    ? Response.json({ data: rows }) : reply(init!));
}
const generate = (fetchImpl: ReturnType<typeof mockGateway>, extra: Partial<Parameters<typeof generateWithFreeModel>[0]> = {}) =>
  withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan a synthetic dinner", responseJsonSchema: schema, settings,
    fetchImpl: fetchImpl as typeof fetch, ...extra }));

describe("free model configuration", () => {
  it("defaults off; canonical switches override legacy values and bounded quotas stay compatible", () => {
    expect(freeAiSettings({}).enabled).toBe(false);
    expect(freeAiSettings({ FREE_AI_ENABLED: "false", GUEST_FREE_AI_ENABLED: "true" }).enabled).toBe(false);
    expect(guestFreeAiSettings({ GUEST_FREE_AI_ENABLED: "true", GUEST_FREE_AI_PER_GUEST_DAILY: "3" }))
      .toMatchObject({ enabled: true, perGuestDaily: 3, perUserDaily: 3, hourly: 60, daily: 500, models: [...DEFAULT_FREE_MODELS] });
    expect(freeAiSettings({ FREE_AI_ENABLED: "true", FREE_AI_PER_USER_DAILY: "20", FREE_AI_HOURLY: "999" }))
      .toMatchObject({ enabled: true, perUserDaily: 20, hourly: 60 });
  });
  it("pins the service, removes restricted/opaque trial models, bounds the pool and does not trust a free suffix", () => {
    expect(freeAiSettings({ FREE_AI_ENABLED: "true", FREE_AI_ENDPOINT: "https://another.example/v1/chat/completions" }).enabled).toBe(false);
    expect(freeAiSettings({ FREE_AI_ENABLED: "true", FREE_AI_MODELS: "nvidia/trial:free,kilo-auto/free,openrouter/free,stealth/unknown" }).enabled).toBe(false);
    expect(freeAiSettings({ FREE_AI_ENABLED: "true", FREE_AI_MODELS: "vendor/paid,vendor/ok-free,bad id, vendor/paid" }).models)
      .toEqual(["vendor/paid", "vendor/ok-free"]); // pricing is verified from the catalog, before inference
    expect(freeModelLabel(DEFAULT_FREE_MODELS[0])).toBe("dots.3 note");
    expect(freeModelLabel("vendor/unknown:free")).toBe("vendor/unknown");
  });
});

describe("fresh free catalog verification", () => {
  it("lists every supported free model, not only automatic preferences, without an inference or credential", async () => {
    const fetchImpl = mockGateway(() => answer(), [row("vendor/third:free"), row(settings.models[1]!), row(settings.models[0]!),
      row(settings.models[0]!), { ...row("vendor/paid:free"), pricing: { prompt: "1", completion: "1" } }, row("nvidia/trial:free")]);
    expect(await listAvailableFreeModels({ settings, fetchImpl })).toEqual({
      models: [
        { id: settings.models[0], label: "vendor/first" },
        { id: settings.models[1], label: "vendor/second-free" },
        { id: "vendor/third:free", label: "vendor/third" },
      ], defaultModel: settings.models[0],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(FREE_AI_CATALOG);
    expect(fetchImpl.mock.calls[0]![1]?.headers).not.toHaveProperty("Authorization");
  });

  it("returns an empty safe catalog if no supported free model remains; disabled config makes no request", async () => {
    const fetchImpl = mockGateway(() => answer(), []);
    expect(await listAvailableFreeModels({ settings, fetchImpl })).toEqual({ models: [], defaultModel: null });
    fetchImpl.mockClear();
    await expect(listAvailableFreeModels({ settings: { ...settings, enabled: false }, fetchImpl }))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_UNAVAILABLE" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose gateway text when catalog parsing or transport fails", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("private-upstream-detail"); });
    await expect(listAvailableFreeModels({ settings, fetchImpl }))
      .rejects.toMatchObject({ message: "AI_PROVIDER_UNAVAILABLE", details: { provider: "kilo" } });
  });
  it("accepts zero-price schema models with or without :free; rejects unverified prices, capabilities and restrictions", () => {
    const valid = row("vendor/valid-free");
    const result = eligibleFreeCatalogModels({ data: [valid,
      { ...row("vendor/paid:free"), pricing: { prompt: "0.01", completion: "0" } },
      { ...row("vendor/unknown:free"), pricing: { prompt: "0" } },
      { ...row("vendor/request:free"), pricing: { prompt: "0", completion: "0", request: "0.1" } },
      { ...row("vendor/unlisted:free"), isFree: false },
      { ...row("vendor/no-schema:free"), supported_parameters: ["response_format"] },
      { ...row("vendor/expired:free"), expiration_date: "2020-01-01" },
      { ...row("vendor/restricted:free"), description: "Do not send personal or confidential data" },
      row("nvidia/test:free"), row("openrouter/free"), row("stealth/unknown"),
    ] });
    expect(result).toEqual([{ id: "vendor/valid-free", maxOutputTokens: 8192 }]);
  });
  it("does not POST when a configured model disappears, becomes paid or catalog fetch fails", async () => {
    const missing = mockGateway(() => answer(), []);
    await expect(generate(missing)).rejects.toMatchObject({ details: { code: "AI_PROVIDER_MODEL_UNAVAILABLE" } });
    expect(missing).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn(async () => Response.json({}, { status: 503 }));
    await expect(generate(unavailable)).rejects.toMatchObject({ details: { code: "AI_PROVIDER_UNAVAILABLE" } });
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
});

describe("keyless gateway calls", () => {
  it("honors an explicit eligible model outside the auto-fallback preferences", async () => {
    const fetchImpl = mockGateway(() => answer(), [...settings.models.map(row), row("vendor/third:free")]);
    expect((await generate(fetchImpl, { selectedModel: "vendor/third:free" })).model).toBe("vendor/third:free");
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)).model).toBe("vendor/third:free");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(["vendor/unknown:free", "vendor/paid:free", "nvidia/trial:free", "https://example.test/model", ""])(
    "refuses an ineligible explicit choice %s before inference", async (selectedModel) => {
      const fetchImpl = mockGateway(() => answer(), [...settings.models.map(row),
        { ...row("vendor/paid:free"), pricing: { prompt: "0.1", completion: "0" } }, row("nvidia/trial:free")]);
      await expect(generate(fetchImpl, { selectedModel })).rejects.toMatchObject({ details: { code: "AI_PROVIDER_MODEL_UNAVAILABLE" } });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([404, 503])("does not substitute another model after an explicit choice fails with %s", async (status) => {
    const fetchImpl = mockGateway(() => Response.json({}, { status }));
    const reserve = vi.fn(async () => {});
    await expect(generate(fetchImpl, { selectedModel: settings.models[0], beforeAttempt: reserve })).rejects.toMatchObject({
      details: { code: status === 404 ? "AI_PROVIDER_MODEL_UNAVAILABLE" : "AI_PROVIDER_UNAVAILABLE" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(1);
  });
  it("refuses keyed/missing contexts and disabled configurations before any network request", async () => {
    const fetchImpl = mockGateway();
    await expect(withOperatorAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings, fetchImpl })))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_AUTH_REQUIRED" } });
    await expect(generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings, fetchImpl })).rejects.toThrow(/credential context/u);
    await expect(generate(fetchImpl, { settings: { ...settings, enabled: false } })).rejects.toMatchObject({ details: { code: "AI_PROVIDER_AUTH_REQUIRED" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uses the fixed catalog/service, no key/identity, honest agent, no redirects and bounded schema output", async () => {
    const fetchImpl = mockGateway();
    const reserve = vi.fn(async () => {});
    expect(await generate(fetchImpl, { beforeAttempt: reserve })).toEqual({ text: '{"message":"Plan dinner"}', model: settings.models[0],
      inputTokens: 120, outputTokens: 30, cachedInputTokens: null });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect([FREE_AI_CATALOG, FREE_AI_ENDPOINT]).toContain(String(url));
      expect(init?.redirect).toBe("error");
      expect(Object.keys(init?.headers ?? {}).map((key) => key.toLowerCase())).not.toContain("authorization");
      expect(init?.headers).toMatchObject({ "User-Agent": expect.stringMatching(/^StardustItinerary\//u) });
    }
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body))).toMatchObject({ model: settings.models[0], max_tokens: 8192,
      response_format: { type: "json_schema", json_schema: { strict: true, schema } } });
  });
  it("reserves every fallback, but never sends after quota reservation fails", async () => {
    const fetchImpl = mockGateway((init) => JSON.parse(String(init.body)).model === settings.models[0]
      ? Response.json({}, { status: 404 }) : answer());
    const reserve = vi.fn(async () => {});
    expect((await generate(fetchImpl, { beforeAttempt: reserve })).model).toBe(settings.models[1]);
    expect(reserve).toHaveBeenCalledTimes(2);
    const capped = mockGateway();
    await expect(generate(capped, { beforeAttempt: async () => { throw new Error("Synthetic attempt cap"); } })).rejects.toThrow("Synthetic attempt cap");
    expect(capped).toHaveBeenCalledTimes(1);
  });
  it.each([401, 402, 403, 429])("stops at %s instead of trying models/keys to evade the service restriction", async (status) => {
    const fetchImpl = mockGateway(() => Response.json({ privateDetail: "Never expose" }, { status, headers: { "Retry-After": "120" } }));
    await expect(generate(fetchImpl)).rejects.toMatchObject({ details: { code: status === 429 ? "AI_PROVIDER_RATE_LIMITED" : "AI_PROVIDER_AUTH_REQUIRED",
      ...(status === 429 ? { retryAt: expect.any(String) } : {}) } });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // catalog + exactly one completion
  });
  it("rejects partial, oversized and empty output without exposing provider content", async () => {
    for (const response of [() => answer(""), () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
      () => Response.json({ choices: [{ message: { content: '{}' }, finish_reason: "length" }] })]) {
      const fetchImpl = mockGateway(response);
      await expect(generate(fetchImpl)).rejects.toMatchObject({ details: { code: "AI_PROVIDER_OUTPUT_INVALID" } });
    }
  });
});
