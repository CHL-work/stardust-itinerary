import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "@openai/codex-sdk";
import { lockedDownCodexConfig, usedForbiddenCodexItem } from "@/lib/ai/codex-lockdown";

describe("Codex lockdown for in-app model turns", () => {
  it("turns the shell, exec, apps, agents, hooks, memories, image viewer and history off", () => {
    expect(lockedDownCodexConfig.features).toMatchObject({ shell_tool: false, unified_exec: false, apps: false,
      multi_agent: false, hooks: false, view_image: false, memories: false });
    expect(lockedDownCodexConfig).toMatchObject({ mcp_servers: {}, hooks: {}, notify: [], history: { persistence: "none" } });
  });

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
});
