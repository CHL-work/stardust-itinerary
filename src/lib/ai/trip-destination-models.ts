import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { query as claudeQuery, type HookCallback, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { consumeClaudeQuery } from "@/lib/ai/claude-query-lifecycle";
import { modelProvider } from "@/lib/ai/effort";
import { generateWithFreeModel } from "@/lib/ai/free-model";
import { generateWithGemini } from "@/lib/ai/gemini";
import { providerEnvironment } from "@/lib/ai/provider-environment";
import { AiProviderFailureError, createClaudeProviderFailureTracker } from "@/lib/ai/provider-failure";
import {
  buildTripDestinationPrompt, lookupTripDestination, TripDestinationProviderError, type TripDestinationLookupResult,
} from "@/lib/ai/trip-destination-provider";
import { destinationLookupOutputSchema, normalizeDestination, validateLookupOutput } from "@/lib/app/trip-destination-defaults";
import type { SelectableOwnerModel } from "@/lib/app/types";
import type { Locale } from "@/lib/i18n";

/**
 * Who runs the create-trip destination lookup (JOB-094, D-106): the operator's pinned Codex Sol for the
 * platform operator, the requester's own key with its provider's lightest model, or a free model. Every
 * path is tool-free and returns the same validated JSON; the caller enters the matching credential context.
 */
export type DestinationLookupChoice = { kind: "operator" } | { kind: "own"; model: SelectableOwnerModel } | { kind: "free" };

const MAX_RESPONSE_BYTES = 4_096;
const outputSchema = z.toJSONSchema(destinationLookupOutputSchema) as Record<string, unknown>;

function validated(raw: string, destination: string) {
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new TripDestinationProviderError("INVALID_OUTPUT");
  try { return validateLookupOutput(JSON.parse(raw), normalizeDestination(destination)); }
  catch { throw new TripDestinationProviderError("INVALID_OUTPUT"); }
}

function providerFailure(error: unknown, signal?: AbortSignal): TripDestinationProviderError {
  if (error instanceof TripDestinationProviderError) return error;
  if (signal?.aborted) return new TripDestinationProviderError("TIMEOUT");
  if (error instanceof AiProviderFailureError && error.details.code === "AI_PROVIDER_OUTPUT_INVALID") return new TripDestinationProviderError("INVALID_OUTPUT");
  return new TripDestinationProviderError("PROVIDER_UNAVAILABLE");
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function lookupWithClaude(model: SelectableOwnerModel, prompt: string, destination: string, signal?: AbortSignal) {
  const workDirectory = await mkdtemp(join(tmpdir(), "stardust-destination-"));
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const failureTracker = createClaudeProviderFailureTracker();
  let result: SDKResultSuccess | null = null;
  // No tools at all: only the side-effect-free structured answer may run.
  const gate: HookCallback = async (hookInput) => hookInput.hook_event_name === "PreToolUse" && hookInput.tool_name === "StructuredOutput"
    ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }
    : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "This lookup uses no tools." } };
  try {
    const conversation = claudeQuery({
      prompt,
      options: {
        env: providerEnvironment(), model, effort: "low", abortController: controller, cwd: workDirectory,
        tools: [], allowedTools: [],
        disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Skill"],
        hooks: { PreToolUse: [{ hooks: [gate], timeout: 5 }] },
        mcpServers: {}, strictMcpConfig: true, settingSources: [], persistSession: false,
        stderr: () => {}, permissionMode: "dontAsk", maxTurns: 2,
        outputFormat: { type: "json_schema", schema: outputSchema },
      },
    });
    await consumeClaudeQuery(conversation, controller.signal, (message) => {
      const failure = failureTracker.observe(message);
      if (failure) throw failure;
      if (message.type === "assistant" && message.message.content.some((block) => block.type === "tool_use" && block.name !== "StructuredOutput")) {
        throw new TripDestinationProviderError("TOOL_BLOCKED");
      }
      if (message.type === "result") {
        if (message.subtype !== "success" || message.is_error) throw new TripDestinationProviderError("PROVIDER_UNAVAILABLE");
        result = message;
        return true;
      }
      return false;
    });
  } catch (error) {
    throw providerFailure(error, controller.signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await rm(workDirectory, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  }
  const finished = result as SDKResultSuccess | null;
  if (!finished) throw new TripDestinationProviderError("INVALID_OUTPUT");
  const structured = (finished as { structured_output?: unknown }).structured_output;
  return {
    defaults: validated(structured === undefined ? finished.result : JSON.stringify(structured), destination),
    usage: { inputTokens: count(finished.usage.input_tokens), outputTokens: count(finished.usage.output_tokens),
      cachedInputTokens: count(finished.usage.cache_read_input_tokens) },
  };
}

export async function lookupTripDestinationWith(
  choice: DestinationLookupChoice, input: { destination: string; locale: Locale; signal?: AbortSignal },
): Promise<TripDestinationLookupResult> {
  if (choice.kind === "operator") return lookupTripDestination(input);
  if (choice.kind === "own" && modelProvider(choice.model) === "openai") return lookupTripDestination({ ...input, model: choice.model });
  const prompt = buildTripDestinationPrompt(input.destination);
  if (input.signal?.aborted) throw new TripDestinationProviderError("TIMEOUT");
  const started = Date.now();
  if (choice.kind === "free") {
    let result;
    try {
      result = await generateWithFreeModel({ prompt, responseJsonSchema: outputSchema, maxOutputTokens: 2_048, signal: input.signal });
    } catch (error) { throw providerFailure(error, input.signal); }
    return { defaults: validated(result.text, input.destination),
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens },
      effectiveModel: result.model, latencyMs: Date.now() - started };
  }
  if (modelProvider(choice.model) === "google") {
    let result;
    try {
      result = await generateWithGemini({ model: choice.model, parts: [{ text: prompt }], responseJsonSchema: outputSchema,
        thinkingLevel: "low", maxOutputTokens: 2_048, signal: input.signal });
    } catch (error) { throw providerFailure(error, input.signal); }
    return { defaults: validated(result.text, input.destination),
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens },
      effectiveModel: choice.model, latencyMs: Date.now() - started };
  }
  const claude = await lookupWithClaude(choice.model, prompt, input.destination, input.signal);
  return { ...claude, effectiveModel: choice.model, latencyMs: Date.now() - started };
}
