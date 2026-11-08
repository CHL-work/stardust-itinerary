import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { query as claudeQuery, type HookCallback, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";

import { consumeClaudeQuery } from "@/lib/ai/claude-query-lifecycle";
import { modelProvider, type AiEffort } from "@/lib/ai/effort";
import { generateWithGemini } from "@/lib/ai/gemini";
import { providerEnvironment } from "@/lib/ai/provider-environment";
import { createClaudeProviderFailureTracker } from "@/lib/ai/provider-failure";
import type { SelectableOwnerModel } from "@/lib/app/types";
import { containsPrivateIdentifier, sanitizeSearchQueries } from "@/lib/disruptions/privacy";
import {
  createCodexDisruptionProvider, DisruptionProviderCleanupError, DisruptionProviderInvocationError, DisruptionProviderToolError,
} from "@/lib/disruptions/provider";
import type { DisruptionProvider, DisruptionProviderResult } from "@/lib/disruptions/types";

/**
 * Routine checks on a member's own key (JOB-094, D-106) with the model and effort they chose. Every
 * provider gets the same bounded turn: live web search plus the structured answer, nothing else. The
 * caller enters the member's credential context, so `providerEnvironment()` and the Gemini endpoint see
 * only that member's key.
 */
export type RoutineCheckChoice = { model: SelectableOwnerModel; effort: AiEffort };

const MAX_QUERY_LENGTH = 500;

function publicSearchQuery(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const query = (value as { query?: unknown }).query;
  if (typeof query !== "string") return null;
  const trimmed = query.trim();
  return trimmed && trimmed.length <= MAX_QUERY_LENGTH && !containsPrivateIdentifier(trimmed) ? trimmed : null;
}

/** A search that returned at least one result page; a refused or failed search returns none. */
function searchReturnedResults(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return false;
  return results.some((result) => result && typeof result === "object" && "content" in result && Array.isArray(result.content)
    && result.content.some((hit: unknown) => hit && typeof hit === "object" && "url" in hit && typeof hit.url === "string"));
}

function usage(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function createGeminiRoutineProvider(choice: RoutineCheckChoice): DisruptionProvider {
  return {
    async check(input): Promise<DisruptionProviderResult> {
      let result;
      try {
        result = await generateWithGemini({
          model: choice.model, parts: [{ text: input.prompt }], responseJsonSchema: input.outputSchema,
          googleSearch: true, thinkingLevel: choice.effort, signal: input.signal,
        });
      } catch (error) {
        throw new DisruptionProviderInvocationError(error);
      }
      // Grounding queries run inside Google; one that names a private identifier fails closed.
      if (result.webSearchQueries.some((query) => containsPrivateIdentifier(query))) throw new DisruptionProviderToolError();
      return {
        rawOutput: result.text, effectiveModel: choice.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens,
        webSearchCount: result.webSearchQueries.length, webSearchQueries: sanitizeSearchQueries(result.webSearchQueries),
      };
    },
  };
}

function createClaudeRoutineProvider(choice: RoutineCheckChoice): DisruptionProvider {
  return {
    async check(input): Promise<DisruptionProviderResult> {
      const workDirectory = await mkdtemp(join(tmpdir(), "stardust-routine-"));
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      input.signal.addEventListener("abort", onAbort, { once: true });
      if (input.signal.aborted) controller.abort();
      const failureTracker = createClaudeProviderFailureTracker();
      const queries: string[] = [];
      let searches = 0;
      let result: SDKResultSuccess | null = null;
      let operationFailed = false;
      // PreToolUse runs before the permission allowlist, so the real gate is here: a public query, or the
      // side-effect-free structured answer.
      const gate: HookCallback = async (hookInput) => {
        if (hookInput.hook_event_name === "PreToolUse"
          && ((hookInput.tool_name === "WebSearch" && publicSearchQuery(hookInput.tool_input)) || hookInput.tool_name === "StructuredOutput")) {
          return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
        }
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
          permissionDecisionReason: "Only public web search and the structured answer are permitted." } };
      };
      try {
        const conversation = claudeQuery({
          prompt: input.prompt,
          options: {
            env: providerEnvironment(), model: choice.model, effort: choice.effort, abortController: controller, cwd: workDirectory,
            tools: ["WebSearch"], allowedTools: ["WebSearch"],
            disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "Agent", "Skill"],
            hooks: { PreToolUse: [{ hooks: [gate], timeout: 5 }] },
            mcpServers: {}, strictMcpConfig: true, settingSources: [], persistSession: false,
            stderr: () => {}, permissionMode: "dontAsk", maxTurns: 8,
            outputFormat: { type: "json_schema", schema: input.outputSchema as Record<string, unknown> },
          },
        });
        await consumeClaudeQuery(conversation, controller.signal, (message) => {
          const providerFailure = failureTracker.observe(message);
          if (providerFailure) throw new DisruptionProviderInvocationError(providerFailure);
          if (message.type === "assistant") {
            for (const block of message.message.content) {
              if (block.type !== "tool_use") continue;
              if (block.name === "WebSearch") {
                const query = publicSearchQuery(block.input);
                if (!query) throw new DisruptionProviderToolError();
                queries.push(query);
              } else if (block.name !== "StructuredOutput") {
                throw new DisruptionProviderToolError();
              }
            }
          }
          if (message.type === "user" && message.tool_use_result !== undefined && searchReturnedResults(message.tool_use_result)) searches += 1;
          if (message.type === "result") {
            if (message.subtype !== "success" || message.is_error) {
              throw new DisruptionProviderInvocationError(new Error("The routine check turn did not finish."));
            }
            result = message;
            return true;
          }
          return false;
        });
      } catch (error) {
        operationFailed = true;
        if (error instanceof DisruptionProviderToolError || error instanceof DisruptionProviderInvocationError) throw error;
        throw new DisruptionProviderInvocationError(error);
      } finally {
        input.signal.removeEventListener("abort", onAbort);
        try {
          await rm(workDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch {
          if (!operationFailed) throw new DisruptionProviderCleanupError();
        }
      }
      const finished = result as SDKResultSuccess | null;
      if (!finished) throw new DisruptionProviderInvocationError(new Error("The routine check returned no answer."));
      const structured = (finished as { structured_output?: unknown }).structured_output;
      return {
        rawOutput: structured === undefined ? finished.result : JSON.stringify(structured),
        effectiveModel: choice.model,
        inputTokens: usage(finished.usage.input_tokens), outputTokens: usage(finished.usage.output_tokens),
        cachedInputTokens: usage(finished.usage.cache_read_input_tokens),
        webSearchCount: searches, webSearchQueries: sanitizeSearchQueries(queries),
      };
    },
  };
}

export function createRoutineCheckProvider(choice: RoutineCheckChoice): DisruptionProvider {
  const provider = modelProvider(choice.model);
  if (provider === "openai") return createCodexDisruptionProvider({ model: choice.model, effort: choice.effort });
  if (provider === "google") return createGeminiRoutineProvider(choice);
  return createClaudeRoutineProvider(choice);
}

/** The transport label recorded with each request. */
export function routineTransport(model: SelectableOwnerModel): "codex_sdk" | "claude_agent_sdk" | "gemini_api" {
  const provider = modelProvider(model);
  return provider === "openai" ? "codex_sdk" : provider === "anthropic" ? "claude_agent_sdk" : "gemini_api";
}

const verificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["date", "source"],
  properties: {
    date: { type: "string", description: "Today's date in UTC as YYYY-MM-DD, from the page you found." },
    source: { type: "string", description: "The https URL of the page you used." },
  },
} as const;

export type RoutineSearchCheck = { ok: true } | { ok: false; reason: "no_search" | "provider" | "auth" };

/**
 * One tiny live search on the member's key with the chosen model before routine checks turn on: the key
 * must be allowed to search the web (an organization may disable it, or a key may lack access). Costs one
 * search and a few hundred tokens.
 */
export async function verifyRoutineWebSearch(choice: RoutineCheckChoice, now: Date, signal: AbortSignal,
  provider: DisruptionProvider = createRoutineCheckProvider(choice)): Promise<RoutineSearchCheck> {
  const today = now.toISOString().slice(0, 10);
  let result: DisruptionProviderResult;
  try {
    result = await provider.check({
      prompt: `Use web search once to find today's date in UTC on a public time website, then answer with JSON only.
Search for: current UTC date and time
Return the date as YYYY-MM-DD and the https URL you used. Do not use any other tool.`,
      outputSchema: verificationSchema, signal,
    });
  } catch (error) {
    const inner = error instanceof DisruptionProviderInvocationError ? error.providerError : error;
    const name = inner instanceof Error ? inner.name : "";
    const status = inner && typeof inner === "object" && "status" in inner ? (inner as { status?: unknown }).status : null;
    if (name === "AI_PROVIDER_AUTH_REQUIRED" || name === "AI_PROVIDER_BILLING" || status === 401 || status === 403) return { ok: false, reason: "auth" };
    return { ok: false, reason: error instanceof DisruptionProviderToolError ? "no_search" : "provider" };
  }
  if (result.webSearchCount < 1) return { ok: false, reason: "no_search" };
  try {
    const parsed = JSON.parse(result.rawOutput) as { date?: unknown };
    const date = typeof parsed.date === "string" ? parsed.date.slice(0, 10) : "";
    const days = Math.abs(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
    // The answer must come from a search: a date more than a day off means the model guessed.
    return Number.isFinite(days) && days <= 1 ? { ok: true } : { ok: false, reason: "no_search" };
  } catch {
    return { ok: false, reason: "provider" };
  }
}
