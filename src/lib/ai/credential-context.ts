import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
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
const STATE_PREFIX = "stardust-ai-key-";
// Longer than any request (the planner's deadline is minutes), so a sweep never removes a live directory.
const STALE_AFTER_MS = 60 * 60 * 1000;

export function activeAiCredential(): AiCredential | undefined {
  return storage.getStore();
}

/**
 * Best effort: remove per-request directories left behind, for example when a provider CLI was
 * still writing while its directory was removed, or the process stopped mid-request.
 */
async function sweepStaleStateDirectories(root: string, now: number): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(STATE_PREFIX)).map(async (entry) => {
    const path = join(root, entry.name);
    const info = await stat(path).catch(() => null);
    if (info && now - info.mtimeMs > STALE_AFTER_MS) await rm(path, { recursive: true, force: true }).catch(() => {});
  }));
}

/** Run `work` with a user's key; the per-request provider state directory is removed afterwards. */
export async function withUserAiCredential<T>(
  credential: { source: "own" | "shared"; provider: AiCredentialProvider; apiKey: string; vertex: { project: string; location: string } | null },
  work: () => Promise<T>,
): Promise<T> {
  const root = tmpdir();
  await sweepStaleStateDirectories(root, Date.now());
  const stateDirectory = await mkdtemp(join(root, STATE_PREFIX));
  try {
    await Promise.all([mkdir(join(stateDirectory, "codex"), { mode: 0o700 }), mkdir(join(stateDirectory, "claude"), { mode: 0o700 })]);
    return await storage.run({ ...credential, stateDirectory }, work);
  } finally {
    // A failed removal must not replace a result whose changes are already committed; the next
    // request's sweep retries it.
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 3 })
      .catch(() => console.warn("A per-request AI provider directory could not be removed"));
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
