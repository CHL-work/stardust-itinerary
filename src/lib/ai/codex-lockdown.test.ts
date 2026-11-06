import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "@openai/codex-sdk";
import { disabledCodexFeatures, lockedDownCodexConfig, usedForbiddenCodexItem } from "@/lib/ai/codex-lockdown";
import { destinationCodexBinary } from "@/lib/ai/trip-destination-provider";

/**
 * Features of the pinned CLI that stay on under the lockdown: authentication, transport, compaction
 * and model settings, none of which gives a model a tool. Anything else that is on fails the test.
 */
const harmlessDefaultFeatures = new Set([
  "api_key_cyber_access_programs", "api_key_model_discovery", "bedrock_setup_wizard", "cli_daybreak", "code_mode_interrupt",
  "compaction_image_budget", "content_item_kinds", "daemon_auto_start", "enable_request_compression", "fast_mode",
  "guardian_approval", "guardian_reuse_parent_compaction", "incremental_tools", "instant_interrupt",
  "mcp_oauth_refresh_coordination", "mentions_v2", "prediction_preserve_parent_tools", "reasoning_effort_override",
  "secret_auth_storage", "system_proxy_fallback", "ultrafast_mode", "unbounded_connection_retries", "write_stdin_approval",
  // The transport for every tool since Codex 0.147; with it off a session fails closed and cannot even search.
  // Its V8 isolate has no file, network, process or environment API (D-089).
  "code_mode_host",
  // This CLI reports unified exec as on whatever the override says. It runs commands only through the
  // shell tool, which is off: a probe of a locked-down turn on 4 November 2026 found no command tool.
  "unified_exec",
]);

async function enabledFeatures(overrides: Record<string, unknown>): Promise<string[]> {
  const home = await mkdtemp(join(tmpdir(), "stardust-codex-features-"));
  try {
    const args = Object.entries(overrides).flatMap(([feature, value]) => ["-c", `features.${feature}=${String(value)}`]);
    // `features list` reads configuration only; it starts no session and calls no provider.
    const { stdout } = await promisify(execFile)(await destinationCodexBinary(), [...args, "features", "list"],
      { env: { ...process.env, CODEX_HOME: home }, timeout: 60_000 });
    return stdout.split(/\r?\n/u).map((line) => line.trim().split(/\s+/u)).filter((cells) => cells.length >= 3)
      .filter(([, stage, enabled]) => enabled === "true" && stage !== "removed").map(([name]) => name!);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("Codex lockdown for in-app model turns", () => {
  it("turns the shell, exec, browsers, connectors, plugins, skills, agents, hooks, memories, images and history off", () => {
    expect(lockedDownCodexConfig.features).toMatchObject({ shell_tool: false, unified_exec: false, apps: false,
      multi_agent: false, hooks: false, view_image: false, memories: false, browser_use: false, computer_use: false,
      plugins: false, remote_plugin: false, skill_search: false, image_generation: false });
    expect(lockedDownCodexConfig).toMatchObject({ mcp_servers: {}, apps: {}, hooks: {}, notify: [], agents: { enabled: false },
      skills: { bundled: { enabled: false } }, history: { persistence: "none" } });
    // Code mode stays off for the model; only its host stays on, as the tool transport (D-089).
    expect(lockedDownCodexConfig.features).toMatchObject({ code_mode: false, code_mode_only: false });
    expect(lockedDownCodexConfig.features).not.toHaveProperty("code_mode_host");
  });

  it("leaves only harmless features on in the installed CLI, for in-app turns and the feedback reviewer", async () => {
    // The real binary's own report, so a CLI upgrade that adds a default-on tool fails here first.
    const enabled = await enabledFeatures(lockedDownCodexConfig.features as Record<string, unknown>);
    expect(enabled.filter((feature) => !harmlessDefaultFeatures.has(feature))).toEqual([]);
    for (const feature of disabledCodexFeatures.filter((name) => name !== "unified_exec")) expect(enabled, feature).not.toContain(feature);
    // Without the overrides the same CLI does turn tools on, so the check above is not vacuous.
    expect(await enabledFeatures({})).toEqual(expect.arrayContaining(["shell_tool", "browser_use", "plugins"]));
    const review = readFileSync(new URL("../feedback/review-provider.ts", import.meta.url), "utf8");
    expect(review).toContain("features: { ...lockedDownCodexFeatures }");
    expect(readFileSync(new URL("./trip-destination-provider.ts", import.meta.url), "utf8")).toContain("features: { ...lockedDownCodexFeatures,");
  }, 90_000);

  it("accepts only reasoning, the answer and permitted web search", () => {
    const item = (type: string) => ({ type, id: type }) as unknown as ThreadItem;
    expect(usedForbiddenCodexItem([item("reasoning"), item("agent_message")], { webSearch: false })).toBe(false);
    expect(usedForbiddenCodexItem([item("web_search")], { webSearch: true })).toBe(false);
    expect(usedForbiddenCodexItem([item("web_search")], { webSearch: false })).toBe(true);
    for (const type of ["command_execution", "file_change", "mcp_tool_call", "todo_list"]) {
      expect(usedForbiddenCodexItem([item(type)], { webSearch: true })).toBe(true);
    }
  });

  it("is used by the planner and the disruption monitor", () => {
    for (const file of ["ai/planner.ts", "disruptions/provider.ts"]) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(text, file).toContain("config: lockedDownCodexConfig");
      expect(text, file).toContain("usedForbiddenCodexItem(turn.items");
    }
  });

  it("is the only configuration of every in-app Codex call, including research, images and place lookups", () => {
    // These run on users' own keys too, next to other users' provider processes: no file-reading tools.
    for (const file of ["ai/image-extraction.ts", "ai/public-research-provider.ts", "ai/venue-hours-provider.ts", "calendar/location-search-provider.ts"]) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(text, file).toContain("config: lockedDownCodexConfig");
      expect(text.match(/new Codex\(/gu), file).toHaveLength(1);
    }
  });
});
