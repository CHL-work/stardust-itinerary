/**
 * Users' AI provider keys sealed by Google Cloud KMS (JOB-069, D-084), an alternative to the local
 * key ring in `credential-crypto.ts`. The encryption key never leaves KMS: this server can only ask
 * KMS to encrypt or decrypt, under an identity that IAM allows, and KMS records every such use in
 * its audit log.
 *
 * - `CREDENTIAL_KMS_KEY` is the symmetric key's resource name,
 *   `projects/<project>/locations/<location>/keyRings/<ring>/cryptoKeys/<key>`.
 * - `CREDENTIAL_KMS_SERVICE_ACCOUNT`, if set, is a Google service account this server impersonates
 *   for KMS calls. On GKE the pod's own Kubernetes identity cannot be named in an IAM deny policy,
 *   so the public instance gives KMS access to a service account, denies everyone else, and lets
 *   only the web server's Kubernetes identity act as that account.
 *
 * Access tokens come from the GKE (or Compute Engine) metadata server. The user and provider are
 * bound as additional authenticated data, exactly as with the local ring, and every request and
 * response carries CRC32C checksums that are verified, as KMS recommends.
 */

const KEY_NAME = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z][a-z0-9-]{0,62}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/u;
const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/u;
const METADATA_TOKEN_URL = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token";
const KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";
const CALL_TIMEOUT_MS = 8_000;
// Refresh a cached token this long before it expires.
const TOKEN_MARGIN_MS = 5 * 60_000;
const MAX_CIPHERTEXT_BYTES = 4096;

export type KmsSettings = { keyName: string; serviceAccount: string | null };
export type KmsDependencies = { fetchImpl?: typeof fetch; now?: () => number };

export class CredentialKmsUnavailableError extends Error {
  constructor(readonly step: string) {
    // The step names what failed (for example "decrypt_403"); never a key, token or ciphertext.
    super(`Cloud KMS is unavailable (${step}).`);
    this.name = "CREDENTIAL_KMS_UNAVAILABLE";
  }
}

/**
 * The KMS settings, null when `CREDENTIAL_KMS_KEY` is unset or empty, or "invalid" when either value
 * is malformed, which makes key storage unavailable instead of silently falling back to the ring.
 */
export function kmsSettings(env: Record<string, string | undefined> = process.env): KmsSettings | null | "invalid" {
  const keyName = env.CREDENTIAL_KMS_KEY?.trim() ?? "";
  if (!keyName) return null;
  const serviceAccount = env.CREDENTIAL_KMS_SERVICE_ACCOUNT?.trim() || null;
  if (!KEY_NAME.test(keyName) || (serviceAccount !== null && !SERVICE_ACCOUNT.test(serviceAccount))) return "invalid";
  return { keyName, serviceAccount };
}

// CRC32C (Castagnoli), which KMS uses for its integrity fields.
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32C_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type CachedToken = { token: string; expiresAt: number; account: string | null };
let cachedToken: CachedToken | null = null;
let pendingToken: Promise<CachedToken> | null = null;

/** For tests: forget the cached access token. */
export function resetKmsTokenCache(): void {
  cachedToken = null;
  pendingToken = null;
}

function positiveSeconds(value: unknown): number | null {
  const seconds = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

async function fetchToken(settings: KmsSettings, fetchImpl: typeof fetch, now: () => number): Promise<CachedToken> {
  let response: Response;
  try {
    response = await fetchImpl(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new CredentialKmsUnavailableError("metadata_unreachable");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new CredentialKmsUnavailableError(`metadata_${response.status}`);
  }
  const metadata = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  const baseToken = typeof metadata?.access_token === "string" && metadata.access_token ? metadata.access_token : null;
  const lifetime = positiveSeconds(metadata?.expires_in);
  if (!baseToken || lifetime === null) throw new CredentialKmsUnavailableError("metadata_malformed");
  if (!settings.serviceAccount) return { token: baseToken, expiresAt: now() + lifetime * 1000, account: null };

  let impersonation: Response;
  try {
    impersonation = await fetchImpl(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(settings.serviceAccount)}:generateAccessToken`, {
        method: "POST",
        headers: { Authorization: `Bearer ${baseToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ scope: [KMS_SCOPE], lifetime: "3600s" }),
        redirect: "error", signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
  } catch {
    throw new CredentialKmsUnavailableError("impersonation_unreachable");
  }
  if (!impersonation.ok) {
    await impersonation.body?.cancel().catch(() => {});
    throw new CredentialKmsUnavailableError(`impersonation_${impersonation.status}`);
  }
  const granted = await impersonation.json().catch(() => null) as { accessToken?: unknown; expireTime?: unknown } | null;
  const token = typeof granted?.accessToken === "string" && granted.accessToken ? granted.accessToken : null;
  const expiresAt = typeof granted?.expireTime === "string" ? Date.parse(granted.expireTime) : Number.NaN;
  if (!token || !Number.isFinite(expiresAt)) throw new CredentialKmsUnavailableError("impersonation_malformed");
  return { token, expiresAt, account: settings.serviceAccount };
}

async function accessToken(settings: KmsSettings, fetchImpl: typeof fetch, now: () => number): Promise<string> {
  if (cachedToken && cachedToken.account === settings.serviceAccount && cachedToken.expiresAt - TOKEN_MARGIN_MS > now()) {
    return cachedToken.token;
  }
  // Concurrent requests share one refresh.
  pendingToken ??= fetchToken(settings, fetchImpl, now).finally(() => { pendingToken = null; });
  const fresh = await pendingToken;
  cachedToken = fresh;
  return fresh.token;
}

async function kmsCall(settings: KmsSettings, operation: "encrypt" | "decrypt", body: Record<string, string>,
  dependencies: KmsDependencies): Promise<Record<string, unknown>> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const token = await accessToken(settings, fetchImpl, now);
  let response: Response;
  try {
    response = await fetchImpl(`https://cloudkms.googleapis.com/v1/${settings.keyName}:${operation}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new CredentialKmsUnavailableError(`${operation}_unreachable`);
  }
  if (!response.ok) {
    // A revoked or expired token: drop it, so the next call fetches a new one.
    if (response.status === 401) cachedToken = null;
    await response.body?.cancel().catch(() => {});
    throw new CredentialKmsUnavailableError(`${operation}_${response.status}`);
  }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!result || typeof result !== "object") throw new CredentialKmsUnavailableError(`${operation}_malformed`);
  return result;
}

function checksum(value: unknown): number | null {
  // int64 values arrive as decimal strings in JSON.
  const parsed = typeof value === "string" && /^[0-9]{1,10}$/u.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Encrypt one secret under the KMS key, binding the associated data. Returns KMS's ciphertext. */
export async function kmsSeal(secret: string, associatedData: Buffer, settings: KmsSettings,
  dependencies: KmsDependencies = {}): Promise<Buffer> {
  const plaintext = Buffer.from(secret, "utf8");
  const result = await kmsCall(settings, "encrypt", {
    plaintext: plaintext.toString("base64"),
    additionalAuthenticatedData: associatedData.toString("base64"),
    plaintextCrc32c: String(crc32c(plaintext)),
    additionalAuthenticatedDataCrc32c: String(crc32c(associatedData)),
  }, dependencies);
  const ciphertext = typeof result.ciphertext === "string" ? Buffer.from(result.ciphertext, "base64") : Buffer.alloc(0);
  if (result.verifiedPlaintextCrc32c !== true || result.verifiedAdditionalAuthenticatedDataCrc32c !== true
    || typeof result.name !== "string" || !result.name.startsWith(`${settings.keyName}/cryptoKeyVersions/`)
    || ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES || checksum(result.ciphertextCrc32c) !== crc32c(ciphertext)) {
    throw new CredentialKmsUnavailableError("encrypt_unverified");
  }
  return ciphertext;
}

/** Decrypt one KMS ciphertext with the same associated data it was sealed with. */
export async function kmsOpen(ciphertext: Buffer, associatedData: Buffer, settings: KmsSettings,
  dependencies: KmsDependencies = {}): Promise<string> {
  if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) throw new Error("Credential ciphertext is malformed.");
  const result = await kmsCall(settings, "decrypt", {
    ciphertext: ciphertext.toString("base64"),
    additionalAuthenticatedData: associatedData.toString("base64"),
    ciphertextCrc32c: String(crc32c(ciphertext)),
    additionalAuthenticatedDataCrc32c: String(crc32c(associatedData)),
  }, dependencies);
  const plaintext = typeof result.plaintext === "string" ? Buffer.from(result.plaintext, "base64") : null;
  if (!plaintext || checksum(result.plaintextCrc32c) !== crc32c(plaintext)) throw new CredentialKmsUnavailableError("decrypt_unverified");
  return plaintext.toString("utf8");
}
