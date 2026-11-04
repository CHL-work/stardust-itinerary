import type { ThreadItem } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";

import { codexSearchQueries } from "@/lib/ai/codex-web-search";

const search = (query: string, action?: object) => ({ id: "item", type: "web_search", query, ...action ? { action } : {} }) as ThreadItem;
const page = "https://www.tnm.jp/modules/r_free_page/index.php?id=113&lang=en";

describe("Codex web search queries", () => {
  it("keeps real searches and drops the source-page actions CLI 0.165 reports with a URL", () => {
    expect(codexSearchQueries([
      search("", { type: "other" }),
      search("Tokyo National Museum admission", { type: "search", query: "Tokyo National Museum admission" }),
      search(page, { type: "open_page", url: page }),
      search(`'Adults' in ${page}`, { type: "find_in_page", url: page, pattern: "Adults" }),
    ])).toEqual(["Tokyo National Museum admission"]);
  });

  it("treats items with no page action as queries so the gates still see them", () => {
    expect(codexSearchQueries([search("  private lookup  "), search("https://example.test/secret"), search("'Adults'", { type: "other" })]))
      .toEqual(["private lookup", "https://example.test/secret", "'Adults'"]);
  });

  it("ignores other item types and empty queries", () => {
    expect(codexSearchQueries([{ id: "m", type: "agent_message", text: "hello" } as ThreadItem, search("   ")])).toEqual([]);
  });
});
