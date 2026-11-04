import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiCredentialProvider } from "@/lib/ai/credential-crypto";

/**
 * Whose key pays for the model calls of one request. Outside any context (background workers,
 * operator-funded trips) providers use the server operator's keys from the environment. Inside a
 * user-key context, provider adapters see only that key, and SDK state lives in a fresh
 * per-request directory, so two users' requests never share a key or a provider profile.
 */
export type AiCredential =
  | { source: "operator" }
  | {
      source: "own" | "shared";
      provider: AiCredentialProvider;
      apiKey: string;
      vertex: { project: string; location: string } | null;
      stateDirectory: string;
    };

const storage = new AsyncLocalStorage<AiCredential>();

export function activeAiCredential(): AiCredential | undefined {
  return storage.getStore();
}

/** Run `work` with a user's key; the per-request provider state directory is removed afterwards. */
export async function withUserAiCredential<T>(
  credential: { source: "own" | "shared"; provider: AiCredentialProvider; apiKey: string; vertex: { project: string; location: string } | null },
  work: () => Promise<T>,
): Promise<T> {
  const stateDirectory = await mkdtemp(join(tmpdir(), "stardust-ai-key-"));
  try {
    await Promise.all([mkdir(join(stateDirectory, "codex"), { mode: 0o700 }), mkdir(join(stateDirectory, "claude"), { mode: 0o700 })]);
    return await storage.run({ ...credential, stateDirectory }, work);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
}

export function withOperatorAiCredential<T>(work: () => Promise<T>): Promise<T> {
  return storage.run({ source: "operator" }, work);
}

/** Environment overrides for a provider subprocess inside a user-key context. */
export function userCredentialEnvironment(credential: Extract<AiCredential, { source: "own" | "shared" }>): Record<string, string> {
  const env: Record<string, string> = {
    HOME: credential.stateDirectory,
    CODEX_HOME: join(credential.stateDirectory, "codex"),
    CLAUDE_CONFIG_DIR: join(credential.stateDirectory, "claude"),
  };
  if (credential.provider === "openai") {
    env.CODEX_API_KEY = credential.apiKey;
    env.OPENAI_API_KEY = credential.apiKey;
  } else if (credential.provider === "anthropic") {
    env.ANTHROPIC_API_KEY = credential.apiKey;
  }
  return env;
}
