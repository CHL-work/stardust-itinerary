import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  credentialEncryptionConfigured, credentialHint, currentCredentialKeyVersion, openCredential, sealCredential,
} from "@/lib/ai/credential-crypto";

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

  it("rotates: seals with the current version and opens older ciphertexts with the listed previous keys", () => {
    const oldKey = env.CREDENTIAL_ENCRYPTION_KEY;
    const newKey = randomBytes(32).toString("base64");
    const sealedV1 = sealCredential(secret, owner, env);
    expect(sealedV1.keyVersion).toBe(1);
    const rotated = { CREDENTIAL_ENCRYPTION_KEY: newKey, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2", CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: ` 1:${oldKey} ` };
    expect(currentCredentialKeyVersion(rotated)).toBe(2);
    expect(openCredential(sealedV1, owner, rotated)).toBe(secret);
    const sealedV2 = sealCredential(secret, owner, rotated);
    expect(sealedV2.keyVersion).toBe(2);
    expect(openCredential(sealedV2, owner, rotated)).toBe(secret);
    // Once the previous key is removed, only the current version opens.
    const retired = { CREDENTIAL_ENCRYPTION_KEY: newKey, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" };
    expect(openCredential(sealedV2, owner, retired)).toBe(secret);
    expect(() => openCredential(sealedV1, owner, retired)).toThrow("Credential encryption is not configured.");
    // A ciphertext labelled with the wrong version does not open under another key.
    expect(() => openCredential({ ...sealedV1, keyVersion: 2 }, owner, rotated)).toThrow();
  });

  it("refuses a malformed key ring as a whole", () => {
    const current = randomBytes(32).toString("base64");
    const previous = randomBytes(32).toString("base64");
    const base = { CREDENTIAL_ENCRYPTION_KEY: current, CREDENTIAL_ENCRYPTION_KEY_VERSION: "3" };
    expect(credentialEncryptionConfigured({ ...base, CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: `2:${previous},1:${randomBytes(32).toString("base64")}` })).toBe(true);
    for (const ring of [
      `3:${previous}`, // reuses the current version
      `2:${previous},2:${randomBytes(32).toString("base64")}`, // repeats a version
      `2:${current}`, // reuses the current key
      `2:${previous},1:${previous}`, // reuses a key
      `2${previous}`, `0:${previous}`, `x:${previous}`, `2:${previous.slice(1)}`, `2:${previous},`, // malformed entries
      `:${previous}`, // an older key always names its version
    ]) expect(credentialEncryptionConfigured({ ...base, CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: ring }), ring.slice(0, 3)).toBe(false);
    expect(credentialEncryptionConfigured({ ...base, CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: `2:${previous}`, AUTH_SECRET: previous })).toBe(false);
    // Another spelling of the same 32 bytes (the unused low bits of the last character) is refused,
    // so neither a reused key nor AUTH_SECRET slips past a text comparison.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const respelled = `${current.slice(0, 42)}${alphabet[alphabet.indexOf(current[42]!) ^ 1]}=`;
    expect(Buffer.from(respelled, "base64").equals(Buffer.from(current, "base64"))).toBe(true);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: respelled })).toBe(false);
    expect(credentialEncryptionConfigured({ ...base, CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: `2:${respelled}` })).toBe(false);
    expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: current, AUTH_SECRET: respelled })).toBe(false);
    for (const version of ["0", "-1", "1.5", "32768", "v2", "01"]) {
      expect(credentialEncryptionConfigured({ CREDENTIAL_ENCRYPTION_KEY: current, CREDENTIAL_ENCRYPTION_KEY_VERSION: version }), version).toBe(false);
    }
    expect(currentCredentialKeyVersion({ CREDENTIAL_ENCRYPTION_KEY: current, CREDENTIAL_ENCRYPTION_KEY_VERSION: "32767" })).toBe(32_767);
    expect(currentCredentialKeyVersion({ CREDENTIAL_ENCRYPTION_KEY: current })).toBe(1);
  });

  it("shows only the last four characters", () => {
    expect(credentialHint(secret)).toBe("WXYZ");
    expect(credentialHint("short")).toBe("hort");
    expect(credentialHint("ends with space +=")).toBe("****");
  });
});
