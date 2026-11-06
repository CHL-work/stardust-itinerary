import type { Codex, ThreadItem } from "@openai/codex-sdk";

type CodexConfig = NonNullable<NonNullable<ConstructorParameters<typeof Codex>[0]>["config"]>;

/**
 * Every Codex feature that gives a model a capability beyond reasoning, answering and (when a
 * thread allows it) web search. Several are on by default in the pinned CLI, so each is turned off
 * explicitly. `codex-lockdown.test.ts` runs the installed CLI's `features list` with these overrides
 * and fails when a new default-on feature appears, so a CLI upgrade gets reviewed here.
 */
export const disabledCodexFeatures = [
  // Shell, exec and their helpers: a read-only sandbox still lets a shell read mounted secret files.
  "shell_tool", "unified_exec", "unified_exec_tty", "shell_snapshot",
  // Browsers and computer use can open local files and pages.
  "browser_use", "browser_use_external", "browser_use_full_cdp_access", "browser_annotation_api", "computer_use",
  "in_app_browser", "in_app_chat", "in_app_local_automation", "in_app_dictation", "in_app_voice", "in_app_updates",
  // Connectors, plugins, skills and other tool sources.
  "apps", "plugins", "plugin_sharing", "remote_plugin", "skill_search", "skill_mcp_dependency_install", "tool_suggest",
  "tool_call_mcp_elicitation", "workspace_dependencies",
  // Agents, hooks, memory, images and other side effects.
  "multi_agent", "multi_agent_v2", "hooks", "memories", "view_image", "image_generation", "goals",
  "sleep_tool", "auth_elicitation",
  // Code mode as a model-facing feature stays off. Its host, `code_mode_host`, stays on: since Codex 0.147 every
  // tool, web search included, runs through `codex-code-mode-host`, and with the host off each session fails
  // closed, so no turn could search (D-089). The host runs model-written JavaScript in a bare V8 isolate with no
  // file, network, process or environment API, so it reaches only the tools left on here.
  "code_mode", "code_mode_only",
] as const;

/** `features` overrides that turn every listed feature off; spread into other Codex configurations. */
export const lockedDownCodexFeatures: Readonly<Record<string, boolean>> =
  Object.fromEntries(disabledCodexFeatures.map((feature) => [feature, false]));

/**
 * Codex configuration for in-app model turns: no shell, exec, code mode, browser, computer use,
 * connectors, plugins, skills, agents, hooks, memories, image tools, MCP servers or persisted history.
 * Only the code-mode host stays on, as the transport for the tools a thread allows, such as web search (D-089).
 */
export const lockedDownCodexConfig: CodexConfig = {
  features: { ...lockedDownCodexFeatures },
  mcp_servers: {}, apps: {}, hooks: {}, notify: [], agents: { enabled: false },
  skills: { bundled: { enabled: false }, include_instructions: false },
  history: { persistence: "none" },
  analytics: { enabled: false },
};

/** True when a finished turn used anything beyond reasoning, the answer and (if allowed) web search. */
export function usedForbiddenCodexItem(items: readonly ThreadItem[], options: { webSearch: boolean }): boolean {
  const allowed = new Set<string>(["agent_message", "reasoning", ...(options.webSearch ? ["web_search"] : [])]);
  return items.some((item) => !allowed.has(item.type));
}
