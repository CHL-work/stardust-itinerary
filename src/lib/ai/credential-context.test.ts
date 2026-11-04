import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { activeAiCredential, withOperatorAiCredential, withUserAiCredential } from "@/lib/ai/credential-context";
import { providerEnvironment } from "@/lib/ai/provider-environment";
import { geminiEndpoint } from "@/lib/ai/gemini";

const operatorEnv = {
  PATH: "/usr/bin", HOME: "/home/app", CODEX_HOME: "/home/app/.codex", CLAUDE_CONFIG_DIR: "/home/app/.claude",
  CODEX_API_KEY: "operator-openai", OPENAI_API_KEY: "operator-openai", ANTHROPIC_API_KEY: "operator-anthropic",
  STARDUST_GEMINI_API_KEY: "operator-gemini", DATABASE_URL: "postgresql://secret",
};

describe("per-request AI credentials", () => {
  it("uses the operator's keys outside any user-key context", async () => {
    expect(activeAiCredential()).toBeUndefined();
    expect(providerEnvironment(operatorEnv)).toMatchObject({ CODEX_API_KEY: "operator-openai", ANTHROPIC_API_KEY: "operator-anthropic" });
    await withOperatorAiCredential(async () => {
      expect(providerEnvironment(operatorEnv)).toMatchObject({ CODEX_API_KEY: "operator-openai" });
      expect(geminiEndpoint(operatorEnv)?.apiKey).toBe("operator-gemini");
    });
  });

  it("replaces every operator key and profile directory with the user's key and a private directory", async () => {
    let seen: Record<string, string> = {};
    let directory = "";
    await withUserAiCredential({ source: "own", provider: "anthropic", apiKey: "user-anthropic", vertex: null }, async () => {
      seen = providerEnvironment(operatorEnv);
      directory = seen.HOME!;
      await access(seen.CODEX_HOME!);
      await access(seen.CLAUDE_CONFIG_DIR!);
      expect(geminiEndpoint(operatorEnv)).toBeNull();
    });
    expect(seen.ANTHROPIC_API_KEY).toBe("user-anthropic");
    expect(seen).not.toHaveProperty("CODEX_API_KEY");
    expect(seen).not.toHaveProperty("OPENAI_API_KEY");
    expect(JSON.stringify(seen)).not.toMatch(/operator-|postgresql/u);
    expect(directory).not.toBe("/home/app");
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps concurrent users' requests apart", async () => {
    const results = await Promise.all(["user-a", "user-b"].map((apiKey) =>
      withUserAiCredential({ source: "own", provider: "openai", apiKey, vertex: null }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return providerEnvironment(operatorEnv);
      })));
    expect(results.map((env) => env.CODEX_API_KEY)).toEqual(["user-a", "user-b"]);
    expect(results[0]!.CODEX_HOME).not.toBe(results[1]!.CODEX_HOME);
  });

  it("gives Gemini the user's own key, including a Vertex AI project", async () => {
    await withUserAiCredential({ source: "shared", provider: "google", apiKey: "user-gemini",
      vertex: { project: "synthetic-project", location: "global" } }, async () => {
      const endpoint = geminiEndpoint(operatorEnv);
      expect(endpoint?.apiKey).toBe("user-gemini");
      expect(endpoint?.url("gemini-3.8-flash")).toContain("/projects/synthetic-project/locations/global/");
    });
  });
});
