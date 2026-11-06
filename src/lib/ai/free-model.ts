import { requireAiCredential } from "@/lib/ai/credential-context";
import { AiProviderFailureError, type AiProviderFailureCode } from "@/lib/ai/provider-failure";

/**
 * Free guest AI (JOB-071, D-086): guests without a key run the planner on keyless free models
 * through Kilo's AI Gateway, which documents unauthenticated access to its ":free" models (200
 * requests an hour per address). Requests carry no key or account and identify Stardust honestly in
 * their user agent; nothing pretends to be another app.
 *
 * - `GUEST_FREE_AI_ENABLED=true` turns it on.
 * - `GUEST_FREE_AI_MODELS` lists the ":free" model IDs to try, in order; free models come and go.
 * - `GUEST_FREE_AI_PER_GUEST_DAILY`, `GUEST_FREE_AI_HOURLY` and `GUEST_FREE_AI_DAILY` bound use per
 *   guest and for the whole instance, below the gateway's per-address limit.
 * - `GUEST_FREE_AI_ENDPOINT` replaces the gateway's chat-completions URL (https only).
 */
export const FREE_AI_ENDPOINT = "https://ai-gateway.kilo.ai/api/v1/chat/completions";
export const DEFAULT_FREE_MODELS = ["nvidia/nemotron-3.5-super-vl:free", "dots-studio/dots-3-note-preview:free"] as const;
const USER_AGENT = "StardustItinerary/0.1 (free guest AI; +https://github.com/CHL-work/stardust-itinerary)";
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,60}\/[a-z0-9][a-z0-9._-]{0,80}:free$/u;

export type GuestFreeAiSettings = {
  enabled: boolean; models: string[]; endpoint: string; perGuestDaily: number; hourly: number; daily: number;
};

function bounded(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function guestFreeAiSettings(env: Record<string, string | undefined> = process.env): GuestFreeAiSettings {
  const listed = (env.GUEST_FREE_AI_MODELS?.trim() || DEFAULT_FREE_MODELS.join(",")).split(",").map((model) => model.trim());
  const models = [...new Set(listed.filter((model) => MODEL_ID.test(model)))];
  let endpoint = FREE_AI_ENDPOINT;
  const configured = env.GUEST_FREE_AI_ENDPOINT?.trim();
  if (configured) {
    try { if (new URL(configured).protocol === "https:") endpoint = configured; } catch { /* keep the default */ }
  }
  return {
    enabled: env.GUEST_FREE_AI_ENABLED === "true" && models.length > 0,
    models, endpoint,
    // At most 180 an hour, under the gateway's 200 per address.
    perGuestDaily: bounded(env.GUEST_FREE_AI_PER_GUEST_DAILY, 10, 1, 100),
    hourly: bounded(env.GUEST_FREE_AI_HOURLY, 60, 1, 180),
    daily: bounded(env.GUEST_FREE_AI_DAILY, 500, 1, 4000),
  };
}

/** A readable name for a free model ID, for the composer's note. */
export function freeModelLabel(model: string): string {
  const known: Record<string, string> = {
    "nvidia/nemotron-3.5-super-vl:free": "NVIDIA Nemotron 3.5 Super",
    "nvidia/nemotron-3-ultra-550b-a55b:free": "NVIDIA Nemotron 3 Ultra",
    "dots-studio/dots-3-note-preview:free": "dots.3 note",
  };
  return known[model] ?? model.replace(/:free$/u, "");
}

function failureCode(status: number): AiProviderFailureCode {
  if (status === 429) return "AI_PROVIDER_RATE_LIMITED";
  if (status === 401 || status === 402 || status === 403) return "AI_PROVIDER_AUTH_REQUIRED";
  if (status === 404) return "AI_PROVIDER_MODEL_UNAVAILABLE";
  return "AI_PROVIDER_UNAVAILABLE";
}

type ChatResponse = {
  model?: unknown;
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * One planner turn on the first free model that answers, with the planner's JSON schema enforced by
 * the gateway. Only inside a free context: keyed contexts can never send their requests here.
 */
export async function generateWithFreeModel(input: {
  prompt: string;
  responseJsonSchema: unknown;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  settings?: GuestFreeAiSettings;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; model: string; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null }> {
  if (requireAiCredential().source !== "free") throw new AiProviderFailureError({ code: "AI_PROVIDER_AUTH_REQUIRED", provider: "kilo" });
  const settings = input.settings ?? guestFreeAiSettings();
  let failure: AiProviderFailureCode = "AI_PROVIDER_MODEL_UNAVAILABLE";
  for (const model of settings.models) {
    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(settings.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: input.prompt }],
          response_format: { type: "json_schema", json_schema: { name: "stardust_planner", strict: true, schema: input.responseJsonSchema } },
          max_tokens: input.maxOutputTokens ?? 16_384,
        }),
        // A redirect could send the conversation elsewhere; the gateway never redirects.
        redirect: "error",
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      failure = "AI_PROVIDER_UNAVAILABLE";
      continue;
    }
    let parsed: ChatResponse | null = null;
    try { parsed = await response.json() as ChatResponse; } catch { parsed = null; }
    if (!response.ok) {
      failure = failureCode(response.status);
      // The limit is per address, so another model would be refused too.
      if (failure === "AI_PROVIDER_RATE_LIMITED") break;
      continue;
    }
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) { failure = "AI_PROVIDER_OUTPUT_INVALID"; continue; }
    const usage = parsed?.usage;
    return {
      text: content,
      model: typeof parsed?.model === "string" && parsed.model ? parsed.model : model,
      inputTokens: count(usage?.prompt_tokens),
      outputTokens: count(usage?.completion_tokens),
      cachedInputTokens: count(usage?.prompt_tokens_details?.cached_tokens),
    };
  }
  throw new AiProviderFailureError({ code: failure, provider: "kilo" });
}
