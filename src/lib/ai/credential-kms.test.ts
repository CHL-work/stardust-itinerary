import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiKeyProtection } from "@/lib/ai/credentials";
import { CredentialKmsUnavailableError, crc32c, kmsOpen, kmsSeal, kmsSettings, resetKmsTokenCache } from "@/lib/ai/credential-kms";

const keyName = "projects/synthetic-project/locations/asia-northeast1/keyRings/stardust/cryptoKeys/ai-credentials";
const serviceAccount = "stardust-credentials@synthetic-project.iam.gserviceaccount.com";
const settings = { keyName, serviceAccount };
const aad = Buffer.from("stardust-ai-credential:v1:00000000-0000-4000-8000-000000000001:openai");

type Call = { url: string; init: RequestInit };

/** A fake metadata server, IAM Credentials API and KMS. "Ciphertext" is the AAD and plaintext, reversibly scrambled. */
function fakeGoogle(overrides: { encrypt?: (body: Record<string, string>) => Response; decrypt?: (body: Record<string, string>) => Response } = {}) {
  const calls: Call[] = [];
  const scramble = (bytes: Buffer) => Buffer.from(bytes.map((byte) => byte ^ 0x5a));
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("http://169.254.169.254/")) {
      return Response.json({ access_token: "synthetic-base-token", expires_in: 3599, token_type: "Bearer" });
    }
    if (url.startsWith("https://iamcredentials.googleapis.com/")) {
      return Response.json({ accessToken: "synthetic-kms-token", expireTime: new Date(Date.now() + 3_600_000).toISOString() });
    }
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    if (url.endsWith(":encrypt")) {
      if (overrides.encrypt) return overrides.encrypt(body);
      const ciphertext = scramble(Buffer.concat([Buffer.from(body.additionalAuthenticatedData!, "base64"), Buffer.from([0]),
        Buffer.from(body.plaintext!, "base64")]));
      return Response.json({ name: `${keyName}/cryptoKeyVersions/1`, ciphertext: ciphertext.toString("base64"),
        ciphertextCrc32c: String(crc32c(ciphertext)), verifiedPlaintextCrc32c: true, verifiedAdditionalAuthenticatedDataCrc32c: true });
    }
    if (url.endsWith(":decrypt")) {
      if (overrides.decrypt) return overrides.decrypt(body);
      const opened = scramble(Buffer.from(body.ciphertext!, "base64"));
      const split = opened.indexOf(0);
      if (!opened.subarray(0, split).equals(Buffer.from(body.additionalAuthenticatedData!, "base64"))) {
        return Response.json({ error: { code: 400 } }, { status: 400 });
      }
      const plaintext = opened.subarray(split + 1);
      return Response.json({ plaintext: plaintext.toString("base64"), plaintextCrc32c: String(crc32c(plaintext)) });
    }
    return new Response("unexpected", { status: 500 });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("Cloud KMS sealing of users' AI keys", () => {
  beforeEach(() => resetKmsTokenCache());

  it("reads its settings strictly", () => {
    expect(kmsSettings({})).toBeNull();
    expect(kmsSettings({ CREDENTIAL_KMS_KEY: " " })).toBeNull();
    expect(kmsSettings({ CREDENTIAL_KMS_KEY: keyName })).toEqual({ keyName, serviceAccount: null });
    expect(kmsSettings({ CREDENTIAL_KMS_KEY: keyName, CREDENTIAL_KMS_SERVICE_ACCOUNT: serviceAccount })).toEqual(settings);
    expect(kmsSettings({ CREDENTIAL_KMS_KEY: `${keyName}/cryptoKeyVersions/1` })).toBe("invalid");
    expect(kmsSettings({ CREDENTIAL_KMS_KEY: "projects/x/keyRings/y" })).toBe("invalid");
    expect(kmsSettings({ CREDENTIAL_KMS_KEY: keyName, CREDENTIAL_KMS_SERVICE_ACCOUNT: "someone@example.com" })).toBe("invalid");
  });

  it("uses the CRC32C (Castagnoli) checksum KMS expects", () => {
    expect(crc32c(Buffer.from("123456789"))).toBe(0xe3069283);
    expect(crc32c(Buffer.alloc(0))).toBe(0);
  });

  it("seals and opens through an impersonated service account, with checksums and no redirects", async () => {
    const google = fakeGoogle();
    const ciphertext = await kmsSeal("sk-synthetic-kms-0123456789", aad, settings, { fetchImpl: google.fetchImpl });
    expect(ciphertext.toString("utf8")).not.toContain("sk-synthetic");
    expect(await kmsOpen(ciphertext, aad, settings, { fetchImpl: google.fetchImpl })).toBe("sk-synthetic-kms-0123456789");

    const [metadata, impersonation, encrypt, decrypt] = google.calls;
    expect(metadata!.url).toBe("http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token");
    expect((metadata!.init.headers as Record<string, string>)["Metadata-Flavor"]).toBe("Google");
    expect(impersonation!.url).toBe(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateAccessToken`);
    expect((impersonation!.init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-base-token");
    expect(JSON.parse(String(impersonation!.init.body))).toEqual({ scope: ["https://www.googleapis.com/auth/cloudkms"], lifetime: "3600s" });
    expect(encrypt!.url).toBe(`https://cloudkms.googleapis.com/v1/${keyName}:encrypt`);
    expect((encrypt!.init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-kms-token");
    const encryptBody = JSON.parse(String(encrypt!.init.body)) as Record<string, string>;
    expect(encryptBody.additionalAuthenticatedData).toBe(aad.toString("base64"));
    expect(encryptBody.plaintextCrc32c).toBe(String(crc32c(Buffer.from("sk-synthetic-kms-0123456789"))));
    expect(encryptBody.additionalAuthenticatedDataCrc32c).toBe(String(crc32c(aad)));
    expect(decrypt!.url).toBe(`https://cloudkms.googleapis.com/v1/${keyName}:decrypt`);
    // One token for both calls; every request refuses redirects, which would forward the token.
    expect(google.calls).toHaveLength(4);
    expect(google.calls.every((call) => call.init.redirect === "error")).toBe(true);
  });

  it("uses the workload's own token when no service account is named", async () => {
    const google = fakeGoogle();
    await kmsSeal("sk-synthetic-direct", aad, { keyName, serviceAccount: null }, { fetchImpl: google.fetchImpl });
    expect(google.calls.map((call) => new URL(call.url).hostname)).toEqual(["169.254.169.254", "cloudkms.googleapis.com"]);
    expect((google.calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-base-token");
  });

  it("never opens a ciphertext under other associated data", async () => {
    const google = fakeGoogle();
    const ciphertext = await kmsSeal("sk-synthetic-bound", aad, settings, { fetchImpl: google.fetchImpl });
    const other = Buffer.from("stardust-ai-credential:v1:00000000-0000-4000-8000-000000000002:openai");
    await expect(kmsOpen(ciphertext, other, settings, { fetchImpl: google.fetchImpl }))
      .rejects.toMatchObject({ name: "CREDENTIAL_KMS_UNAVAILABLE", step: "decrypt_400" });
  });

  it("refuses answers whose checksums do not verify", async () => {
    const unverified = fakeGoogle({ encrypt: () => Response.json({ name: `${keyName}/cryptoKeyVersions/1`, ciphertext: "AAAA",
      ciphertextCrc32c: "0", verifiedPlaintextCrc32c: false, verifiedAdditionalAuthenticatedDataCrc32c: true }) });
    await expect(kmsSeal("sk-synthetic", aad, settings, { fetchImpl: unverified.fetchImpl })).rejects.toMatchObject({ step: "encrypt_unverified" });
    resetKmsTokenCache();
    const corrupted = fakeGoogle({ decrypt: () => Response.json({ plaintext: Buffer.from("tampered").toString("base64"), plaintextCrc32c: "1" }) });
    await expect(kmsOpen(Buffer.from("ciphertext"), aad, settings, { fetchImpl: corrupted.fetchImpl })).rejects.toMatchObject({ step: "decrypt_unverified" });
  });

  it("names the failing step without any secret, and drops a rejected token", async () => {
    const google = fakeGoogle({ decrypt: () => new Response("denied", { status: 401 }) });
    const failure = await kmsOpen(Buffer.from("ciphertext"), aad, settings, { fetchImpl: google.fetchImpl }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CredentialKmsUnavailableError);
    expect(String((failure as Error).message)).not.toMatch(/token|ciphertext|sk-/u);
    await kmsOpen(Buffer.from("ciphertext"), aad, settings, { fetchImpl: google.fetchImpl }).catch(() => {});
    // The 401 made the second call fetch a new token: metadata was asked twice.
    expect(google.calls.filter((call) => call.url.startsWith("http://169.254.169.254/"))).toHaveLength(2);
  });

  it("tells Settings how keys are protected, and fails closed on a malformed KMS setting", () => {
    const localKey = Buffer.alloc(32, 7).toString("base64");
    expect(aiKeyProtection({})).toBeNull();
    expect(aiKeyProtection({ CREDENTIAL_ENCRYPTION_KEY: localKey })).toBe("local");
    expect(aiKeyProtection({ CREDENTIAL_ENCRYPTION_KEY: localKey, CREDENTIAL_KMS_KEY: keyName })).toBe("kms");
    expect(aiKeyProtection({ CREDENTIAL_KMS_KEY: keyName })).toBe("kms");
    expect(aiKeyProtection({ CREDENTIAL_ENCRYPTION_KEY: localKey, CREDENTIAL_KMS_KEY: "not-a-key" })).toBeNull();
    expect(aiKeyProtection({ CREDENTIAL_SECRET_MANAGER_PROJECT: "synthetic-project", CREDENTIAL_KMS_KEY: keyName })).toBe("secret_manager");
    expect(aiKeyProtection({ CREDENTIAL_SECRET_MANAGER_PROJECT: "synthetic-project", CREDENTIAL_ENCRYPTION_KEY: localKey })).toBeNull();
    expect(aiKeyProtection({ CREDENTIAL_SECRET_MANAGER_PROJECT: "synthetic-project", CREDENTIAL_KMS_KEY: "not-a-key", CREDENTIAL_ENCRYPTION_KEY: localKey })).toBeNull();
    expect(aiKeyProtection({ CREDENTIAL_SECRET_MANAGER_PROJECT: "invalid/project", CREDENTIAL_KMS_KEY: keyName })).toBeNull();
    expect(aiKeyProtection({ CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT: serviceAccount, CREDENTIAL_KMS_KEY: keyName })).toBeNull();
  });
});
