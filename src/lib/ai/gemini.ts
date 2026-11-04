import { requireAiCredential } from "@/lib/ai/credential-context";
import { AiProviderFailureError, type AiProviderFailureCode } from "@/lib/ai/provider-failure";

/**
 * Gemini over its REST API, with no SDK subprocess: either the Gemini API with an API key, or
 * Vertex AI with a service-account-bound API key plus its project and location. The key is sent
 * in a header (never the URL) and never leaves this process.
 */
export type GeminiEndpoint = Readonly<{ apiKey: string; url: (model: string) => string; backend: "gemini_api" | "vertex_ai" }>;

const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const locationPattern = /^[a-z][a-z0-9-]{0,39}$/u;
const modelPattern = /^[a-z0-9][a-z0-9.-]{0,80}$/u;

export function geminiEndpointFor(apiKey: string | undefined, project?: string | null, location?: string | null): GeminiEndpoint | null {
  const key = apiKey?.trim();
  if (!key) return null;
  if (!project?.trim()) {
    return { apiKey: key, backend: "gemini_api",
      url: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` };
  }
  const vertexProject = project.trim();
  const vertexLocation = location?.trim() || "global";
  if (!projectPattern.test(vertexProject) || !locationPattern.test(vertexLocation)) return null;
  const host = vertexLocation === "global" ? "aiplatform.googleapis.com" : `${vertexLocation}-aiplatform.googleapis.com`;
  return { apiKey: key, backend: "vertex_ai",
    url: (model) => `https://${host}/v1/projects/${vertexProject}/locations/${vertexLocation}/publishers/google/models/${model}:generateContent` };
}

/**
 * The request's own or shared Gemini key in a user-key context, the operator's in an operator
 * context. Outside any credential context it throws.
 */
export function geminiEndpoint(env: Record<string, string | undefined> = process.env): GeminiEndpoint | null {
  const credential = requireAiCredential();
  if (credential.source !== "operator") {
    return credential.provider === "google"
      ? geminiEndpointFor(credential.apiKey, credential.vertex?.project, credential.vertex?.location) : null;
  }
  return geminiEndpointFor(env.STARDUST_GEMINI_API_KEY, env.STARDUST_GEMINI_VERTEX_PROJECT, env.STARDUST_GEMINI_VERTEX_LOCATION);
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export type GeminiResult = {
  text: string;
  modelVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  /** Queries Google Search actually ran for this answer (grounding metadata). */
  webSearchQueries: string[];
  /** Domains of the grounding sources Google reported (its source URIs are redirect links). */
  groundingDomains: string[];
};

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: unknown; thought?: unknown }[] };
    finishReason?: unknown;
    groundingMetadata?: { webSearchQueries?: unknown; groundingChunks?: { web?: { domain?: unknown; title?: unknown } }[] };
  }[];
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown; cachedContentTokenCount?: unknown };
  modelVersion?: unknown;
  promptFeedback?: { blockReason?: unknown };
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Map an HTTP failure to the browser-safe categories; upstream text is never kept. */
export function geminiFailureCode(status: number, body: unknown): AiProviderFailureCode {
  const error = body && typeof body === "object" ? (body as { error?: { status?: unknown; message?: unknown; details?: unknown } }).error : undefined;
  const marker = JSON.stringify([error?.status, error?.details ?? null]).toUpperCase();
  const message = typeof error?.message === "string" ? error.message.toUpperCase() : "";
  if (status === 429 || marker.includes("RESOURCE_EXHAUSTED")) return "AI_PROVIDER_RATE_LIMITED";
  if (marker.includes("BILLING") || message.includes("BILLING")) return "AI_PROVIDER_BILLING";
  if (status === 401 || status === 403 || marker.includes("API_KEY_INVALID") || message.includes("API KEY")) return "AI_PROVIDER_AUTH_REQUIRED";
  if (status === 404) return "AI_PROVIDER_MODEL_UNAVAILABLE";
  if (status >= 500) return "AI_PROVIDER_UNAVAILABLE";
  return "AI_PROVIDER_OUTPUT_INVALID";
}

export function parseGeminiResponse(body: GeminiResponse): GeminiResult {
  const candidate = body.candidates?.[0];
  const finish = typeof candidate?.finishReason === "string" ? candidate.finishReason : null;
  if (!candidate || body.promptFeedback?.blockReason || (finish && finish !== "STOP")) {
    throw new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "google" });
  }
  const text = (candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string).join("");
  if (!text.trim()) throw new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "google" });
  const grounding = candidate.groundingMetadata;
  const queries = Array.isArray(grounding?.webSearchQueries)
    ? grounding.webSearchQueries.filter((query): query is string => typeof query === "string" && query.trim().length > 0).slice(0, 20) : [];
  const domains = (grounding?.groundingChunks ?? []).flatMap((chunk) => {
    const value = typeof chunk?.web?.domain === "string" ? chunk.web.domain : typeof chunk?.web?.title === "string" ? chunk.web.title : null;
    return value && /^[a-z0-9.-]{1,253}$/iu.test(value) ? [value.toLowerCase()] : [];
  });
  const usage = body.usageMetadata;
  const thoughts = count(usage?.thoughtsTokenCount) ?? 0;
  const candidates = count(usage?.candidatesTokenCount);
  return {
    text,
    modelVersion: typeof body.modelVersion === "string" ? body.modelVersion.slice(0, 160) : null,
    inputTokens: count(usage?.promptTokenCount),
    outputTokens: candidates === null ? null : candidates + thoughts,
    cachedInputTokens: count(usage?.cachedContentTokenCount),
    webSearchQueries: [...new Set(queries)],
    groundingDomains: [...new Set(domains)].slice(0, 40),
  };
}

export async function generateWithGemini(input: {
  model: string;
  parts: GeminiPart[];
  systemInstruction?: string;
  responseJsonSchema?: unknown;
  googleSearch?: boolean;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  endpoint?: GeminiEndpoint | null;
  fetchImpl?: typeof fetch;
}): Promise<GeminiResult> {
  const endpoint = input.endpoint === undefined ? geminiEndpoint() : input.endpoint;
  if (!endpoint) throw new AiProviderFailureError({ code: "AI_PROVIDER_AUTH_REQUIRED", provider: "google" });
  if (!modelPattern.test(input.model)) throw new AiProviderFailureError({ code: "AI_PROVIDER_MODEL_UNAVAILABLE", provider: "google" });
  const body = {
    contents: [{ role: "user", parts: input.parts }],
    ...(input.systemInstruction ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } } : {}),
    ...(input.googleSearch ? { tools: [{ googleSearch: {} }] } : {}),
    generationConfig: {
      ...(input.responseJsonSchema ? { responseMimeType: "application/json", responseJsonSchema: input.responseJsonSchema } : {}),
      maxOutputTokens: input.maxOutputTokens ?? 16_384,
    },
  };
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(endpoint.url(input.model), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": endpoint.apiKey },
      body: JSON.stringify(body),
      // A redirect would carry x-goog-api-key to wherever it points; Google's API never redirects.
      redirect: "error",
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new AiProviderFailureError({ code: "AI_PROVIDER_UNAVAILABLE", provider: "google" });
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch { parsed = null; }
  if (!response.ok) throw new AiProviderFailureError({ code: geminiFailureCode(response.status, parsed), provider: "google" });
  return parseGeminiResponse((parsed ?? {}) as GeminiResponse);
}
