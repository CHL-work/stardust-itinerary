import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  options: undefined as unknown,
  turnOptions: undefined as unknown,
  workDirectory: "",
  run: vi.fn(),
  cleanupError: null as Error | null,
  cleanupOptions: undefined as unknown,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (path: Parameters<typeof actual.rm>[0], options: Parameters<typeof actual.rm>[1]) => {
      mocks.cleanupOptions = options;
      if (mocks.cleanupError) throw mocks.cleanupError;
      return actual.rm(path, options);
    },
  };
});

vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    startThread(options: { workingDirectory?: string }) {
      mocks.options = options;
      mocks.workDirectory = options.workingDirectory ?? "";
      return {
        run: async (_prompt: string, turnOptions: unknown) => {
          mocks.turnOptions = turnOptions;
          expect(existsSync(mocks.workDirectory)).toBe(true);
          expect(readdirSync(mocks.workDirectory)).toEqual([]);
          return mocks.run();
        },
      };
    }
  },
}));

import {
  createCodexDisruptionProvider as createCodexDisruptionProviderDirect,
  DISRUPTION_MODEL,
  DisruptionProviderCleanupError,
  DisruptionProviderInvocationError,
  DISRUPTION_TIMEOUT_MS,
} from "@/lib/disruptions/provider";
import { withOperatorAiCredential } from "@/lib/ai/credential-context";
// Provider adapters run only inside a credential context; these tests exercise the operator's.
function createCodexDisruptionProvider() {
  const provider = createCodexDisruptionProviderDirect();
  return { ...provider, check: (...args: Parameters<typeof provider.check>) => withOperatorAiCredential(() => provider.check(...args)) };
}

describe("Codex disruption provider", () => {
  afterEach(async () => {
    mocks.cleanupError = null;
    mocks.run.mockReset();
    if (mocks.workDirectory && existsSync(mocks.workDirectory)) {
      await rm(mocks.workDirectory, { recursive: true, force: true });
    }
  });

  it("uses the isolated medium-effort live-search worker profile", async () => {
    mocks.run.mockResolvedValue({
      finalResponse: '{"alerts":[]}',
      usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: 1 },
      items: [{ id: "search-1", type: "web_search", query: "JR East disruptions" }],
    });
    const result = await createCodexDisruptionProvider().check({
      prompt: "check",
      outputSchema: { type: "object" },
      signal: AbortSignal.timeout(DISRUPTION_TIMEOUT_MS),
    });

    expect(mocks.options).toMatchObject({
      model: DISRUPTION_MODEL,
      modelReasoningEffort: "medium",
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "live",
      approvalPolicy: "never",
    });
    expect(mocks.turnOptions).toMatchObject({ outputSchema: { type: "object" } });
    expect(result.webSearchQueries).toEqual(["JR East disruptions"]);
    expect(result.webSearchCount).toBe(1);
    expect(mocks.cleanupOptions).toMatchObject({ maxRetries: 3, retryDelay: 100 });
    expect(existsSync(mocks.workDirectory)).toBe(false);
  });

  it("does not let a workspace cleanup failure replace the primary invocation failure", async () => {
    const providerError = new Error("primary provider failure");
    mocks.run.mockRejectedValue(providerError);
    mocks.cleanupError = new Error("cleanup failure");

    await expect(createCodexDisruptionProvider().check({
      prompt: "check",
      outputSchema: { type: "object" },
      signal: AbortSignal.timeout(DISRUPTION_TIMEOUT_MS),
    })).rejects.toMatchObject({
      name: DisruptionProviderInvocationError.name,
      providerError,
    });
  });

  it("makes a standalone workspace cleanup failure terminal and distinguishable", async () => {
    mocks.run.mockResolvedValue({
      finalResponse: '{"alerts":[]}',
      usage: null,
      items: [{ id: "search-1", type: "web_search", query: "JR East disruptions" }],
    });
    mocks.cleanupError = new Error("cleanup failure");

    await expect(createCodexDisruptionProvider().check({
      prompt: "check",
      outputSchema: { type: "object" },
      signal: AbortSignal.timeout(DISRUPTION_TIMEOUT_MS),
    })).rejects.toBeInstanceOf(DisruptionProviderCleanupError);
  });
});
