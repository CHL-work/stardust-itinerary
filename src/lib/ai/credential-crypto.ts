import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Users' AI provider keys at rest: AES-256-GCM under a versioned key ring (32 random bytes each,
 * base64). The user and provider are bound as additional authenticated data, so a ciphertext
 * copied to another row or account fails to open. The tag is stored after the ciphertext.
 *
 * - `CREDENTIAL_ENCRYPTION_KEY` is the current key; new and re-encrypted keys are sealed with it.
 * - `CREDENTIAL_ENCRYPTION_KEY_VERSION` is its version (default 1), stored with every ciphertext.
 * - `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` lists older keys as `version:key` pairs, separated by
 *   commas. They only open existing ciphertexts, until `reencryptAiCredentials` has moved every row
 *   to the current key and the operator removes them.
 */
export type AiCredentialProvider = "openai" | "anthropic" | "google";
export type SealedCredential = { ciphertext: Buffer; nonce: Buffer; keyVersion: number };

const TAG_BYTES = 16;
// The column is a smallint.
const MAX_KEY_VERSION = 32_767;

export class CredentialEncryptionUnavailableError extends Error {
  constructor() {
    super("Credential encryption is not configured.");
    this.name = "CREDENTIAL_ENCRYPTION_UNAVAILABLE";
  }
}

// Exactly 32 bytes in standard base64. Buffer.from(…, "base64") would silently skip stray characters.
const KEY_FORMAT = /^[A-Za-z0-9+/]{43}=$/u;
const VERSION_FORMAT = /^[1-9][0-9]{0,4}$/u;

type KeyRing = { version: number; current: Buffer; previous: ReadonlyMap<number, Buffer> };

function keyVersion(raw: string): number {
  const value = raw.trim();
  const version = VERSION_FORMAT.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(version) || version > MAX_KEY_VERSION) throw new CredentialEncryptionUnavailableError();
  return version;
}

/** The 32 key bytes, only from canonical base64, so one key has exactly one accepted spelling. */
function decodedKey(value: string): Buffer | null {
  if (!KEY_FORMAT.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 && bytes.toString("base64") === value ? bytes : null;
}

/**
 * The whole ring or nothing: any malformed entry, a reused version or key, or a key equal to
 * AUTH_SECRET makes credential storage unavailable instead of half-working.
 */
function keyRing(env: Record<string, string | undefined>): KeyRing {
  const authSecret = env.AUTH_SECRET?.trim();
  // Compared as bytes too, in case AUTH_SECRET is another spelling of the same 32 bytes.
  const authBytes = authSecret && KEY_FORMAT.test(authSecret) ? Buffer.from(authSecret, "base64").toString("hex") : null;
  const seen = new Set<string>();
  const key = (raw: string | undefined): Buffer => {
    const value = raw?.trim() ?? "";
    const bytes = decodedKey(value);
    // A dedicated secret: reusing AUTH_SECRET would let one leaked value both forge sessions and open keys.
    if (!bytes || value === authSecret || bytes.toString("hex") === authBytes || seen.has(bytes.toString("hex"))) {
      throw new CredentialEncryptionUnavailableError();
    }
    seen.add(bytes.toString("hex"));
    return bytes;
  };
  // Only the current key's version may be left out (a single-key setup is version 1).
  const version = keyVersion(env.CREDENTIAL_ENCRYPTION_KEY_VERSION?.trim() || "1");
  const current = key(env.CREDENTIAL_ENCRYPTION_KEY);
  const previous = new Map<number, Buffer>();
  const listed = env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS?.trim();
  for (const entry of listed ? listed.split(",") : []) {
    const separator = entry.indexOf(":");
    if (separator < 0) throw new CredentialEncryptionUnavailableError();
    const previousVersion = keyVersion(entry.slice(0, separator));
    if (previousVersion === version || previous.has(previousVersion)) throw new CredentialEncryptionUnavailableError();
    previous.set(previousVersion, key(entry.slice(separator + 1)));
  }
  return { version, current, previous };
}

function encryptionKey(ring: KeyRing, version: number): Buffer {
  const found = version === ring.version ? ring.current : ring.previous.get(version);
  if (!found) throw new CredentialEncryptionUnavailableError();
  return found;
}

function additionalData(userId: string, provider: AiCredentialProvider): Buffer {
  return Buffer.from(`stardust-ai-credential:v1:${userId}:${provider}`, "utf8");
}

export function credentialEncryptionConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try { keyRing(env); return true; } catch { return false; }
}

/** The version new ciphertexts are sealed with. Throws when the ring is not configured. */
export function currentCredentialKeyVersion(env: Record<string, string | undefined> = process.env): number {
  return keyRing(env).version;
}

export function sealCredential(secret: string, owner: { userId: string; provider: AiCredentialProvider },
  env: Record<string, string | undefined> = process.env): SealedCredential {
  const ring = keyRing(env);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.current, nonce);
  cipher.setAAD(additionalData(owner.userId, owner.provider));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyVersion: ring.version };
}

export function openCredential(sealed: SealedCredential, owner: { userId: string; provider: AiCredentialProvider },
  env: Record<string, string | undefined> = process.env): string {
  const key = encryptionKey(keyRing(env), sealed.keyVersion);
  if (sealed.nonce.length !== 12 || sealed.ciphertext.length <= TAG_BYTES) throw new Error("Credential ciphertext is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.nonce);
  decipher.setAAD(additionalData(owner.userId, owner.provider));
  decipher.setAuthTag(sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}

/** The only part of a key ever shown again: its last four characters. */
export function credentialHint(secret: string): string {
  const visible = secret.trim().slice(-4);
  return /^[A-Za-z0-9_-]{1,4}$/u.test(visible) ? visible : "****";
}
