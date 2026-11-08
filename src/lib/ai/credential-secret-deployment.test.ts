import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const iam = read("infra/user-credential-secrets.tf");
const workload = read("deploy/k8s/overlays/gke/credential-secret-cleanup.yaml");
const block = (type: string, name: string) => {
  const match = new RegExp(`resource "${type}" "${name}" \\{([\\s\\S]*?)^\\}`, "mu").exec(iam);
  expect(match, `${type}.${name}`).not.toBeNull();
  return match![1]!;
};

describe("account-key Secret Manager deployment boundaries", () => {
  it("separates project-level empty-resource creation from prefix-limited payload access", () => {
    expect(block("google_project_iam_custom_role", "user_credential_secret_creator"))
      .toContain('permissions = ["secretmanager.secrets.create"]');
    expect(block("google_project_iam_custom_role", "user_credential_secret_payload"))
      .toContain('permissions = ["secretmanager.versions.add", "secretmanager.versions.access"]');
    expect(block("google_project_iam_member", "credentials_use_secret_payload"))
      .toContain("expression  = local.user_credential_secret_scope");
    expect(iam).toContain('user_credential_secret_prefix = "stardust-user-key-"');
    expect(iam).toContain("projects/${local.project_number}/secrets/${local.user_credential_secret_prefix}");
    expect(iam).not.toMatch(/secretmanager\.admin|secretmanager\.secrets\.setIamPolicy|secretmanager\.secrets\.list/u);
  });

  it("gives the cleanup identity deletion only and leaves the existing KMS deny intact", () => {
    expect(block("google_project_iam_custom_role", "user_credential_secret_cleanup"))
      .toContain('permissions = ["secretmanager.secrets.delete"]');
    const grant = block("google_project_iam_member", "cleanup_user_secrets");
    expect(grant).toContain("${local.ksa_principal}/stardust-credential-cleanup");
    expect(grant).toContain("expression  = local.user_credential_secret_scope");
    expect(iam).not.toMatch(/roles\/iam\.workloadIdentityUser|roles\/iam\.serviceAccountTokenCreator|cryptoKeyEncrypterDecrypter/u);
    const main = read("infra/main.tf");
    expect(main).toContain('"stardust-credential-cleanup-env" = ["stardust-credential-cleanup"]');
    expect(main).toContain('exception_principals = ["principal://iam.googleapis.com/projects/-/serviceAccounts/${google_service_account.credentials.email}"]');
    expect(main).toContain('"cloudkms.googleapis.com/cryptoKeyVersions.useToDecrypt"');
  });

  it("does not activate cloud storage or cleanup merely by deploying the application", () => {
    expect(workload).toMatch(/spec:\r?\n  suspend: true\r?\n  schedule: "\*\/15 \* \* \* \*"/u);
    expect(read("deploy/k8s/overlays/gke/kustomization.yaml")).toContain("- credential-secret-cleanup.yaml");
    expect(read("deploy/k8s/base/web.yaml")).not.toContain("CREDENTIAL_SECRET_MANAGER_PROJECT");
    expect(read("deploy/k8s/overlays/gke/patches/web-secrets.yaml")).not.toContain("CREDENTIAL_SECRET_MANAGER_PROJECT");
    expect(read("deploy/container/entrypoint.sh")).toContain('exec node $env_flags --import tsx scripts/cleanup-credential-secrets.ts "$@"');
  });

  it("mounts only cleanup configuration and grants only DB, DNS, public HTTPS and metadata egress", () => {
    expect(workload).toContain("serviceAccountName: stardust-credential-cleanup");
    expect(workload).toContain("secretProviderClass: stardust-credential-cleanup-env");
    expect(workload).not.toMatch(/secretProviderClass: stardust-(?:app|ai|credential)-env|STARDUST_DB_ADMIN_PASSWORD_FILE/u);
    expect(workload).toContain("readOnlyRootFilesystem: true");
    expect(workload).toContain("automountServiceAccountToken: false");
    const ports = [...workload.matchAll(/- port: (\d+)/gu)].map((match) => Number(match[1]));
    expect(ports).toEqual([5432, 53, 53, 443, 80, 988]);
    expect(read("deploy/k8s/base/networkpolicies.yaml")).toContain('"guest-purge", "credential-secret-cleanup"');
    const classes = read("deploy/k8s/overlays/gke/secret-provider-classes.yaml");
    expect(classes).toContain("name: stardust-credential-cleanup-env");
    expect(classes).toContain('/secrets/stardust-credential-cleanup-env/versions/latest"');
  });
});
