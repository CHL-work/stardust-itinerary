import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { credentialEncryptionConfigured, credentialHint, openCredential, sealCredential } from "@/lib/ai/credential-crypto";

const env = { CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
const owner = { userId: "10000000-0000-4000-8000-000000000001", provider: "openai" as const };
const secret = "sk-synthetic-0123456789abcdefWXYZ";

describe("AI credential encryption", () => {
  it("round-trips a key and never stores it in plaintext", () => {
    const sealed = sealCredential(secret, owner, env);
    expect(sealed.nonce).toHaveLength(12);
    expect(sealed.ciphertext.includes(Buffer.from(secret))).toBe(false);
    expect(openCredential(sealed, owner, env)).toBe(secret);
  });

  it("uses a fresh nonce for every seal", () => {
    expect(sealCredential(secret, owner, env).nonce.equals(sealCredential(secret, owner, env).nonce)).toBe(false);
  });

  it("refuses to open a ciphertext moved to another user, provider or key", () => {
    const sealed = sealCredential(secret, owner, env);
    expect(() => openCredential(sealed, { ...owner, userId: "10000000-0000-4000-8000-000000000002" }, env)).toThrow();
    expect(() => openCredential(sealed, { ...owner, provider: "anthropic" }, env)).toThrow();
    expect(() => openCredential(sealed, owner, { CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") })).toThrow();
    const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
    tampered.ciphertext[0] = tampered.ciphertext[0]! ^ 1;
    expect(() => openCredential(tampered, owner, env)).toThrow();
  });

  it("fails closed without a valid 32-byte key", () => {
    expect(credentialEncryptionConfigured({})).toBe(false);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toBe(false);
    expect(credentialEncryptionConfigured(env)).toBe(true);
    expect(() => sealCredential(secret, owner, {})).toThrow("Credential encryption is not configured.");
  });

  it("accepts only exact base64 and never the session secret", () => {
    const valid = env.CREDENTIAL_ENCRYPTION_KEY;
    // Buffer.from would silently skip the stray characters and still decode 32 bytes.
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: `${valid.slice(0, 20)}!${valid.slice(20)}` })).toBe(false);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: valid.replace("=", "") })).toBe(false);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: ` ${valid}\n` })).toBe(true);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: valid, AUTH_SECRET: valid })).toBe(false);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: valid, AUTH_SECRET: randomBytes(32).toString("base64") })).toBe(true);
  });

  it("shows only the last four characters", () => {
    expect(credentialHint(secret)).toBe("WXYZ");
    expect(credentialHint("short")).toBe("hort");
    expect(credentialHint("ends with space +=")).toBe("****");
  });
});
