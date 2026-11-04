import { describe, expect, it, vi } from "vitest";
import { AiCredentialContextMissingError, withOperatorAiCredential } from "@/lib/ai/credential-context";
import { geminiEndpoint as geminiEndpointDirect, geminiFailureCode, generateWithGemini, parseGeminiResponse } from "@/lib/ai/gemini";
import { AiProviderFailureError } from "@/lib/ai/provider-failure";

// The operator's endpoint, so these cases run in an explicit operator context.
const geminiEndpoint = (env: Record<string, string | undefined>) => withOperatorAiCredential(() => geminiEndpointDirect(env));

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("Gemini endpoint configuration", () => {
  it("refuses to hand out any key outside a credential context", () => {
    expect(() => geminiEndpointDirect({ STARDUST_GEMINI_API_KEY: "synthetic-key" })).toThrow(AiCredentialContextMissingError);
  });
  it("is off without a key, uses the Gemini API by default and Vertex AI when a project is set", () => {
    expect(geminiEndpoint({})).toBeNull();
    const developer = geminiEndpoint({ STARDUST_GEMINI_API_KEY: "synthetic-key" })!;
    expect(developer.backend).toBe("gemini_api");
    expect(developer.url("gemini-3.8-flash")).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    const vertex = geminiEndpoint({ STARDUST_GEMINI_API_KEY: "synthetic-key", STARDUST_GEMINI_VERTEX_PROJECT: "synthetic-project" })!;
    expect(vertex.url("gemini-4-argon")).toBe(
      "https://aiplatform.googleapis.com/v1/projects/synthetic-project/locations/global/publishers/google/models/gemini-4-argon:generateContent");
    const regional = geminiEndpoint({ STARDUST_GEMINI_API_KEY: "k", STARDUST_GEMINI_VERTEX_PROJECT: "synthetic-project", STARDUST_GEMINI_VERTEX_LOCATION: "asia-northeast1" })!;
    expect(regional.url("m")).toMatch(/^https:\/\/asia-northeast1-aiplatform\.googleapis\.com\//u);
  });
  it("refuses malformed project or location values instead of building another host", () => {
    expect(geminiEndpoint({ STARDUST_GEMINI_API_KEY: "k", STARDUST_GEMINI_VERTEX_PROJECT: "evil.example/x" })).toBeNull();
    expect(geminiEndpoint({ STARDUST_GEMINI_API_KEY: "k", STARDUST_GEMINI_VERTEX_PROJECT: "synthetic-project", STARDUST_GEMINI_VERTEX_LOCATION: "x.evil" })).toBeNull();
  });
});

describe("Gemini requests", () => {
  const endpoint = geminiEndpoint({ STARDUST_GEMINI_API_KEY: "synthetic-key", STARDUST_GEMINI_VERTEX_PROJECT: "synthetic-project" });

  it("sends the key in a header, never the URL, with the schema and search grounding only when asked", async () => {
    const fetchImpl = vi.fn(async () => ok({ candidates: [{ content: { parts: [{ text: "{\"a\":1}" }] }, finishReason: "STOP" }] }));
    await generateWithGemini({ model: "gemini-3.8-flash", parts: [{ text: "hi" }], responseJsonSchema: { type: "object" },
      googleSearch: true, endpoint, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).not.toContain("synthetic-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("synthetic-key");
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{ googleSearch: {} }]);
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });

    fetchImpl.mockClear();
    await generateWithGemini({ model: "gemini-3.8-flash", parts: [{ text: "hi" }], endpoint, fetchImpl });
    expect(JSON.parse(String((fetchImpl.mock.calls[0]! as unknown as [string, RequestInit])[1].body)).tools).toBeUndefined();
  });

  it("fails closed without credentials or with an unsafe model name", async () => {
    const fetchImpl = vi.fn();
    await expect(generateWithGemini({ model: "m", parts: [{ text: "x" }], endpoint: null, fetchImpl }))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_AUTH_REQUIRED", provider: "google" } });
    await expect(generateWithGemini({ model: "../evil", parts: [{ text: "x" }], endpoint, fetchImpl }))
      .rejects.toMatchObject({ details: { code: "AI_PROVIDER_MODEL_UNAVAILABLE" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider errors to safe categories without keeping upstream text", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "private quota detail" } }), { status: 429 }));
    const failure = await generateWithGemini({ model: "m", parts: [{ text: "x" }], endpoint, fetchImpl }).catch((error) => error);
    expect(failure).toBeInstanceOf(AiProviderFailureError);
    expect(failure.details).toEqual({ code: "AI_PROVIDER_RATE_LIMITED", provider: "google" });
    expect(JSON.stringify(failure.details)).not.toContain("private");
    expect(geminiFailureCode(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "BILLING_DISABLED" }] } })).toBe("AI_PROVIDER_BILLING");
    expect(geminiFailureCode(400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } })).toBe("AI_PROVIDER_AUTH_REQUIRED");
    expect(geminiFailureCode(404, {})).toBe("AI_PROVIDER_MODEL_UNAVAILABLE");
    expect(geminiFailureCode(503, {})).toBe("AI_PROVIDER_UNAVAILABLE");
  });
});

describe("Gemini responses", () => {
  it("joins answer text without thought parts and reports search grounding", () => {
    const result = parseGeminiResponse({
      candidates: [{
        content: { parts: [{ text: "thinking", thought: true }, { text: "{\"message\":" }, { text: "\"ok\"}" }] },
        finishReason: "STOP",
        groundingMetadata: { webSearchQueries: ["museum hours", "museum hours", ""], groundingChunks: [{ web: { domain: "Example.test" } }, { web: { title: "not a domain!" } }] },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7, cachedContentTokenCount: 2 },
      modelVersion: "gemini-3.8-flash",
    });
    expect(result).toEqual({ text: "{\"message\":\"ok\"}", modelVersion: "gemini-3.8-flash", inputTokens: 10, outputTokens: 12,
      cachedInputTokens: 2, webSearchQueries: ["museum hours"], groundingDomains: ["example.test"] });
  });
  it("rejects blocked, truncated or empty answers", () => {
    for (const body of [
      { promptFeedback: { blockReason: "SAFETY" }, candidates: [] },
      { candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] },
      { candidates: [{ content: { parts: [{ text: "  " }] }, finishReason: "STOP" }] },
      {},
    ]) {
      expect(() => parseGeminiResponse(body)).toThrow(AiProviderFailureError);
    }
  });
});
