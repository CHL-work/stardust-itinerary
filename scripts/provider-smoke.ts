// Checks each configured AI provider end to end with a synthetic, trip-free structured request
// through the same transports the app uses. Prints one line per provider; never prints keys.
//   node --import tsx scripts/provider-smoke.ts [openai|anthropic|google ...]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import { lockedDownCodexConfig } from "@/lib/ai/codex-lockdown";
import { withOperatorAiCredential } from "@/lib/ai/credential-context";
import { generateWithGemini, geminiEndpoint } from "@/lib/ai/gemini";
import { providerEnvironment } from "@/lib/ai/provider-environment";

const schema = {
  type: "object", additionalProperties: false,
  properties: { answer: { type: "string", maxLength: 40 } }, required: ["answer"],
} as const;
const prompt = "Reply with JSON whose answer field is exactly the word ok. Do not use tools.";
const models = { openai: "gpt-6.1-sol", anthropic: "claude-haiku-5-5", google: "gemini-3.8-flash" } as const;
type Provider = keyof typeof models;

async function openai(): Promise<string> {
  if (!process.env.CODEX_API_KEY && !process.env.OPENAI_API_KEY) return "skipped (no key)";
  const workDirectory = await mkdtemp(join(tmpdir(), "stardust-smoke-"));
  try {
    const thread = new Codex({ env: providerEnvironment(), config: lockedDownCodexConfig })
      .startThread({ model: models.openai, modelReasoningEffort: "low", sandboxMode: "read-only", workingDirectory: workDirectory,
        skipGitRepoCheck: true, networkAccessEnabled: false, webSearchMode: "disabled", approvalPolicy: "never" });
    const turn = await thread.run(prompt, { outputSchema: schema, signal: AbortSignal.timeout(120_000) });
    return JSON.parse(turn.finalResponse).answer;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function anthropic(): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return "skipped (no key)";
  const workDirectory = await mkdtemp(join(tmpdir(), "stardust-smoke-"));
  try {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 120_000);
    try {
      for await (const message of claudeQuery({ prompt, options: {
        env: providerEnvironment(), model: models.anthropic, abortController, cwd: workDirectory, tools: [], allowedTools: [],
        settingSources: [], persistSession: false, permissionMode: "dontAsk", maxTurns: 2, stderr: () => {},
        outputFormat: { type: "json_schema", schema },
      } })) {
        if (message.type === "result") {
          if (message.subtype !== "success" || message.is_error) throw new Error(`result ${message.subtype}`);
          const value = message.structured_output ?? JSON.parse(message.result);
          return (value as { answer: string }).answer;
        }
      }
      throw new Error("no result");
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function google(): Promise<string> {
  if (!geminiEndpoint()) return "skipped (no key)";
  const result = await generateWithGemini({ model: models.google, parts: [{ text: prompt }], responseJsonSchema: schema,
    signal: AbortSignal.timeout(120_000) });
  return JSON.parse(result.text).answer;
}

const checks: Record<Provider, () => Promise<string>> = { openai, anthropic, google };
const requested = (process.argv.slice(2).filter((name): name is Provider => name in checks));
let failed = false;
for (const provider of requested.length ? requested : (Object.keys(checks) as Provider[])) {
  const started = Date.now();
  try {
    // The operator's keys: this is an operator check, never a user's request.
    const answer = await withOperatorAiCredential(checks[provider]);
    console.log(`${provider} (${models[provider]}): ${answer} in ${Date.now() - started} ms`);
  } catch (error) {
    failed = true;
    const name = error instanceof Error ? error.name : "Error";
    const detail = error && typeof error === "object" && "details" in error ? JSON.stringify((error as { details: unknown }).details) : "";
    console.log(`${provider} (${models[provider]}): FAILED ${name} ${detail} in ${Date.now() - started} ms`);
  }
}
process.exitCode = failed ? 1 : 0;
