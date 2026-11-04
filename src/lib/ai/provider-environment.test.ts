import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { providerEnvironment, feedbackProviderEnvironment } from "./provider-environment";

describe("provider subprocess credentials", () => {
  it("excludes the dedicated publisher credential case-insensitively without changing existing auth", () => {
    const source = { STARDUST_FEEDBACK_GITHUB_TOKEN: "secret", stardust_feedback_github_token: "secret2", CODEX_HOME: "profile", ANTHROPIC_API_KEY: "auth", PATH: "runtime", absent: undefined };
    expect(providerEnvironment(source)).toEqual({ CODEX_HOME: "profile", ANTHROPIC_API_KEY: "auth", PATH: "runtime" });
    expect(source.STARDUST_FEEDBACK_GITHUB_TOKEN).toBe("secret");
  });
  it("feedback only passes required OS/runtime and Codex auth, never DB, Google, GitHub or Node injection variables", () => {
    expect(feedbackProviderEnvironment({ PATH: "runtime", CODEX_HOME: "profile", OPENAI_API_KEY: "auth", DATABASE_URL: "db", GOOGLE_CLIENT_SECRET: "google", GITHUB_TOKEN: "github", GH_TOKEN: "gh", STARDUST_FEEDBACK_GITHUB_TOKEN: "publisher", NODE_OPTIONS: "--require evil", ANTHROPIC_API_KEY: "other" }))
      .toEqual({ PATH: "runtime", CODEX_HOME: "profile", OPENAI_API_KEY: "auth" });
  });
  it("forwards only runtime settings and provider keys, never application secrets or route overrides", () => {
    expect(providerEnvironment({
      PATH: "runtime", HOME: "/home/app", CODEX_API_KEY: "openai-key", OPENAI_API_KEY: "openai-key", ANTHROPIC_API_KEY: "anthropic-key",
      CLAUDE_CONFIG_DIR: "/home/app/.claude", DATABASE_URL: "db", DATABASE_DIRECT_URL: "db-admin", AUTH_SECRET: "session",
      GOOGLE_CLIENT_SECRET: "google", OPENAI_BASE_URL: "https://invalid.test", ANTHROPIC_BASE_URL: "https://invalid.test",
      NODE_OPTIONS: "--require /bad.js", STARDUST_GEMINI_API_KEY: "gemini-key", openai_api_key: "lowercase",
    })).toEqual({
      PATH: "runtime", HOME: "/home/app", CODEX_API_KEY: "openai-key", OPENAI_API_KEY: "openai-key",
      ANTHROPIC_API_KEY: "anthropic-key", CLAUDE_CONFIG_DIR: "/home/app/.claude",
    });
  });
  it("keeps server-only map credentials out of every AI subprocess", () => {
    expect(providerEnvironment({ STARDUST_GOOGLE_MAPS_API_KEY: "synthetic-key", stardust_google_maps_signing_secret: "synthetic-signing", PATH: "runtime" }))
      .toEqual({ PATH: "runtime" });
  });
  it("all existing subprocess entry points explicitly select the safe environment", () => {
    for (const file of ["ai/planner.ts", "ai/public-research-provider.ts", "ai/venue-hours-provider.ts", "ai/image-extraction.ts", "calendar/location-search-provider.ts", "disruptions/provider.ts"]) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const constructors = (text.match(/new Codex\(/gu) ?? []).length;
      const claude = (text.match(/(?:claudeQuery|query)\(\{\s*prompt/gu) ?? []).length;
      expect((text.match(/env: providerEnvironment\(\)/gu) ?? []).length, file).toBe(constructors + claude);
    }
  });
});
