import type { Codex, ThreadItem } from "@openai/codex-sdk";

type CodexConfig = NonNullable<NonNullable<ConstructorParameters<typeof Codex>[0]>["config"]>;

/**
 * Codex configuration for in-app model turns: no shell, exec, apps, agents, hooks, memories,
 * image viewer, MCP servers or persisted history. The read-only sandbox alone still lets a shell
 * read local files (including mounted secret files), so the shell itself must be off.
 */
export const lockedDownCodexConfig: CodexConfig = {
  features: {
    shell_tool: false, unified_exec: false, apps: false, multi_agent: false, hooks: false,
    view_image: false, memories: false, shell_snapshot: false,
  },
  mcp_servers: {}, hooks: {}, notify: [], history: { persistence: "none" },
};

/** True when a finished turn used anything beyond reasoning, the answer and (if allowed) web search. */
export function usedForbiddenCodexItem(items: readonly ThreadItem[], options: { webSearch: boolean }): boolean {
  const allowed = new Set<string>(["agent_message", "reasoning", ...(options.webSearch ? ["web_search"] : [])]);
  return items.some((item) => !allowed.has(item.type));
}
