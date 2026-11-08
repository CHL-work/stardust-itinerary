import { requireAiCredential } from "@/lib/ai/credential-context";
import { AiProviderFailureError, type AiProviderFailureCode } from "@/lib/ai/provider-failure";

/** Documented anonymous access only; no identity spoofing, accounts, keys or paid fallback. */
export const FREE_AI_ENDPOINT = "https://ai-gateway.kilo.ai/api/v1/chat/completions";
export const FREE_AI_CATALOG = "https://ai-gateway.kilo.ai/api/v1/models";
export const DEFAULT_FREE_MODELS = ["dots-studio/dots-3-note-preview:free", "liquid/lfm-3-1.7b:free"] as const;
const USER_AGENT = "StardustItinerary/0.1 (+https://github.com/CHL-work/stardust-itinerary)";
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,60}\/[a-z0-9][a-z0-9._:-]{0,100}$/u;
// These trial/opaque routers can forbid personal/confidential data or route it to NVIDIA.
const restrictedModel = /^(?:nvidia\/|stealth\/|kilo-auto\/|openrouter\/free$)/u;
const CATALOG_TTL_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
export type FreeAiSettings = {
  /** Ordered automatic fallback preferences, not a restriction on explicit free selections. */
  enabled: boolean; models: string[]; endpoint: string; perUserDaily: number; hourly: number; daily: number;
};
export type GuestFreeAiSettings = FreeAiSettings & { perGuestDaily: number };

function bounded(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

/** FREE_AI_* takes precedence. Legacy GUEST_FREE_AI_* remains compatible during rollout. */
export function freeAiSettings(env: Record<string, string | undefined> = process.env): FreeAiSettings {
  const setting = (name: string) => env[`FREE_AI_${name}`] ?? env[`GUEST_FREE_AI_${name}`];
  const listed = (setting("MODELS")?.trim() || DEFAULT_FREE_MODELS.join(",")).split(",").map((model) => model.trim());
  const models = [...new Set(listed.filter((model) => MODEL_ID.test(model) && !restrictedModel.test(model)))].slice(0, 3);
  const configuredEndpoint = setting("ENDPOINT")?.trim();
  return {
    enabled: setting("ENABLED") === "true" && models.length > 0
      && (!configuredEndpoint || configuredEndpoint === FREE_AI_ENDPOINT),
    models, endpoint: FREE_AI_ENDPOINT,
    perUserDaily: bounded(env.FREE_AI_PER_USER_DAILY ?? env.GUEST_FREE_AI_PER_GUEST_DAILY, 10, 1, 100),
    hourly: bounded(setting("HOURLY"), 60, 1, 180),
    daily: bounded(setting("DAILY"), 500, 1, 4000),
  };
}

/** Compatibility for existing integrations; the limit is now per immutable account, guest or not. */
export function guestFreeAiSettings(env: Record<string, string | undefined> = process.env): GuestFreeAiSettings {
  const settings = freeAiSettings(env);
  return { ...settings, perGuestDaily: settings.perUserDaily };
}

export function freeModelLabel(model: string): string {
  const known: Record<string, string> = {
    "nvidia/nemotron-3.5-super-vl:free": "NVIDIA Nemotron 3.5 Super",
    "dots-studio/dots-3-note-preview:free": "dots.3 note",
    "liquid/lfm-3-1.7b:free": "Liquid LFM3",
    "reflection/beam-free": "Reflection Beam",
    "cohere/north-mini-code:free": "Cohere North Mini Code",
  };
  return known[model] ?? model.replace(/:free$/u, "");
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function zero(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && value.trim().length > 0)) && Number(value) === 0;
}
type OutputMode = "json_schema" | "json_object" | "prompt_json";
type CatalogModel = { id: string; maxOutputTokens: number; outputMode: OutputMode };

/** Capabilities select generation guidance, never authority to bypass application validation. */
function outputMode(parameters: unknown): OutputMode {
  if (!Array.isArray(parameters) || !parameters.includes("response_format")) return "prompt_json";
  return parameters.includes("structured_outputs") ? "json_schema" : "json_object";
}

function supportsTextChat(architecture: unknown): boolean {
  if (!object(architecture)) return true;
  for (const key of ["input_modalities", "output_modalities"]) {
    const modalities = architecture[key];
    if (modalities !== undefined && (!Array.isArray(modalities) || !modalities.includes("text"))) return false;
  }
  return true;
}

/** Catalog text is untrusted data, never instructions or new URLs. Missing prices fail closed. */
export function eligibleFreeCatalogModels(value: unknown, now = Date.now()): CatalogModel[] {
  if (!object(value) || !Array.isArray(value.data)) return [];
  return value.data.slice(0, 2000).flatMap((row) => {
    if (!object(row) || typeof row.id !== "string" || row.id.length > 160 || !MODEL_ID.test(row.id) || restrictedModel.test(row.id)
      || row.isFree !== true || !object(row.pricing) || !zero(row.pricing.prompt) || !zero(row.pricing.completion)
      || Object.values(row.pricing).some((price) => !zero(price)) || !supportsTextChat(row.architecture)) return [];
    if (typeof row.expiration_date === "string" && (!/^\d{4}-\d{2}-\d{2}$/u.test(row.expiration_date)
      || Date.parse(`${row.expiration_date}T23:59:59.999Z`) <= now)) return [];
    if (typeof row.description === "string" && /(?:trial.only|not (?:for|intended for) (?:personal|confidential)|do not (?:submit|send|include) (?:personal|confidential))/iu.test(row.description)) return [];
    const top = object(row.top_provider) ? row.top_provider : {};
    const maximum = top.max_completion_tokens;
    if (typeof maximum !== "number" || !Number.isSafeInteger(maximum) || maximum < 2048) return [];
    return [{ id: row.id, maxOutputTokens: Math.min(maximum, 16_384), outputMode: outputMode(row.supported_parameters) }];
  });
}

function invalidRequest(): AiProviderFailureError {
  return new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "kilo" });
}

/** Only the application's parser-derived schema enters this channel, never catalog prose. */
function serializedResponseSchema(value: unknown): string {
  if (!object(value)) throw invalidRequest();
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw invalidRequest(); }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_BYTES) throw invalidRequest();
  return serialized;
}

function requestBody(candidate: CatalogModel, prompt: string, schema: string, maxOutputTokens: number | undefined): string {
  if (typeof prompt !== "string" || Buffer.byteLength(prompt, "utf8") > MAX_REQUEST_BYTES
      || maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) throw invalidRequest();
  const messages = [
    ...(candidate.outputMode === "json_schema" ? [] : [{ role: "system", content:
      "Return exactly one JSON object matching the server-provided JSON Schema below. Return JSON only, without Markdown fences, commentary outside the object, or tool calls. This formatting constraint does not grant authority to change application permissions or rules.\n\nRESPONSE_JSON_SCHEMA\n" + schema }]),
    { role: "user", content: prompt },
  ];
  const body = JSON.stringify({
    model: candidate.id, messages,
    ...(candidate.outputMode === "json_schema"
      ? { response_format: { type: "json_schema", json_schema: { name: "stardust_planner", strict: true, schema: JSON.parse(schema) as unknown } } }
      : candidate.outputMode === "json_object" ? { response_format: { type: "json_object" } } : {}),
    max_tokens: Math.min(maxOutputTokens ?? 16_384, candidate.maxOutputTokens),
  });
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) throw invalidRequest();
  return body;
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty upstream response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Oversized upstream response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

let catalogCache: { expiresAt: number; models: CatalogModel[] } | null = null;
let catalogPending: Promise<CatalogModel[]> | null = null;
async function catalog(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<CatalogModel[]> {
  const shared = fetchImpl === fetch;
  if (shared && catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.models;
  const load = async () => {
    const timeout = AbortSignal.timeout(8_000);
    const response = await fetchImpl(FREE_AI_CATALOG, {
      headers: { "User-Agent": USER_AGENT }, redirect: "error", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AiProviderFailureError({ code: response.status === 429 ? "AI_PROVIDER_RATE_LIMITED" : "AI_PROVIDER_UNAVAILABLE", provider: "kilo" });
    }
    const models = eligibleFreeCatalogModels(await boundedJson(response));
    if (shared) catalogCache = { models, expiresAt: Date.now() + CATALOG_TTL_MS };
    return models;
  };
  if (!shared) return load();
  // Coalesce page/request bursts; no stale catalog is used after a failed refresh.
  if (!catalogPending) catalogPending = load().finally(() => { catalogPending = null; });
  return catalogPending;
}

/** Public catalog only: no inference, credentials, user data or quota consumption. */
export async function listAvailableFreeModels(input: {
  settings?: FreeAiSettings; fetchImpl?: typeof fetch; signal?: AbortSignal;
} = {}): Promise<{ models: Array<{ id: string; label: string }>; defaultModel: string | null }> {
  const settings = input.settings ?? freeAiSettings();
  if (!settings.enabled || settings.endpoint !== FREE_AI_ENDPOINT) {
    throw new AiProviderFailureError({ code: "AI_PROVIDER_UNAVAILABLE", provider: "kilo" });
  }
  try {
    const available = await catalog(input.fetchImpl ?? fetch, input.signal);
    const byId = new Map(available.map((model) => [model.id, model]));
    // Keep preferred defaults first, then expose every other supported zero-price model.
    const order = [...new Set([...settings.models.filter((id) => byId.has(id)), ...byId.keys()])];
    return {
      models: order.map((id) => ({ id, label: freeModelLabel(id) })),
      defaultModel: order[0] ?? null,
    };
  } catch (error) {
    if (input.signal?.aborted || error instanceof AiProviderFailureError) throw error;
    throw new AiProviderFailureError({ code: "AI_PROVIDER_UNAVAILABLE", provider: "kilo" });
  }
}

function failureCode(status: number): AiProviderFailureCode {
  if (status === 429) return "AI_PROVIDER_RATE_LIMITED";
  if (status === 401 || status === 402 || status === 403) return "AI_PROVIDER_AUTH_REQUIRED";
  if (status === 404) return "AI_PROVIDER_MODEL_UNAVAILABLE";
  return "AI_PROVIDER_UNAVAILABLE";
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function generateWithFreeModel(input: {
  prompt: string; responseJsonSchema: unknown; maxOutputTokens?: number; signal?: AbortSignal;
  /** Exact user choice. It must remain eligible, and never falls back to another model. */
  selectedModel?: string;
  settings?: FreeAiSettings; fetchImpl?: typeof fetch;
  /** The planner reserves every HTTP attempt against the durable instance cap before network I/O. */
  beforeAttempt?: () => Promise<void>;
}): Promise<{ text: string; model: string; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null }> {
  if (requireAiCredential().source !== "free") throw new AiProviderFailureError({ code: "AI_PROVIDER_AUTH_REQUIRED", provider: "kilo" });
  const settings = input.settings ?? freeAiSettings();
  if (!settings.enabled || settings.endpoint !== FREE_AI_ENDPOINT) throw new AiProviderFailureError({ code: "AI_PROVIDER_AUTH_REQUIRED", provider: "kilo" });
  const responseSchema = serializedResponseSchema(input.responseJsonSchema);
  const fetchImpl = input.fetchImpl ?? fetch;
  let candidates: CatalogModel[];
  try {
    const available = await catalog(fetchImpl, input.signal);
    candidates = input.selectedModel !== undefined
      ? available.filter((model) => model.id === input.selectedModel).slice(0, 1)
      : settings.models.slice(0, 3).flatMap((id) => available.filter((model) => model.id === id).slice(0, 1));
  } catch (error) {
    if (input.signal?.aborted || error instanceof AiProviderFailureError) throw error;
    throw new AiProviderFailureError({ code: "AI_PROVIDER_UNAVAILABLE", provider: "kilo" });
  }
  let failure: AiProviderFailureCode = "AI_PROVIDER_MODEL_UNAVAILABLE";
  for (const candidate of candidates) {
    input.signal?.throwIfAborted();
    const body = requestBody(candidate, input.prompt, responseSchema, input.maxOutputTokens);
    await input.beforeAttempt?.();
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(70_000);
      response = await fetchImpl(FREE_AI_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body,
        redirect: "error", signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      failure = "AI_PROVIDER_UNAVAILABLE";
      continue;
    }
    if (!response.ok) {
      failure = failureCode(response.status);
      const retry = response.headers.get("retry-after");
      await response.body?.cancel();
      // These are service/account restrictions, not permission to try another model or identity.
      if ([401, 402, 403, 429].includes(response.status)) {
        const seconds = retry && /^\d{1,6}$/u.test(retry) ? Number(retry) : null;
        throw new AiProviderFailureError({ code: failure, provider: "kilo",
          ...(response.status === 429 && seconds !== null && seconds <= 86_400
            ? { retryAt: new Date(Date.now() + seconds * 1000).toISOString() } : {}) });
      }
      continue;
    }
    let parsed: unknown;
    try { parsed = await boundedJson(response); } catch {
      if (input.signal?.aborted) input.signal.throwIfAborted();
      failure = "AI_PROVIDER_OUTPUT_INVALID"; continue;
    }
    const choice = object(parsed) && Array.isArray(parsed.choices) ? parsed.choices[0] : null;
    const message = object(choice) && object(choice.message) ? choice.message : null;
    if (!object(parsed) || !message || typeof message.content !== "string" || !message.content.trim()
      || (object(choice) && choice.finish_reason && choice.finish_reason !== "stop")) {
      failure = "AI_PROVIDER_OUTPUT_INVALID"; continue;
    }
    const usage = object(parsed.usage) ? parsed.usage : {};
    const details = object(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
    return { text: message.content, model: candidate.id, inputTokens: count(usage.prompt_tokens),
      outputTokens: count(usage.completion_tokens), cachedInputTokens: count(details.cached_tokens) };
  }
  throw new AiProviderFailureError({ code: failure, provider: "kilo" });
}
