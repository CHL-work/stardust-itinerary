import { describe, expect, it, vi } from "vitest";
import { aiCredentialInputSchema, validateAiCredential } from "@/lib/ai/credentials";

const syntheticKey = "sk-synthetic-validation-0123456789";

function fetchReturning(status: number) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url; void init;
    return new Response("{}", { status });
  });
}

describe("checking a user's key with its provider", () => {
  it.each([
    ["openai", "https://api.openai.com/v1/models"],
    ["anthropic", "https://api.anthropic.com/v1/models?limit=1"],
  ] as const)("asks %s with a read-only call that never follows redirects", async (provider, url) => {
    const fetchImpl = fetchReturning(200);
    await expect(validateAiCredential({ provider, apiKey: syntheticKey }, fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe(url);
    expect(init).toMatchObject({ redirect: "error" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("checks a Gemini or Vertex AI key with the free token counter on Google's own host", async () => {
    const fetchImpl = fetchReturning(200);
    await validateAiCredential({ provider: "google", apiKey: syntheticKey, vertexProject: "synthetic-project" }, fetchImpl as unknown as typeof fetch);
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toMatch(/^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/synthetic-project\/locations\/global\/publishers\/google\/models\/[^/]+:countTokens$/u);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(String(calledUrl)).not.toContain(syntheticKey);
  });

  it("reports a key the provider refuses as not accepted", async () => {
    await expect(validateAiCredential({ provider: "openai", apiKey: syntheticKey }, fetchReturning(401) as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("keeps Vertex AI project names to Google's own format, so they cannot redirect the request", () => {
    expect(aiCredentialInputSchema.safeParse({ provider: "google", apiKey: syntheticKey, vertexProject: "evil.example/x" }).success).toBe(false);
    expect(aiCredentialInputSchema.safeParse({ provider: "openai", apiKey: syntheticKey, vertexProject: "synthetic-project" }).success).toBe(false);
    expect(aiCredentialInputSchema.safeParse({ provider: "openai", apiKey: `${syntheticKey}\r\nX-Injected: 1` }).success).toBe(false);
  });
});
