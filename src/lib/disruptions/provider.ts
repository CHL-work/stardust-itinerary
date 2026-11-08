import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Codex } from "@openai/codex-sdk";
import { codexSearchQueries } from "@/lib/ai/codex-web-search";
import { lockedDownCodexConfig, usedForbiddenCodexItem } from "@/lib/ai/codex-lockdown";
import { providerEnvironment } from "@/lib/ai/provider-environment";

import { sanitizeSearchQueries } from "@/lib/disruptions/privacy";
import type { DisruptionProvider, DisruptionProviderResult } from "@/lib/disruptions/types";

export const DISRUPTION_MODEL = "gpt-6.1-sol";
export const DISRUPTION_TIMEOUT_MS = 120_000;

export class DisruptionProviderInvocationError extends Error {
  readonly providerError: unknown;

  constructor(providerError: unknown) {
    super("The disruption provider invocation failed.");
    this.name = "DisruptionProviderInvocationError";
    this.providerError = providerError;
  }
}

/** A disruption turn used something beyond reasoning, its answer and web search; never retried. */
export class DisruptionProviderToolError extends Error {
  constructor() {
    super("A disruption check used a tool outside its allowlist.");
    this.name = "DisruptionProviderToolError";
  }
}

export class DisruptionProviderCleanupError extends Error {
  constructor() {
    super("The disruption provider workspace could not be cleaned up.");
    this.name = "DisruptionProviderCleanupError";
  }
}

/**
 * The operator's background checks use Sol at medium effort. A member's routine checks (JOB-094) pass the
 * OpenAI model and effort they chose for their own key.
 */
export function createCodexDisruptionProvider(options: { model?: string; effort?: "low" | "medium" | "high" } = {}): DisruptionProvider {
  const model = options.model ?? DISRUPTION_MODEL;
  const effort = options.effort ?? "medium";
  return {
    async check(input): Promise<DisruptionProviderResult> {
      const workDirectory = await mkdtemp(join(tmpdir(), "stardust-disruption-"));
      let operationFailed = false;
      try {
        const codex = new Codex({ env: providerEnvironment(), config: lockedDownCodexConfig });
        const thread = codex.startThread({
          model,
          modelReasoningEffort: effort,
          sandboxMode: "read-only",
          workingDirectory: workDirectory,
          skipGitRepoCheck: true,
          networkAccessEnabled: false,
          webSearchMode: "live",
          approvalPolicy: "never",
        });
        let turn;
        try {
          turn = await thread.run(input.prompt, {
            outputSchema: input.outputSchema,
            signal: input.signal,
          });
        } catch (error) {
          throw new DisruptionProviderInvocationError(error);
        }
        if (usedForbiddenCodexItem(turn.items, { webSearch: true })) throw new DisruptionProviderToolError();
        const webSearchItems = turn.items.filter((item) => item.type === "web_search");
        return {
          rawOutput: turn.finalResponse,
          effectiveModel: model,
          inputTokens: turn.usage?.input_tokens ?? null,
          outputTokens: turn.usage?.output_tokens ?? null,
          cachedInputTokens: turn.usage?.cached_input_tokens ?? null,
          webSearchCount: webSearchItems.length,
          webSearchQueries: sanitizeSearchQueries(codexSearchQueries(turn.items)),
        };
      } catch (error) {
        operationFailed = true;
        throw error;
      } finally {
        try {
          await rm(workDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch {
          // A cleanup failure must never replace the provider's primary error.
          // If the provider succeeded, fail closed without retrying the model call.
          if (!operationFailed) throw new DisruptionProviderCleanupError();
        }
      }
    },
  };
}
