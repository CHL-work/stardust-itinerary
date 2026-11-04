import type { ThreadItem } from "@openai/codex-sdk";

/**
 * Outbound search queries from a Codex turn. The CLI also reports opening a source
 * page or finding text in it as web_search items, with the URL in `query`. Those are
 * not new searches, so they must not reach the bound-query gates or count as queries.
 * Items without an explicit page action stay queries, so the gates fail closed.
 */
export function codexSearchQueries(items: readonly ThreadItem[]): string[] {
  return items.flatMap((item) => {
    if (item.type !== "web_search") return [];
    const action = (item as { action?: { type?: unknown } }).action?.type;
    if (action === "open_page" || action === "find_in_page") return [];
    const query = item.query.trim();
    return query ? [query] : [];
  });
}
