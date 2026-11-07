import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEFAULT_FREE_MODELS, FREE_AI_ENDPOINT, freeAiSettings } from "@/lib/ai/free-model";

const read = (path: string) => readFileSync(path, "utf8");
const patchPath = "deploy/k8s/overlays/gke/patches/web-free-ai.yaml";
const patch = read(patchPath);
// This deliberately small patch contains only quoted scalar process settings.
const deployed = Object.fromEntries([...patch.matchAll(/^\s+- name: (FREE_AI_[A-Z_]+)\r?\n\s+value: "([^"]*)"$/gmu)]
  .map((match) => [match[1]!, match[2]!]));

describe("public-instance free AI deployment", () => {
  it("pins the allowed gateway, default models and bounded quotas on the web container only", () => {
    expect(read("deploy/k8s/overlays/gke/kustomization.yaml")).toContain("- path: patches/web-free-ai.yaml");
    expect(patch).toMatch(/kind: Deployment\r?\nmetadata:\r?\n  name: stardust-web\r?\n  namespace: stardust/u);
    expect(patch).toMatch(/containers:\r?\n        - name: web\r?\n          env:/u);
    expect(deployed).toEqual({
      FREE_AI_ENABLED: "true",
      FREE_AI_MODELS: DEFAULT_FREE_MODELS.join(","),
      FREE_AI_ENDPOINT,
      FREE_AI_PER_USER_DAILY: "10",
      FREE_AI_HOURLY: "60",
      FREE_AI_DAILY: "500",
    });
    expect(freeAiSettings({ GUEST_FREE_AI_ENABLED: "false", GUEST_FREE_AI_MODELS: "nvidia/old-trial:free",
      GUEST_FREE_AI_ENDPOINT: "https://obsolete.example/", ...deployed }))
      .toMatchObject({ enabled: true, models: [...DEFAULT_FREE_MODELS], perUserDaily: 10, hourly: 60, daily: 500 });
    expect(patch).not.toMatch(/GUEST_MODE_ENABLED|PUBLIC_SIGNUP_ENABLED|API_KEY|SECRET|DATABASE_URL/u);
  });

  it("does not enable free AI or guest mode in the reusable base or Compose defaults", () => {
    expect(read("deploy/k8s/base/web.yaml")).not.toContain("FREE_AI_ENABLED");
    expect(read("compose.yaml")).not.toContain("FREE_AI_ENABLED");
    expect(read(".env.example")).toMatch(/^FREE_AI_ENABLED=false$/mu);
    expect(freeAiSettings({}).enabled).toBe(false);
  });

  it("keeps process policy above mounted dotenv values without reading secrets", () => {
    expect(read("deploy/container/entrypoint.sh")).toContain("exec node $env_flags .next/standalone/server.js");
    const result = spawnSync(process.execPath, ["--env-file=.env.example", "-e",
      "console.log(JSON.stringify(Object.fromEntries(Object.keys(process.env).filter(key => key.startsWith('FREE_AI_')).map(key => [key, process.env[key]]))))"],
    { cwd: process.cwd(), env: { NODE_ENV: "test", ...deployed }, encoding: "utf8", timeout: 10_000, windowsHide: true });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual(deployed);
  });
});
