/**
 * Secret Manager stores only KMS ciphertext, not plaintext provider keys. The account/provider
 * binding is checked in the resource name here and cryptographically by KMS in credentials.ts.
 * References are pinned versions, never "latest"; every save creates a fresh resource so a failed
 * or concurrent replacement cannot overwrite the resource an existing database row references.
 */
import { createHash, randomUUID } from "node:crypto";
import { credentialAssociatedData, type AiCredentialProvider } from "@/lib/ai/credential-crypto";
import { crc32c } from "@/lib/ai/credential-kms";

const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/u;
const USER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const RESOURCE_ID = /^stardust-user-key-[a-f0-9]{32}-[a-f0-9]{32}$/u;
const VERSION = /^[1-9][0-9]{0,18}$/u;
const METADATA_URL = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token";
const API = "https://secretmanager.googleapis.com/v1/";
const TIMEOUT_MS = 8_000;
const MAX_JSON_BYTES = 16_384;
const MAX_CIPHERTEXT_BYTES = 4096;
const TOKEN_MARGIN_MS = 300_000;

export type SecretManagerSettings = { project: string; serviceAccount: string | null };
export type SecretManagerDependencies = { fetchImpl?: typeof fetch; now?: () => number };
type Owner = { userId: string; provider: AiCredentialProvider };

export class CredentialSecretManagerUnavailableError extends Error {
  constructor(readonly step: string) {
    super(`Secret Manager is unavailable (${step}).`);
    this.name = "CREDENTIAL_SECRET_MANAGER_UNAVAILABLE";
  }
}

export function secretManagerSettings(env: Record<string, string | undefined> = process.env): SecretManagerSettings | null | "invalid" {
  const project = env.CREDENTIAL_SECRET_MANAGER_PROJECT?.trim() ?? "";
  const serviceAccount = env.CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT?.trim() || null;
  if (!project && !serviceAccount) return null;
  if (!PROJECT.test(project) || (serviceAccount && !SERVICE_ACCOUNT.test(serviceAccount))) return "invalid";
  return { project, serviceAccount };
}

function assertSettings(settings: SecretManagerSettings): void {
  if (!PROJECT.test(settings.project) || (settings.serviceAccount !== null && !SERVICE_ACCOUNT.test(settings.serviceAccount))) {
    throw new CredentialSecretManagerUnavailableError("configuration");
  }
}

function ownerHash(owner: Owner): string {
  if (!USER_ID.test(owner.userId) || !["openai", "anthropic", "google"].includes(owner.provider)) {
    throw new CredentialSecretManagerUnavailableError("owner_invalid");
  }
  return createHash("sha256").update(credentialAssociatedData(owner.userId, owner.provider)).digest("hex").slice(0, 32);
}

export function createCredentialSecretName(settings: SecretManagerSettings, owner: Owner): string {
  assertSettings(settings);
  return `projects/${settings.project}/secrets/stardust-user-key-${ownerHash(owner)}-${randomUUID().replaceAll("-", "")}`;
}

/** No arbitrary project, secret, path, URL or version is accepted, including by cleanup. */
export function assertCredentialSecretName(name: string, settings: SecretManagerSettings, owner?: Owner): void {
  assertSettings(settings);
  const prefix = `projects/${settings.project}/secrets/`;
  const id = name.startsWith(prefix) ? name.slice(prefix.length) : "";
  if (!RESOURCE_ID.test(id) || (owner && !id.startsWith(`stardust-user-key-${ownerHash(owner)}-`))) {
    throw new CredentialSecretManagerUnavailableError("reference_invalid");
  }
}

function splitVersion(name: string, settings: SecretManagerSettings): { secret: string; version: string } {
  const match = /^(.*)\/versions\/([^/]+)$/u.exec(name);
  if (!match || !VERSION.test(match[2]!)) throw new CredentialSecretManagerUnavailableError("reference_invalid");
  assertCredentialSecretName(match[1]!, settings);
  return { secret: match[1]!, version: match[2]! };
}

/** Google canonicalizes project IDs to numbers in responses; the requested resource suffix must match. */
function matchesResponseName(actual: unknown, expected: string, settings: SecretManagerSettings): boolean {
  if (actual === expected) return true;
  if (typeof actual !== "string") return false;
  const match = /^projects\/[1-9][0-9]{0,19}\/(secrets\/.*)$/u.exec(actual);
  return !!match && expected === `projects/${settings.project}/${match[1]}`;
}

async function boundedJson(response: Response, step: string): Promise<Record<string, unknown>> {
  if (!response.body) throw new CredentialSecretManagerUnavailableError(`${step}_malformed`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => {});
        throw new CredentialSecretManagerUnavailableError(`${step}_malformed`);
      }
      chunks.push(value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid");
    return result as Record<string, unknown>;
  } catch {
    throw new CredentialSecretManagerUnavailableError(`${step}_malformed`);
  } finally {
    reader.releaseLock();
  }
}

async function request(url: string, init: RequestInit, step: string, fetchImpl: typeof fetch,
  allowMissing = false): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CredentialSecretManagerUnavailableError(`${step}_unreachable`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (allowMissing && response.status === 404) return null;
    throw new CredentialSecretManagerUnavailableError(`${step}_${response.status}`);
  }
  if (step === "delete") {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  return boundedJson(response, step);
}

type Token = { value: string; expiresAt: number };
const tokens = new Map<string, Token>();
const pendingTokens = new Map<string, Promise<Token>>();

export function resetSecretManagerTokenCache(): void {
  tokens.clear();
  pendingTokens.clear();
}

async function fetchToken(settings: SecretManagerSettings, dependencies: SecretManagerDependencies): Promise<Token> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const metadata = await request(METADATA_URL, { headers: { "Metadata-Flavor": "Google" } }, "metadata", fetchImpl);
  if (typeof metadata?.access_token !== "string" || !metadata.access_token || metadata.access_token.length > 8192
    || typeof metadata.expires_in !== "number" || !Number.isFinite(metadata.expires_in) || metadata.expires_in <= 0) {
    throw new CredentialSecretManagerUnavailableError("metadata_malformed");
  }
  if (!settings.serviceAccount) return { value: metadata.access_token, expiresAt: now() + metadata.expires_in * 1000 };
  const granted = await request(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(settings.serviceAccount)}:generateAccessToken`,
    { method: "POST", headers: { Authorization: `Bearer ${metadata.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/cloud-platform"], lifetime: "3600s" }) },
    "impersonation", fetchImpl);
  const expiresAt = typeof granted?.expireTime === "string" ? Date.parse(granted.expireTime) : Number.NaN;
  if (typeof granted?.accessToken !== "string" || !granted.accessToken || granted.accessToken.length > 8192
    || !Number.isFinite(expiresAt) || expiresAt <= now()) {
    throw new CredentialSecretManagerUnavailableError("impersonation_malformed");
  }
  return { value: granted.accessToken, expiresAt };
}

async function accessToken(settings: SecretManagerSettings, dependencies: SecretManagerDependencies): Promise<string> {
  assertSettings(settings);
  const cacheKey = settings.serviceAccount ?? "metadata";
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt - TOKEN_MARGIN_MS > (dependencies.now ?? Date.now)()) return cached.value;
  let pending = pendingTokens.get(cacheKey);
  if (!pending) {
    pending = fetchToken(settings, dependencies).finally(() => pendingTokens.delete(cacheKey));
    pendingTokens.set(cacheKey, pending);
  }
  const fresh = await pending;
  tokens.set(cacheKey, fresh);
  return fresh.value;
}

async function secretCall(path: string, method: "GET" | "POST" | "DELETE", body: unknown, step: string,
  settings: SecretManagerSettings, dependencies: SecretManagerDependencies, allowMissing = false): Promise<Record<string, unknown> | null> {
  const token = await accessToken(settings, dependencies);
  try {
    return await request(`${API}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, step, dependencies.fetchImpl ?? fetch, allowMissing);
  } catch (error) {
    if (error instanceof CredentialSecretManagerUnavailableError && error.step === `${step}_401`) {
      tokens.delete(settings.serviceAccount ?? "metadata");
    }
    throw error;
  }
}

export async function storeCredentialSecret(name: string, ciphertext: Buffer, settings: SecretManagerSettings,
  options: { expiresAt?: Date } = {}, dependencies: SecretManagerDependencies = {}): Promise<string> {
  assertCredentialSecretName(name, settings);
  if (ciphertext.length < 17 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    throw new CredentialSecretManagerUnavailableError("payload_invalid");
  }
  const expiresAt = options.expiresAt;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < (dependencies.now ?? Date.now)() + 60_000)) {
    throw new CredentialSecretManagerUnavailableError("expiry_invalid");
  }
  const id = name.slice(name.lastIndexOf("/") + 1);
  const created = await secretCall(`projects/${settings.project}/secrets?secretId=${id}`, "POST", {
    replication: { automatic: {} }, ...(expiresAt ? { expireTime: expiresAt.toISOString() } : {}),
  }, "create", settings, dependencies);
  if (!matchesResponseName(created?.name, name, settings)
    || (expiresAt && (typeof created?.expireTime !== "string" || Date.parse(created.expireTime) !== expiresAt.getTime()))) {
    throw new CredentialSecretManagerUnavailableError("create_unverified");
  }
  const version = await secretCall(`${name}:addVersion`, "POST", {
    payload: { data: ciphertext.toString("base64"), dataCrc32c: String(crc32c(ciphertext)) },
  }, "add_version", settings, dependencies);
  const versionNumber = typeof version?.name === "string" ? version.name.slice(version.name.lastIndexOf("/") + 1) : "";
  const versionName = `${name}/versions/${versionNumber}`;
  if (!VERSION.test(versionNumber) || !matchesResponseName(version?.name, versionName, settings)
    || version?.clientSpecifiedPayloadChecksum !== true || version?.state !== "ENABLED") {
    throw new CredentialSecretManagerUnavailableError("add_version_unverified");
  }
  return versionName;
}

export async function readCredentialSecret(versionName: string, settings: SecretManagerSettings,
  dependencies: SecretManagerDependencies = {}): Promise<Buffer> {
  splitVersion(versionName, settings);
  const result = await secretCall(`${versionName}:access`, "GET", undefined, "access", settings, dependencies);
  const payload = result?.payload && typeof result.payload === "object" ? result.payload as Record<string, unknown> : null;
  const encoded = typeof payload?.data === "string" ? payload.data : "";
  const data = encoded.length <= Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
  const checksum = typeof payload?.dataCrc32c === "string" && /^[0-9]{1,10}$/u.test(payload.dataCrc32c) ? Number(payload.dataCrc32c) : Number.NaN;
  if (!matchesResponseName(result?.name, versionName, settings) || data.length < 17 || data.length > MAX_CIPHERTEXT_BYTES
    || data.toString("base64") !== encoded || crc32c(data) !== checksum) {
    throw new CredentialSecretManagerUnavailableError("access_unverified");
  }
  return data;
}

export async function deleteCredentialSecret(name: string, settings: SecretManagerSettings,
  dependencies: SecretManagerDependencies = {}): Promise<void> {
  assertCredentialSecretName(name, settings);
  await secretCall(name, "DELETE", undefined, "delete", settings, dependencies, true);
}
