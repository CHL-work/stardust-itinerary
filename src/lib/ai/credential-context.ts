import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiCredentialProvider } from "@/lib/ai/credential-crypto";

/**
 * Whose key pays for the model calls of one request. Every provider call runs inside a context, and
 * the code that decides funding enters it:
 * - `withOperatorAiCredential`: the server operator's keys from the environment (operator-sponsored
 *   trips, the destination lookup, background workers);
 * - `withUserAiCredential`: one user's own or shared key. Provider adapters see only that key, and
 *   SDK state lives in a fresh per-request directory, so two users' requests never share a key or a
 *   provider profile.
 * - `withFreeAiCredential`: no key at all, for free guest AI on keyless free models (JOB-071). Only
 *   the free-model adapter accepts it, and every keyed adapter refuses it.
 * Outside any context, provider adapters refuse to run (`requireAiCredential`): a code path that
 * forgot to choose never falls back to the operator's keys.
 */
export type AiCredential =
  | { source: "operator" }
  | { source: "free" }
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

export class AiCredentialContextMissingError extends Error {
  constructor() {
    super("An AI provider call ran outside a credential context.");
    this.name = "AI_CREDENTIAL_CONTEXT_MISSING";
  }
}

export function activeAiCredential(): AiCredential | undefined {
  return storage.getStore();
}

/** The current call's credential; throws when no context was entered. */
export function requireAiCredential(): AiCredential {
  const credential = storage.getStore();
  if (!credential) throw new AiCredentialContextMissingError();
  return credential;
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

/** Run `work` keylessly on the free guest model. The caller is the code that decided nobody pays (JOB-071). */
export function withFreeAiCredential<T>(work: () => T): T {
  return storage.run({ source: "free" }, work);
}

/** Run `work` on the server operator's keys. The caller is the code that decided the operator pays. */
export function withOperatorAiCredential<T>(work: () => T): T {
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
