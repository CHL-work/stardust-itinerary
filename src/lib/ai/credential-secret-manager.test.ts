import { beforeEach, describe, expect, it, vi } from "vitest";
import { crc32c } from "@/lib/ai/credential-kms";
import {
  assertCredentialSecretName, createCredentialSecretName, CredentialSecretManagerUnavailableError,
  deleteCredentialSecret, readCredentialSecret, resetSecretManagerTokenCache, secretManagerSettings,
  storeCredentialSecret, type SecretManagerSettings,
} from "@/lib/ai/credential-secret-manager";

const settings: SecretManagerSettings = { project: "synthetic-project", serviceAccount: "stardust-credentials@synthetic-project.iam.gserviceaccount.com" };
const owner = { userId: "00000000-0000-4000-8000-000000000001", provider: "openai" as const };
const otherOwner = { ...owner, userId: "00000000-0000-4000-8000-000000000002" };
const ciphertext = Buffer.alloc(80, 0xa5);
const now = Date.UTC(2026, 10, 7, 12);

type Call = { url: string; init: RequestInit };
function fakeGoogle(options: { fail?: string; malformed?: string; numericProject?: boolean; missing?: boolean } = {}) {
  const calls: Call[] = [];
  const responseName = (name: string) => options.numericProject ? name.replace(`projects/${settings.project}/`, "projects/123456789012/") : name;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const endpoint = url.startsWith("http://169.254.169.254/") ? "metadata"
      : url.startsWith("https://iamcredentials.googleapis.com/") ? "impersonation"
      : init.method === "DELETE" ? "delete" : url.endsWith(":access") ? "access"
      : url.endsWith(":addVersion") ? "add_version" : "create";
    if (options.fail === endpoint) return new Response("do-not-show-body-or-sensitive-token", { status: 403 });
    if (options.malformed === endpoint) return Response.json({ text: "do-not-show-invalid-response" });
    if (endpoint === "metadata") return Response.json({ access_token: "synthetic-base-token", expires_in: 3600 });
    if (endpoint === "impersonation") return Response.json({ accessToken: "synthetic-secret-token", expireTime: new Date(now + 3_600_000).toISOString() });
    const path = new URL(url).pathname.slice("/v1/".length);
    if (endpoint === "delete") return options.missing ? new Response("gone", { status: 404 }) : Response.json({});
    if (endpoint === "create") return Response.json({ name: responseName(`${path}/${new URL(url).searchParams.get("secretId")}`),
      ...(JSON.parse(String(init.body)).expireTime ? { expireTime: JSON.parse(String(init.body)).expireTime } : {}) });
    if (endpoint === "add_version") return Response.json({ name: responseName(`${path.replace(":addVersion", "")}/versions/1`),
      state: "ENABLED", clientSpecifiedPayloadChecksum: true });
    return Response.json({ name: responseName(path.replace(":access", "")), payload: {
      data: ciphertext.toString("base64"), dataCrc32c: String(crc32c(ciphertext)),
    } });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now };
}

describe("account-owned Secret Manager credential storage", () => {
  beforeEach(() => resetSecretManagerTokenCache());

  it("requires strict settings and refuses partially configured storage", () => {
    expect(secretManagerSettings({})).toBeNull();
    expect(secretManagerSettings({ CREDENTIAL_SECRET_MANAGER_PROJECT: " " })).toBeNull();
    expect(secretManagerSettings({ CREDENTIAL_SECRET_MANAGER_PROJECT: settings.project })).toEqual({ ...settings, serviceAccount: null });
    expect(secretManagerSettings({ CREDENTIAL_SECRET_MANAGER_PROJECT: settings.project,
      CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT: settings.serviceAccount! })).toEqual(settings);
    for (const project of ["x", "projects/synthetic-project", "https://evil.example", "synthetic-project/../other", "Uppercase"]) {
      expect(secretManagerSettings({ CREDENTIAL_SECRET_MANAGER_PROJECT: project })).toBe("invalid");
    }
    expect(secretManagerSettings({ CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT: settings.serviceAccount! })).toBe("invalid");
    expect(secretManagerSettings({ CREDENTIAL_SECRET_MANAGER_PROJECT: settings.project, CREDENTIAL_SECRET_MANAGER_SERVICE_ACCOUNT: "not-a-service-account" })).toBe("invalid");
  });

  it("creates opaque unique names bound to the immutable user and provider", () => {
    const name = createCredentialSecretName(settings, owner);
    const next = createCredentialSecretName(settings, owner);
    expect(name).toMatch(/^projects\/synthetic-project\/secrets\/stardust-user-key-[0-9a-f]{32}-[0-9a-f]{32}$/u);
    expect(name).not.toContain(owner.userId);
    expect(next).not.toBe(name);
    expect(next.slice(0, -32)).toBe(name.slice(0, -32));
    expect(() => assertCredentialSecretName(name, settings, owner)).not.toThrow();
    expect(() => assertCredentialSecretName(name, settings, otherOwner)).toThrow(/reference_invalid/u);
    expect(() => assertCredentialSecretName(name, settings, { ...owner, provider: "google" })).toThrow(/reference_invalid/u);
    expect(() => createCredentialSecretName(settings, { ...owner, userId: "../not-an-account" })).toThrow(/owner_invalid/u);
  });

  it("stores KMS ciphertext with checksums, automatic replication and a fixed guest expiration", async () => {
    const google = fakeGoogle();
    const name = createCredentialSecretName(settings, owner);
    const expiresAt = new Date(now + 24 * 60 * 60_000);
    const version = await storeCredentialSecret(name, ciphertext, settings, { expiresAt }, google);
    expect(version).toBe(`${name}/versions/1`);
    const [metadata, impersonation, create, add] = google.calls;
    expect(metadata!.url).toBe("http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token");
    expect(metadata!.init.headers).toEqual({ "Metadata-Flavor": "Google" });
    expect(impersonation!.url).toBe(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(settings.serviceAccount!)}:generateAccessToken`);
    expect(JSON.parse(String(impersonation!.init.body))).toEqual({ scope: ["https://www.googleapis.com/auth/cloud-platform"], lifetime: "3600s" });
    expect(JSON.parse(String(create!.init.body))).toEqual({ replication: { automatic: {} }, expireTime: expiresAt.toISOString() });
    expect(JSON.parse(String(add!.init.body))).toEqual({ payload: { data: ciphertext.toString("base64"), dataCrc32c: String(crc32c(ciphertext)) } });
    expect(await readCredentialSecret(version, settings, google)).toEqual(ciphertext);
    expect(google.calls.every((call) => call.init.redirect === "error" && !!call.init.signal)).toBe(true);
    expect(google.calls.filter((call) => call.url.startsWith("http://169.254.169.254/"))).toHaveLength(1);
    expect((add!.init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-secret-token");
  });

  it("handles Google's canonical project-number responses without accepting arbitrary input references", async () => {
    const google = fakeGoogle({ numericProject: true });
    const name = createCredentialSecretName(settings, owner);
    const version = await storeCredentialSecret(name, ciphertext, settings, {}, google);
    expect(version).toBe(`${name}/versions/1`);
    expect(await readCredentialSecret(version, settings, google)).toEqual(ciphertext);
    await expect(readCredentialSecret(version.replace(settings.project, "123456789012"), settings, google)).rejects.toMatchObject({ step: "reference_invalid" });
  });

  it("uses workload identity directly if no impersonation is configured", async () => {
    const google = fakeGoogle();
    const direct = { ...settings, serviceAccount: null };
    const name = createCredentialSecretName(direct, owner);
    await storeCredentialSecret(name, ciphertext, direct, {}, google);
    expect(google.calls).toHaveLength(3);
    expect((google.calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-base-token");
  });

  it("isolates concurrent token refreshes by service account", async () => {
    const google = fakeGoogle();
    const name = createCredentialSecretName(settings, owner);
    const other = { ...settings, serviceAccount: "other-credentials@synthetic-project.iam.gserviceaccount.com" };
    await Promise.all([
      readCredentialSecret(`${name}/versions/1`, settings, google),
      readCredentialSecret(`${name}/versions/1`, settings, google),
      readCredentialSecret(`${name}/versions/1`, other, google),
    ]);
    expect(google.calls.filter((call) => call.url.startsWith("http://169.254.169.254/"))).toHaveLength(2);
    expect(google.calls.filter((call) => call.url.startsWith("https://iamcredentials.googleapis.com/"))).toHaveLength(2);
  });

  it("refreshes expired and rejected tokens without replaying writes", async () => {
    const google = fakeGoogle();
    const name = createCredentialSecretName(settings, owner);
    await readCredentialSecret(`${name}/versions/1`, settings, google);
    const denied = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(":access")) return new Response("sensitive-response", { status: 401 });
      return google.fetchImpl(input, init);
    });
    await expect(readCredentialSecret(`${name}/versions/1`, settings, { ...google, fetchImpl: denied as typeof fetch })).rejects.toMatchObject({ step: "access_401" });
    await readCredentialSecret(`${name}/versions/1`, settings, google);
    expect(google.calls.filter((call) => call.url.startsWith("http://169.254.169.254/"))).toHaveLength(2);
    resetSecretManagerTokenCache();
    const direct = { ...settings, serviceAccount: null };
    await readCredentialSecret(`${name}/versions/1`, direct, google);
    await readCredentialSecret(`${name}/versions/1`, direct, { ...google, now: () => now + 3_600_000 });
    expect(google.calls.filter((call) => call.url.startsWith("http://169.254.169.254/"))).toHaveLength(4);
  });

  it("refuses bad resources and latest aliases before any network request", async () => {
    const google = fakeGoogle();
    const name = createCredentialSecretName(settings, owner);
    for (const bad of [name.replace(settings.project, "other-project"), `${name}/../operator-secret`, "https://evil.example/secrets/key", `projects/${settings.project}/secrets/stardust-ai-env`]) {
      expect(() => assertCredentialSecretName(bad, settings)).toThrow();
      await expect(deleteCredentialSecret(bad, settings, google)).rejects.toMatchObject({ step: "reference_invalid" });
    }
    for (const bad of [`${name}/versions/latest`, `${name}/versions/0`, `${name}/versions/01`, `${name}/versions/1?alt=json`, `${name}/versions/1/extra`]) {
      await expect(readCredentialSecret(bad, settings, google)).rejects.toMatchObject({ step: "reference_invalid" });
    }
    expect(google.calls).toHaveLength(0);
  });

  it("refuses invalid payloads and expirations without creating a secret", async () => {
    const google = fakeGoogle();
    const name = createCredentialSecretName(settings, owner);
    for (const invalid of [Buffer.alloc(0), Buffer.alloc(16), Buffer.alloc(4097)]) {
      await expect(storeCredentialSecret(name, invalid, settings, {}, google)).rejects.toMatchObject({ step: "payload_invalid" });
    }
    for (const expiresAt of [new Date(Number.NaN), new Date(now), new Date(now - 1), new Date(now + 59_999)]) {
      await expect(storeCredentialSecret(name, ciphertext, settings, { expiresAt }, google)).rejects.toMatchObject({ step: "expiry_invalid" });
    }
    expect(google.calls).toHaveLength(0);
  });

  it("never adds payload when the guest's exact expiration is missing or changed", async () => {
    const name = createCredentialSecretName(settings, owner);
    const expiresAt = new Date(now + 86_400_000);
    for (const expiration of [undefined, "not-a-date", new Date(expiresAt.getTime() + 1000).toISOString()]) {
      const google = fakeGoogle();
      let versionAdded = false;
      const fetchImpl: typeof fetch = async (input, init) => {
        if (String(input).includes("?secretId=")) return Response.json({ name, expireTime: expiration });
        if (String(input).endsWith(":addVersion")) versionAdded = true;
        return google.fetchImpl(input, init);
      };
      await expect(storeCredentialSecret(name, ciphertext, settings, { expiresAt }, { ...google, fetchImpl }))
        .rejects.toMatchObject({ step: "create_unverified" });
      expect(versionAdded).toBe(false);
    }
  });

  it.each(["metadata", "impersonation", "create", "add_version"])("fails closed with a sanitized %s error", async (step) => {
    const google = fakeGoogle({ fail: step });
    const name = createCredentialSecretName(settings, owner);
    const error = await storeCredentialSecret(name, ciphertext, settings, {}, google).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CredentialSecretManagerUnavailableError);
    expect(error).toMatchObject({ step: `${step}_403` });
    expect(String(error)).not.toMatch(/do-not-show|sensitive|synthetic|a5a5/u);
  });

  it.each(["metadata", "impersonation", "create", "add_version"])("rejects malformed %s output", async (step) => {
    const google = fakeGoogle({ malformed: step });
    const name = createCredentialSecretName(settings, owner);
    await expect(storeCredentialSecret(name, ciphertext, settings, {}, google)).rejects.toMatchObject({
      step: `${step}_${step === "create" || step === "add_version" ? "unverified" : "malformed"}`,
    });
  });

  it("requires the checksum receipt and exact resource on version creation", async () => {
    const name = createCredentialSecretName(settings, owner);
    for (const changes of [{ clientSpecifiedPayloadChecksum: false }, { name: `${name}/versions/latest` }, { state: "DISABLED" },
      { name: `${createCredentialSecretName(settings, otherOwner)}/versions/1` }]) {
      const google = fakeGoogle();
      const fetchImpl: typeof fetch = async (input, init) => String(input).endsWith(":addVersion")
        ? Response.json({ name: `${name}/versions/1`, state: "ENABLED", clientSpecifiedPayloadChecksum: true, ...changes })
        : google.fetchImpl(input, init);
      await expect(storeCredentialSecret(name, ciphertext, settings, {}, { ...google, fetchImpl })).rejects.toMatchObject({ step: "add_version_unverified" });
    }
  });

  it("verifies read checksums, canonical base64, and the exact requested resource", async () => {
    const google = fakeGoogle();
    const name = createCredentialSecretName(settings, owner);
    const version = `${name}/versions/1`;
    for (const reply of [
      { name: version, payload: { data: ciphertext.toString("base64"), dataCrc32c: "1" } },
      { name: version, payload: { data: `${ciphertext.toString("base64")} `, dataCrc32c: String(crc32c(ciphertext)) } },
      { name: `${name}/versions/2`, payload: { data: ciphertext.toString("base64"), dataCrc32c: String(crc32c(ciphertext)) } },
      { name: version, payload: { data: Buffer.alloc(4097).toString("base64"), dataCrc32c: "0" } },
    ]) {
      const fetchImpl: typeof fetch = async (input, init) => String(input).endsWith(":access") ? Response.json(reply) : google.fetchImpl(input, init);
      await expect(readCredentialSecret(version, settings, { ...google, fetchImpl })).rejects.toMatchObject({ step: "access_unverified" });
    }
  });

  it("bounds responses and discards provider/network details", async () => {
    const google = fakeGoogle();
    const name = createCredentialSecretName(settings, owner);
    for (const reply of [() => new Response("x".repeat(20_000)), () => new Response("not-json-sensitive-response"),
      () => { throw new Error("request contains private authorization header"); }]) {
      const fetchImpl: typeof fetch = async (input, init) => String(input).endsWith(":access") ? reply() : google.fetchImpl(input, init);
      const error = await readCredentialSecret(`${name}/versions/1`, settings, { ...google, fetchImpl }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CredentialSecretManagerUnavailableError);
      expect(String(error)).not.toMatch(/sensitive|authorization|xxxxxxxx/u);
    }
  });

  it("deletes only the named secret and treats already missing resources as success", async () => {
    const name = createCredentialSecretName(settings, owner);
    for (const missing of [false, true]) {
      const google = fakeGoogle({ missing });
      await deleteCredentialSecret(name, settings, google);
      const call = google.calls.at(-1)!;
      expect(call.url).toBe(`https://secretmanager.googleapis.com/v1/${name}`);
      expect(call.init.method).toBe("DELETE");
      expect(call.init.body).toBeUndefined();
    }
    const google = fakeGoogle({ fail: "delete" });
    await expect(deleteCredentialSecret(name, settings, google)).rejects.toMatchObject({ step: "delete_403" });
  });
});
