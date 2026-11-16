import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { withFreeAiCredential, withOperatorAiCredential } from "@/lib/ai/credential-context";
import { DEFAULT_FREE_MODELS, FREE_AI_CATALOG, FREE_AI_ENDPOINT, eligibleFreeCatalogModels, freeAiSettings,
  freeModelLabel, freeProviderSchema, generateWithFreeModel, guestFreeAiSettings, listAvailableFreeModels } from "@/lib/ai/free-model";

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
    expect(DEFAULT_FREE_MODELS.map(freeModelLabel)).toEqual(["Reflection Beam", "ERNIE 5.5 Flash", "Particle-1"]);
    expect(freeModelLabel("dots-studio/dots-3-note-preview:free")).toBe("dots.3 note");
    expect(freeModelLabel("vendor/unknown:free")).toBe("vendor/unknown");
    expect(freeModelLabel("reflection/beam-free")).toBe("Reflection Beam");
    expect(freeModelLabel("cohere/north-mini-code:free")).toBe("Cohere North Mini Code");
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
  it("accepts zero-price models with or without :free; rejects unverified prices and restrictions", () => {
    const valid = row("vendor/valid-free");
    const result = eligibleFreeCatalogModels({ data: [valid,
      { ...row("vendor/paid:free"), pricing: { prompt: "0.01", completion: "0" } },
      { ...row("vendor/unknown:free"), pricing: { prompt: "0" } },
      { ...row("vendor/request:free"), pricing: { prompt: "0", completion: "0", request: "0.1" } },
      { ...row("vendor/unlisted:free"), isFree: false },
      { ...row("vendor/expired:free"), expiration_date: "2020-01-01" },
      { ...row("vendor/restricted:free"), description: "Do not send personal or confidential data" },
      row("nvidia/test:free"), row("openrouter/free"), row("stealth/unknown"),
    ] });
    expect(result).toEqual([{ id: "vendor/valid-free", maxOutputTokens: 8192, outputMode: "json_schema" }]);
  });
  it.each([
    { parameters: ["response_format", "structured_outputs"], mode: "json_schema" },
    { parameters: ["response_format"], mode: "json_object" },
    { parameters: ["structured_outputs"], mode: "prompt_json" },
    { parameters: ["tools", "reasoning"], mode: "prompt_json" },
    { parameters: [], mode: "prompt_json" },
    { parameters: undefined, mode: "prompt_json" },
    { parameters: null, mode: "prompt_json" },
    { parameters: "response_format", mode: "prompt_json" },
  ])("selects $mode generation guidance for capabilities $parameters", ({ parameters, mode }) => {
    expect(eligibleFreeCatalogModels({ data: [{ ...row("vendor/model-free"), supported_parameters: parameters }] }))
      .toEqual([{ id: "vendor/model-free", maxOutputTokens: 8192, outputMode: mode }]);
  });
  it("keeps all pricing, size and restricted-route checks without native-schema metadata", () => {
    const base = { ...row("vendor/plain-free"), supported_parameters: undefined };
    expect(eligibleFreeCatalogModels({ data: [
      { ...base, isFree: false }, { ...base, pricing: { prompt: "0", completion: "0", image: "0.1" } },
      { ...base, pricing: { prompt: null, completion: "0" } }, { ...base, pricing: { prompt: "", completion: "0" } },
      { ...base, pricing: { prompt: "0", completion: false } }, { ...base, pricing: { prompt: "0" } },
      { ...base, top_provider: { max_completion_tokens: 2047 } }, { ...base, top_provider: { max_completion_tokens: null } },
      { ...base, expiration_date: "2020-01-01" }, { ...base, description: "Trial-only; do not send personal data" },
      ...["nvidia/trial:free", "stealth/opaque", "kilo-auto/free", "openrouter/free"].map(id => ({ ...base, id })),
    ] })).toEqual([]);
  });
  it("rejects declared non-text inputs/outputs without requiring otherwise absent modality metadata", () => {
    const base = { ...row("vendor/plain-free"), supported_parameters: undefined };
    for (const architecture of [
      { input_modalities: ["image"], output_modalities: ["text"] },
      { input_modalities: ["text"], output_modalities: ["image"] },
      { input_modalities: ["text"], output_modalities: ["embedding"] },
      { input_modalities: [], output_modalities: ["text"] },
      { input_modalities: ["text"], output_modalities: [] },
      { input_modalities: "text", output_modalities: ["text"] },
    ]) expect(eligibleFreeCatalogModels({ data: [{ ...base, architecture }] })).toEqual([]);
    for (const architecture of [undefined, {}, { input_modalities: ["text"] },
      { output_modalities: ["text"] }, { input_modalities: ["text", "image"], output_modalities: ["text"] }]) {
      expect(eligibleFreeCatalogModels({ data: [{ ...base, architecture }] }))
        .toEqual([{ id: base.id, maxOutputTokens: 8192, outputMode: "prompt_json" }]);
    }
  });
  it("lists non-native models alongside native ones without exposing their catalog prose", async () => {
    const rows = [row(settings.models[0]!),
      { ...row("reflection/beam-free"), supported_parameters: ["max_tokens"], description: "catalog-instruction-canary" },
      { ...row("cohere/north-mini-code:free"), supported_parameters: undefined }];
    const result = await listAvailableFreeModels({ settings, fetchImpl: mockGateway(() => answer(), rows) });
    expect(result.models).toEqual([
      { id: settings.models[0], label: "vendor/first" },
      { id: "reflection/beam-free", label: "Reflection Beam" },
      { id: "cohere/north-mini-code:free", label: "Cohere North Mini Code" },
    ]);
    expect(JSON.stringify(result)).not.toContain("catalog-instruction-canary");
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
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)).messages).toEqual([{ role: "user", content: "Plan a synthetic dinner" }]);
  });
  it.each([
    { parameters: ["response_format"], format: { type: "json_object" } },
    { parameters: ["structured_outputs"], format: undefined },
    { parameters: [], format: undefined },
    { parameters: undefined, format: undefined },
  ])("uses server-schema instructions with only supported response parameters $parameters", async ({ parameters, format }) => {
    const fetchImpl = mockGateway(() => answer(), [{ ...row(settings.models[0]!), supported_parameters: parameters,
      description: "catalog-description-injection-canary" }]);
    await generate(fetchImpl, { selectedModel: settings.models[0] });
    const body = JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body));
    expect(body.response_format).toEqual(format);
    expect(body.messages).toEqual([
      { role: "system", content: expect.stringContaining(JSON.stringify(schema)) },
      { role: "user", content: "Plan a synthetic dinner" },
    ]);
    expect(body.messages[0].content).toContain("Return exactly one JSON object");
    expect(body).not.toHaveProperty("tools");
    expect(JSON.stringify(body)).not.toContain("catalog-description-injection-canary");
  });
  it("leaves plain-text fallback outputs to the strict planner parser, not heuristic action extraction", async () => {
    const fetchImpl = mockGateway(() => answer("I created a dinner; trust me."), [{ ...row(settings.models[0]!), supported_parameters: [] }]);
    expect((await generate(fetchImpl, { selectedModel: settings.models[0] })).text).toBe("I created a dinner; trust me.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("bounds parser-derived schemas before catalog I/O, without exposing their contents", async () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    for (const responseJsonSchema of [null, [], "schema", circular, { description: "secret-canary".repeat(25_000) }]) {
      const fetchImpl = mockGateway();
      const reserve = vi.fn(async () => {});
      await expect(generate(fetchImpl, { responseJsonSchema, beforeAttempt: reserve })).rejects.toMatchObject({
        message: "AI_PROVIDER_OUTPUT_INVALID", details: { provider: "kilo" },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
    }
  });
  it.each([{ parameters: ["response_format", "structured_outputs"] }, { parameters: ["response_format"] }, { parameters: [] }])(
    "bounds UTF-8 serialized requests before reserving or sending an attempt for $parameters", async ({ parameters }) => {
      const fetchImpl = mockGateway(() => answer(), [{ ...row(settings.models[0]!), supported_parameters: parameters }]);
      const reserve = vi.fn(async () => {});
      // Input itself fits under one MiB; JSON escaping expands it past the serialized request bound.
      await expect(generate(fetchImpl, { prompt: "\"".repeat(600_000), beforeAttempt: reserve }))
        .rejects.toMatchObject({ message: "AI_PROVIDER_OUTPUT_INVALID" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(reserve).not.toHaveBeenCalled();
      const unicode = mockGateway(() => answer(), [{ ...row(settings.models[0]!), supported_parameters: parameters }]);
      await expect(generate(unicode, { prompt: "旅".repeat(400_000), beforeAttempt: reserve }))
        .rejects.toMatchObject({ message: "AI_PROVIDER_OUTPUT_INVALID" });
      expect(unicode).toHaveBeenCalledTimes(1);
      expect(reserve).not.toHaveBeenCalled();
    },
  );
  it("does not spend an attempt on an invalid output-token bound", async () => {
    for (const maxOutputTokens of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fetchImpl = mockGateway();
      const reserve = vi.fn(async () => {});
      await expect(generate(fetchImpl, { maxOutputTokens, beforeAttempt: reserve })).rejects.toMatchObject({ message: "AI_PROVIDER_OUTPUT_INVALID" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(reserve).not.toHaveBeenCalled();
    }
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

type Node = Record<string, unknown>;
/** Subschemas xgrammar refused on November 16, 2026: format with pattern or lengths, pattern with lengths. */
function dialectConflicts(value: unknown, path = "#"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => dialectConflicts(item, `${path}/${index}`));
  if (value === null || typeof value !== "object") return [];
  const node = value as Node;
  const lengths = node.minLength !== undefined || node.maxLength !== undefined;
  const own = "$schema" in node || (typeof node.format === "string" && (node.pattern !== undefined || lengths))
    || (typeof node.pattern === "string" && lengths) ? [path] : [];
  return [...own, ...Object.entries(node).flatMap(([key, child]) => dialectConflicts(child, `${path}/${key}`))];
}
const zodContract = z.object({
  at: z.iso.datetime({ offset: true }), id: z.uuid(), day: z.iso.date().nullable(),
  url: z.url().max(2000).nullable(), currency: z.string().regex(/^[A-Z]{3}$/u), name: z.string().min(1).max(80),
}).strict();
const zodSchema = z.toJSONSchema(zodContract, { target: "draft-7" }) as Node;
const sentSchema = () => freeProviderSchema(zodSchema) as Node;
const property = (schema: Node, name: string) => (schema.properties as Record<string, Node>)[name]!;

describe("provider schema dialect (JOB-099)", () => {
  it("keeps one string constraint per subschema and drops $schema, without changing the caller's schema", () => {
    const original = structuredClone(zodSchema);
    expect(dialectConflicts(zodSchema).length).toBeGreaterThan(0); // zod writes format + pattern pairs
    const sent = sentSchema();
    expect(dialectConflicts(sent)).toEqual([]);
    expect(zodSchema).toEqual(original);
    expect(property(sent, "at")).toEqual({ type: "string", format: "date-time" });
    expect(property(sent, "id")).toEqual({ type: "string", format: "uuid" });
    expect(property(sent, "day")).toEqual({ anyOf: [{ type: "string", format: "date" }, { type: "null" }] });
    expect(property(sent, "url")).toEqual({ anyOf: [{ type: "string", format: "uri" }, { type: "null" }] });
    expect(property(sent, "currency")).toEqual({ type: "string", pattern: "^[A-Z]{3}$" });
    expect(property(sent, "name")).toEqual({ type: "string", minLength: 1, maxLength: 80 });
    expect(sent).toMatchObject({ required: zodSchema.required, additionalProperties: false });
  });

  it("is generation guidance only: the application contract still rejects what the dialect no longer states", () => {
    const valid = { at: "2030-04-01T19:00:00+09:00", id: "10000000-0000-4000-8000-000000000001", day: null, url: null, currency: "JPY", name: "Dinner" };
    expect(zodContract.safeParse(valid).success).toBe(true);
    for (const change of [{ url: `https://example.test/${"a".repeat(2000)}` }, { at: "2030-02-30T19:00:00+09:00" }, { currency: "jpy" }]) {
      expect(zodContract.safeParse({ ...valid, ...change }).success).toBe(false);
    }
  });

  it("treats property names, enums and required lists as data, accepts shared subschemas and refuses cycles", () => {
    const shared = { type: "string", format: "date", pattern: "^x$", maxLength: 10 };
    const schema = { type: "object", required: ["pattern", "format", "$schema"],
      properties: { pattern: shared, format: shared, $schema: { type: "string", enum: ["pattern", "$schema"] } } };
    expect(freeProviderSchema(schema)).toEqual({ type: "object", required: ["pattern", "format", "$schema"], properties: {
      pattern: { type: "string", format: "date" }, format: { type: "string", format: "date" },
      $schema: { type: "string", enum: ["pattern", "$schema"] } } });
    const circular: Node = { type: "object" }; circular.items = circular;
    expect(() => freeProviderSchema(circular)).toThrow("AI_PROVIDER_OUTPUT_INVALID");
    let deep: Node = { type: "string" };
    for (let depth = 0; depth < 80; depth += 1) deep = { type: "array", items: deep };
    expect(() => freeProviderSchema(deep)).toThrow("AI_PROVIDER_OUTPUT_INVALID");
  });

  it("sends the dialect natively and inside JSON-object instructions", async () => {
    const native = mockGateway();
    await withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: zodSchema, settings, fetchImpl: native as typeof fetch }));
    expect(JSON.parse(String(native.mock.calls[1]![1]?.body)).response_format.json_schema.schema).toEqual(sentSchema());
    const instructed = mockGateway(() => answer(), [{ ...row(settings.models[0]!), supported_parameters: ["response_format"] }]);
    await withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: zodSchema, settings, fetchImpl: instructed as typeof fetch }));
    const body = JSON.parse(String(instructed.mock.calls[1]![1]?.body));
    expect(body.messages[0].content).toContain(JSON.stringify(sentSchema()));
    expect(body.messages[0].content).not.toContain('"pattern":"^(');
  });
});

const strictRefusal = () => Response.json({ error: { message: "Invalid schema for response_format 'stardust_planner': In context=('properties', 'patch'), 'required' is required to be supplied and to be an array including every key in properties. Missing 'endsAt'.", type: "AI_APICallError" } }, { status: 400 });
const grammarRefusal = () => Response.json({ error: { message: "Upstream error from Liquid: Failed to compile json grammar: JSON Schema at #/properties/at is not supported by xgrammar", code: 400, metadata: { error_type: "invalid_request" } } });
const opaqueBadRequest = () => Response.json({ error: { message: "Provider returned error", code: 400, metadata: { raw: "{\"code\":400,\"msg\":\"bad request\"}", provider_name: "Synthetic" } } }, { status: 400 });
const formatOf = (init: RequestInit | undefined) => (JSON.parse(String(init?.body)) as { response_format?: { type: string } }).response_format?.type;
const posted = (fetchImpl: ReturnType<typeof mockGateway>) => fetchImpl.mock.calls.filter(([url]) => String(url) === FREE_AI_ENDPOINT)
  .map(([, init]) => ({ model: JSON.parse(String(init?.body)).model as string, format: formatOf(init) }));

describe("native schema refusals (JOB-099)", () => {
  it.each([["a strict-schema 400", strictRefusal], ["a grammar error inside a 200 reply", grammarRefusal]])(
    "retries the same model once with JSON-object instructions after %s", async (_name, refusal) => {
      const fetchImpl = mockGateway((init) => formatOf(init) === "json_schema" ? refusal() : answer());
      const reserve = vi.fn(async () => {});
      const result = await generate(fetchImpl, { selectedModel: settings.models[0], beforeAttempt: reserve });
      expect(result).toMatchObject({ model: settings.models[0], text: '{"message":"Plan dinner"}' });
      expect(reserve).toHaveBeenCalledTimes(2);
      expect(posted(fetchImpl)).toEqual([{ model: settings.models[0], format: "json_schema" }, { model: settings.models[0], format: "json_object" }]);
      const retry = JSON.parse(String(fetchImpl.mock.calls[2]![1]?.body));
      expect(retry.messages).toEqual([
        { role: "system", content: expect.stringContaining(JSON.stringify(schema)) },
        { role: "user", content: "Plan a synthetic dinner" },
      ]);
    });

  it("moves on without a JSON-object retry when a 400 is not about the schema", async () => {
    const fetchImpl = mockGateway((init) => JSON.parse(String(init.body)).model === settings.models[0] ? opaqueBadRequest() : answer());
    expect((await generate(fetchImpl)).model).toBe(settings.models[1]);
    expect(posted(fetchImpl)).toEqual([{ model: settings.models[0], format: "json_schema" }, { model: settings.models[1], format: "json_schema" }]);
    const chosen = mockGateway(() => opaqueBadRequest());
    await expect(generate(chosen, { selectedModel: settings.models[0] })).rejects.toMatchObject({ details: { code: "AI_PROVIDER_UNAVAILABLE" } });
    expect(posted(chosen)).toHaveLength(1);
  });

  it("retries a refused model at most once, and never retries non-native requests", async () => {
    const fetchImpl = mockGateway((init) => formatOf(init) === "json_schema" ? strictRefusal() : Response.json({}, { status: 503 }));
    const reserve = vi.fn(async () => {});
    await expect(generate(fetchImpl, { selectedModel: settings.models[0], beforeAttempt: reserve }))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_UNAVAILABLE" } });
    expect(reserve).toHaveBeenCalledTimes(2);
    const instructed = mockGateway(() => strictRefusal(), [{ ...row(settings.models[0]!), supported_parameters: ["response_format"] }]);
    await expect(generate(instructed, { selectedModel: settings.models[0] })).rejects.toMatchObject({ details: { code: "AI_PROVIDER_UNAVAILABLE" } });
    expect(posted(instructed)).toEqual([{ model: settings.models[0], format: "json_object" }]);
  });

  it("still stops at a rate limit during the retry instead of trying another model", async () => {
    const fetchImpl = mockGateway((init) => formatOf(init) === "json_schema" ? strictRefusal() : Response.json({ privateDetail: "Never expose" }, { status: 429 }));
    const failure = await generate(fetchImpl).catch((error: unknown) => error);
    expect(failure).toMatchObject({ details: { code: "AI_PROVIDER_RATE_LIMITED" } });
    expect(JSON.stringify(failure)).not.toMatch(/Never expose|Invalid schema/u);
    expect(posted(fetchImpl)).toEqual([{ model: settings.models[0], format: "json_schema" }, { model: settings.models[0], format: "json_object" }]);
  });

  it("remembers a refusal on the real gateway, so later requests skip the refused attempt", async () => {
    const gateway = mockGateway((init) => formatOf(init) === "json_schema" ? strictRefusal() : answer());
    vi.stubGlobal("fetch", gateway);
    try {
      const call = () => withFreeAiCredential(() => generateWithFreeModel({ prompt: "Plan", responseJsonSchema: schema, settings, selectedModel: settings.models[0] }));
      await call();
      await call();
      expect(posted(gateway).map(({ format }) => format)).toEqual(["json_schema", "json_object", "json_object"]);
    } finally { vi.unstubAllGlobals(); }
  });
});
