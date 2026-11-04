import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { NextEventHeader } from "@/components/app-shell";
import { getAppOverview } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { notifyNewDisruptions, type NotificationDependencies, type NotificationWarning } from "@/lib/disruptions/notifications";
import { locales, messages } from "@/lib/i18n";

const id = (number: number) => `a9270000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const at = new Date("2030-04-01T02:00:00Z");
const session: AuthenticatedSession = {
  tripId: id(1), memberId: id(2), userId: id(3), sessionId: id(4), role: "editor", displayName: "Synthetic traveler",
  expiresAt: at, absoluteExpiresAt: at, issuer: "synthetic", subject: "synthetic", generation: 1,
};
const baseRow = {
  id: id(5), trip_day_id: id(6), title: "Synthetic venue visit", item_type: "activity", starts_at: at, ends_at: null,
  location_name: "Synthetic venue", map_url: null, departure_location_name: null, departure_map_url: null,
  destination_location_name: null, destination_map_url: null, notes: null, status: "planned", is_locked: false,
  current_revision: 3, created_by_member_id: id(2), creator_name: "Synthetic traveler", visibility: "trip", viewer_member_ids: [],
};
const qualifiedColumns = {
  disruption_observation_id: id(7), disruption_evidence_fingerprint: "a".repeat(64), disruption_state: "confirmed",
  disruption_reason_code: "closure", disruption_severity: "warning", disruption_detail: "Official notice: the venue is closed today.",
  disruption_localized_details: null, disruption_source_urls: ["https://venue.example.com/closure"],
  disruption_first_seen_at: at, disruption_last_seen_at: at, disruption_checked_at: at,
  disruption_stale_after: new Date("2030-04-01T04:00:00Z"),
};

// This pool supplies already-filtered SELECT rows; it does not emulate PostgreSQL.
// Assert the real emitted qualification SQL here; disposable integration tests execute its filtering.
async function overviewFrom(rows: Array<Record<string, unknown>>, available = true) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const release = vi.fn();
  const client = { release, query: vi.fn(async (statement: unknown, values: unknown[] = []) => {
    const sql = String(statement); statements.push({ sql, values });
    let result: Array<Record<string, unknown>> = [];
    if (sql.includes("AS weather_available")) result = [{ weather_available: false,
      disruptions_available: available, disruption_localizations_available: available }];
    else if (sql.includes("FROM trips WHERE id = $1")) result = [{ id: id(1), name: "Synthetic trip", destination_name: "Synthetic city",
      time_zone: "Asia/Tokyo", default_locale: "en", default_currency: "JPY", starts_on: "2030-04-01", ends_on: "2030-04-02" }];
    else if (sql.includes("SELECT tm.role, mp.can_edit_itinerary")) result = [{ role: "editor" }];
    else if (sql.includes("SELECT i.id, i.trip_day_id, i.title")) result = rows;
    return { rows: result, rowCount: result.length };
  }) };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const overview = await getAppOverview(pool, session);
  const itemQuery = statements.find(({ sql }) => sql.includes("SELECT i.id, i.trip_day_id, i.title"))!;
  expect(release).toHaveBeenCalledOnce();
  return { overview, itemQuery, statements };
}

// Execute the actual notification-selection expression from the frontend effect.
const appSource = readFileSync("src/components/app-shell.tsx", "utf8");
const ast = ts.createSourceFile("app-shell.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function selectPhoneWarnings(overview: Record<string, unknown>): NotificationWarning[] {
  let expression = "";
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "notifyBrowserDisruptions"
        && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const property = node.arguments[0].properties.find((entry) => ts.isPropertyAssignment(entry) && entry.name.getText(ast) === "warnings");
      if (property && ts.isPropertyAssignment(property)) expression = property.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); expect(expression).not.toBe("");
  const compiled = ts.transpileModule(`const warnings = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("overview", `${compiled}; return warnings;`)(overview) as NotificationWarning[];
}
type HeaderItem = NonNullable<Parameters<typeof NextEventHeader>[0]["item"]>;
function projectedItem(overview: Record<string, unknown>): HeaderItem {
  return (overview.itinerary as HeaderItem[])[0];
}

describe("observation-bound disruption overview gate", () => {
  it("requires the exact source observation policy, confidence and material severity while retaining access/freshness fences", async () => {
    const { itemQuery, statements } = await overviewFrom([]);
    const sql = itemQuery.sql.replace(/\s+/g, " ");
    expect(sql).toContain("dc.state = 'confirmed'");
    expect(sql).toMatch(/dc\.severity IN\s*\('warning',\s*'critical'\)/);
    expect(sql).not.toContain("dc.state IN ('possible', 'confirmed')");
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM event_disruption_observations qualified/);
    for (const condition of ["qualified.trip_id = dc.trip_id", "qualified.id = dc.observation_id",
      "qualified.itinerary_item_id = dc.itinerary_item_id", "dc.item_revision = i.current_revision",
      "dc.stale_after > CURRENT_TIMESTAMP", "i.trip_id = $1", "app_member_can_view_itinerary_item(i.trip_id, i.id, $2)"])
      expect(sql).toContain(condition);
    expect(sql).toMatch(/COALESCE\(to_jsonb\(qualified\)->>'qualification_policy_version',\s*'0'\)\s*=\s*'1'/);
    expect(itemQuery.values).toEqual([session.tripId, session.memberId]);
    expect(statements[0].sql).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(statements.at(-1)?.sql).toBe("COMMIT");
    expect(statements.every(({ sql: statement }) => /^(SELECT|BEGIN|COMMIT)\b/.test(statement.trim()))).toBe(true);
  });
  it("fails quiet during rolling upgrades without querying absent disruption tables", async () => {
    const { itemQuery, overview } = await overviewFrom([{ ...baseRow }], false);
    expect(itemQuery.sql).not.toContain("JOIN event_disruption_current");
    expect(itemQuery.sql).not.toContain("FROM event_disruption_observations");
    expect(itemQuery.sql).toContain("NULL::uuid AS disruption_observation_id");
    expect(projectedItem(overview).disruption).toBeNull(); expect(selectPhoneWarnings(overview)).toEqual([]);
  });
});

describe("one qualified projection for event badges and phone warnings", () => {
  it.each(["warning", "critical"])("retains a qualified confirmed %s with the same identity in both surfaces", async (severity) => {
    const { overview } = await overviewFrom([{ ...baseRow, ...qualifiedColumns, disruption_severity: severity }]);
    const item = projectedItem(overview); const warnings = selectPhoneWarnings(overview);
    expect(item.disruption).toMatchObject({ observationId: id(7), state: "confirmed", severity });
    expect(warnings).toEqual([{ id: item.id, title: item.title, disruption: item.disruption }]);
    expect(warnings[0].disruption).toBe(item.disruption);
    for (const locale of locales) {
      const showDisruption = vi.fn();
      const html = renderToStaticMarkup(createElement(NextEventHeader, { item, locale, messages: messages[locale],
        timeZone: "Asia/Tokyo", showDisruption }));
      expect(html).toContain(`disruption-badge severity-${severity}`);
      expect(html).toContain(messages[locale].disruptionClosure); expect(showDisruption).not.toHaveBeenCalled();
    }
  });
  it("never reconstructs a suppressed warning from partial detail, reason or sources", async () => {
    const { overview } = await overviewFrom([{ ...baseRow, ...qualifiedColumns, disruption_observation_id: null }]);
    const item = projectedItem(overview);
    expect(item.disruption).toBeNull(); expect(selectPhoneWarnings(overview)).toEqual([]);
    for (const locale of locales) {
      const html = renderToStaticMarkup(createElement(NextEventHeader, { item, locale, messages: messages[locale],
        timeZone: "Asia/Tokyo", showDisruption: vi.fn() }));
      expect(html).not.toContain("disruption-badge"); expect(html).not.toContain(qualifiedColumns.disruption_detail);
    }
  });
  it("keeps private events outside phone notifications even if supplied an unexpected nonnull warning", async () => {
    const { overview } = await overviewFrom([{ ...baseRow, ...qualifiedColumns, visibility: "private" }]);
    expect(projectedItem(overview).disruption).not.toBeNull(); expect(selectPhoneWarnings(overview)).toEqual([]);
  });
  it("does not pop up when an old warning is suppressed, and preserves qualified-warning deduplication", async () => {
    const qualified = (await overviewFrom([{ ...baseRow, ...qualifiedColumns }])).overview;
    const quiet = (await overviewFrom([{ ...baseRow }])).overview;
    const storage = new Map<string, string>();
    const deps: NotificationDependencies = {
      storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
      exclusive: async (run) => run(), digest: async (value) => createHash("sha256").update(value).digest("hex"),
      show: vi.fn(async () => {}), isCurrent: () => true, canNotify: () => true, now: () => at.getTime(),
    };
    const send = (overview: Record<string, unknown>) => notifyNewDisruptions({ tripId: id(1), memberId: id(2),
      warnings: selectPhoneWarnings(overview) }, deps);
    await send(qualified); // Existing warnings baseline quietly.
    await send(quiet); await send(quiet); await send(qualified);
    expect(deps.show).not.toHaveBeenCalled();
    const changed = structuredClone(qualified);
    projectedItem(changed).disruption!.detail = "Official notice: the venue is now closed for two days.";
    await send(changed); await send(changed);
    expect(deps.show).toHaveBeenCalledOnce();
  });
});
