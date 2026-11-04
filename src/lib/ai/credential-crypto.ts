import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Users' AI provider keys at rest: AES-256-GCM under CREDENTIAL_ENCRYPTION_KEY (32 random bytes,
 * base64). The user and provider are bound as additional authenticated data, so a ciphertext
 * copied to another row or account fails to open. The tag is stored after the ciphertext.
 */
export type AiCredentialProvider = "openai" | "anthropic" | "google";
export type SealedCredential = { ciphertext: Buffer; nonce: Buffer; keyVersion: number };

const KEY_VERSION = 1;
const TAG_BYTES = 16;

export class CredentialEncryptionUnavailableError extends Error {
  constructor() {
    super("Credential encryption is not configured.");
    this.name = "CREDENTIAL_ENCRYPTION_UNAVAILABLE";
  }
}

// Exactly 32 bytes in standard base64. Buffer.from(…, "base64") would silently skip stray characters.
const KEY_FORMAT = /^[A-Za-z0-9+/]{43}=$/u;

function encryptionKey(env: Record<string, string | undefined>, version: number): Buffer {
  if (version !== KEY_VERSION) throw new CredentialEncryptionUnavailableError();
  const raw = env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  // A dedicated secret: reusing AUTH_SECRET would let one leaked value both forge sessions and open keys.
  if (!raw || !KEY_FORMAT.test(raw) || raw === env.AUTH_SECRET?.trim()) throw new CredentialEncryptionUnavailableError();
  return Buffer.from(raw, "base64");
}

function additionalData(userId: string, provider: AiCredentialProvider): Buffer {
  return Buffer.from(`stardust-ai-credential:v1:${userId}:${provider}`, "utf8");
}

export function credentialEncryptionConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try { encryptionKey(env, KEY_VERSION); return true; } catch { return false; }
}

export function sealCredential(secret: string, owner: { userId: string; provider: AiCredentialProvider },
  env: Record<string, string | undefined> = process.env): SealedCredential {
  const key = encryptionKey(env, KEY_VERSION);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(additionalData(owner.userId, owner.provider));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyVersion: KEY_VERSION };
}

export function openCredential(sealed: SealedCredential, owner: { userId: string; provider: AiCredentialProvider },
  env: Record<string, string | undefined> = process.env): string {
  const key = encryptionKey(env, sealed.keyVersion);
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
