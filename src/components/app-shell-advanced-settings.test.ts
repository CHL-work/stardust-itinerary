import { readFileSync } from "node:fs";
import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronRight, RefreshCw } from "lucide-react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ActivitySettingsEntry } from "./activity-panel";
import advancedStyles from "./advanced-settings.module.css";
import { advancedSettingsMessages, advancedRequestStatus } from "@/lib/app/advanced-settings-i18n";
import { activityMessages } from "@/lib/app/activity-i18n";
import { memberManagementMessages } from "@/lib/app/member-management-i18n";
import { aiFundingNote, ownKeyAccess } from "@/components/app-shell";
import { aiKeysMessages } from "@/lib/ai/keys-i18n";
import { ownKeyModels } from "@/lib/ai/own-key-model";
import { selectableOwnerModels } from "@/lib/app/types";
import { feedbackActions } from "@/lib/feedback/contracts";
import { formatMessage, locales, messages, type Locale } from "@/lib/i18n";

const source = readFileSync("src/components/app-shell.tsx", "utf8");
const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function visit(node: ts.Node): void { nodes.push(node); ts.forEachChild(node, visit); }
visit(tree);
const advanced = nodes.find((node): node is ts.JsxElement => ts.isJsxElement(node)
  && node.openingElement.tagName.getText(tree) === "details"
  && node.openingElement.attributes.getText(tree).includes("advancedStyles.advanced"))!;
const toggle = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "PermissionToggle")!;
function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}
const permissions = { canEditItinerary: true, itineraryRequiresApproval: true, canEditExpenses: true, expenseRequiresApproval: false, canSyncCalendar: true };
function renderAdvanced(locale: Locale, options: { owner?: boolean; canSelectModel?: boolean; busy?: boolean; sponsored?: boolean; ai?: Record<string, unknown> } = {}) {
  const isOwner = options.owner ?? true;
  const overview = {
    trip: { id: "synthetic-trip", timeZone: "Asia/Tokyo", startsOn: "2030-04-01", endsOn: "2030-04-05", memberCount: 3 },
    session: { memberId: "synthetic-self", isOwner },
    members: [
      { id: "synthetic-self", displayName: "Synthetic owner", role: "owner", status: "active", identityBound: true, permissions },
      { id: "synthetic-editor", displayName: "Synthetic editor", role: "editor", status: "active", identityBound: true, permissions },
      { id: "synthetic-invited", displayName: "Synthetic invited", role: "viewer", status: "invited", identityBound: false, permissions },
      { id: "synthetic-disabled", displayName: "Synthetic disabled", role: "editor", status: "revoked", identityBound: false, permissions },
      { id: "synthetic-removed", displayName: "Synthetic removed", role: "viewer", status: "removed", identityBound: false, permissions },
    ],
    ai: { canSelectModel: options.canSelectModel ?? isOwner, hostSubscriptionEnabled: options.sponsored ?? true, enabled: true,
      memberDailyLimit: 20, usedToday: 3, remainingToday: 17, effectiveModel: "gpt-6.1-sol", ...options.ai },
    liveOperations: { synthetic: true },
    aiLogs: [{ id: "synthetic-log", actorName: "Synthetic actor", prompt: "SYNTHETIC_PRIVATE_PROMPT", result: "SYNTHETIC_PRIVATE_RESPONSE",
      status: "succeeded", effectiveModel: "gpt-6.1-sol", provider: "openai", transport: "codex_sdk", billingBasis: "subscription",
      inputTokens: 120, outputTokens: 40, latencyMs: 2500, error: null, createdAt: "2030-04-01T00:00:00Z" }],
  };
  const updatePermissions = vi.fn(); const unbindMemberIdentity = vi.fn(); const createMemberInvitation = vi.fn();
  const setSection = vi.fn(); const refresh = vi.fn(); const saveMemberDailyLimit = vi.fn();
  const bindings = {
    React: { createElement, Fragment }, overview, locale, messages: messages[locale], advancedCopy: advancedSettingsMessages(locale),
    advancedStyles, memberCopy: memberManagementMessages(locale), keysCopy: aiKeysMessages(locale), aiFundingNote, ownKeyAccess, ownKeyModels, updateSharedModel: vi.fn(),
    ownKeysToShare: ((options.ai?.ownKeyProviders as string[] | undefined)?.length ?? 0) > 0,
    ChevronRight, RefreshCw, ActivitySettingsEntry,
    FeedbackOperations: () => null,
    AdminEntry: () => null,
    advancedRequestStatus, formatMessage, selectableOwnerModels, busy: options.busy ?? false, selectedModel: "gpt-6.1-sol",
    memberDailyLimit: "20", setMemberDailyLimit: vi.fn(), updateModel: vi.fn(), saveMemberDailyLimit,
    tripSettings: { destinationName: "Synthetic city", timeZone: "Asia/Tokyo", maxMembers: "10", endsOn: "2030-04-05" },
    setTripSettings: vi.fn(), maximumTripEndDate: () => "2030-04-30", saveTripSettings: vi.fn(),
    TripSettingsCard: () => createElement("article", { "data-settings-kind": "trip" }, "SYNTHETIC_TECHNICAL_TRIP"),
    LiveOperationsCard: () => createElement("article", { "data-settings-kind": "operations" }, "SYNTHETIC_OPERATIONS"),
    setSection, updatePermissions, unbindMemberIdentity, createMemberInvitation, refresh,
    memberClaimLinks: { "synthetic-invited": "https://example.test/synthetic-invitation" },
    usageTotals: { input: 120, output: 40, succeeded: 1, failed: 2, rejected: 3 },
    aiLogExecutionLabel: (log: { effectiveModel: string }) => log.effectiveModel,
  };
  const code = ts.transpileModule(`${toggle.getText(tree)}; const render = () => (${advanced.getText(tree)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const node = new Function(...Object.keys(bindings), `${code};return render();`)(...Object.values(bindings)) as ReactElement;
  return { node, html: renderToStaticMarkup(node), overview, updatePermissions, unbindMemberIdentity, createMemberInvitation, setSection, refresh, saveMemberDailyLimit };
}
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;");

describe("collapsed advanced Settings", () => {
  it.each(locales)("keeps owner-only controls in closed native disclosures with localized copy in %s", (locale) => {
    const { node, html } = renderAdvanced(locale);
    const details = descendants(node).filter((item) => item.type === "details");
    expect(details).toHaveLength(3);
    for (const item of details) {
      expect(item.props.open).toBeUndefined();
      expect(descendants(item)[1].type).toBe("summary");
    }
    expect(node.key).toBe("advanced:synthetic-trip:synthetic-self:true");
    const copy = advancedSettingsMessages(locale);
    for (const text of [copy.advanced, copy.description, copy.permissions, copy.usage, copy.requestLog, copy.prompt, copy.result, copy.itineraryApproval, copy.expenseApproval,
      activityMessages(locale).open, messages[locale].aiAccess]) expect(html).toContain(escape(text));
    expect(html).not.toContain("SYNTHETIC_TECHNICAL_TRIP"); expect(html).toContain("SYNTHETIC_OPERATIONS");
    expect(html).toContain("SYNTHETIC_PRIVATE_PROMPT"); expect(html).toContain("SYNTHETIC_PRIVATE_RESPONSE");
    expect(html).toContain("120"); expect(html).toContain("40");
    expect(html).not.toContain("Synthetic disabled"); expect(html).not.toContain("Synthetic removed");
    expect(html).not.toContain('open=""');
  });

  it.each(locales)("never renders operational usage, other members' controls or Activity for a normal member in %s", (locale) => {
    const { node, html } = renderAdvanced(locale, { owner: false });
    expect(descendants(node).filter((item) => item.type === "details")).toHaveLength(1);
    const copy = advancedSettingsMessages(locale);
    expect(html).toContain(escape(copy.memberDescription));
    expect(html).toContain(escape(formatMessage(messages[locale].aiMemberRemaining, { remaining: 17 })));
    for (const text of [copy.permissions, copy.usage, copy.requestLog, activityMessages(locale).open, "SYNTHETIC_PRIVATE_PROMPT", "SYNTHETIC_PRIVATE_RESPONSE",
      "SYNTHETIC_OPERATIONS", "SYNTHETIC_TECHNICAL_TRIP", "Synthetic editor"]) expect(html).not.toContain(escape(text));
    expect(descendants(node).filter((item) => item.type === "form")).toHaveLength(0);
    expect(descendants(node).filter((item) => item.type === "select")).toHaveLength(0);
  });

  it("does not grant model selection to a trip owner without the existing provider entitlement", () => {
    const { node, html } = renderAdvanced("en", { canSelectModel: false, sponsored: false, ai: { enabled: false, keyRequired: true } });
    expect(descendants(node).filter((item) => item.type === "select")).toHaveLength(0);
    expect(html).toContain(escape(aiKeysMessages("en").keyRequired));
  });

  it.each(locales)("explains own-key AI without the trip's daily limit in an unsponsored trip in %s", (locale) => {
    const { html } = renderAdvanced(locale, { owner: false, canSelectModel: false, sponsored: false, ai: { ownKeyProviders: ["google"] } });
    expect(html).toContain(escape(aiKeysMessages(locale).ownKeyAccess));
    expect(html).not.toContain("quota-meter");
    expect(html).not.toContain(escape(formatMessage(messages[locale].aiMemberRemaining, { remaining: 17 })));
  });

  it("keeps the sponsored member quota when the member also holds their own key", () => {
    const { html } = renderAdvanced("en", { owner: false, canSelectModel: false, ai: { ownKeyProviders: ["openai"] } });
    expect(html).toContain("quota-meter");
    expect(html).not.toContain(escape(aiKeysMessages("en").ownKeyAccess));
  });

  it("retains exact member permission callbacks and dependency rules", () => {
    const { node, updatePermissions, unbindMemberIdentity, createMemberInvitation } = renderAdvanced("en");
    const controls = descendants(node).filter((item) => typeof item.type === "function" && item.type.name === "PermissionToggle");
    expect(controls).toHaveLength(10);
    (controls[0].props.change as (value: boolean) => void)(false);
    expect(updatePermissions).toHaveBeenLastCalledWith("synthetic-editor", { ...permissions, canEditItinerary: false, itineraryRequiresApproval: false });
    (controls[2].props.change as (value: boolean) => void)(false);
    expect(updatePermissions).toHaveBeenLastCalledWith("synthetic-editor", { ...permissions, canEditExpenses: false, expenseRequiresApproval: false });
    const buttons = descendants(node).filter((item) => item.type === "button");
    (buttons.find((item) => item.props["data-feedback-action"] === "member_change")?.props.onClick as () => void)();
    expect(unbindMemberIdentity).toHaveBeenCalledExactlyOnceWith("synthetic-editor");
    (buttons.find((item) => item.props["data-feedback-action"] === "member_invite")?.props.onClick as () => void)();
    expect(createMemberInvitation).toHaveBeenCalledExactlyOnceWith("synthetic-invited");
    expect(renderAdvanced("en", { busy: true }).html).toContain('type="checkbox" disabled=""');
  });

  it("removes Permissions and Usage section identities while leaving everyday settings outside Advanced", () => {
    const section = tree.statements.find((item): item is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(item) && item.name.text === "Section")!;
    expect(section.getText(tree)).not.toMatch(/"usage"|"permissions"/);
    const nav = source.slice(source.indexOf("const navItems ="), source.indexOf("const openEvent ="));
    expect(nav).not.toMatch(/id: "(?:usage|permissions)"/);
    expect(source).not.toMatch(/section === "(?:usage|permissions)"/);
    const settings = source.slice(source.indexOf('{section === "settings"'), advanced.getStart(tree));
    for (const marker of ["messages.switchTripTitle", "messages.googleCalendar", "saveProfileName", "signOut()", "members-settings-card", "TripSettingsCard"]) expect(settings).toContain(marker);
    for (const marker of ["messages.aiAccess", "LiveOperationsCard", "ActivitySettingsEntry"]) expect(settings).not.toContain(marker);
  });

  it("uses readable in-flow touch controls and reserves room for the global feedback button", () => {
    const css = readFileSync("src/components/advanced-settings.module.css", "utf8");
    for (const rule of ["min-height: 52px", "min-height: 44px", "font-size: 16px", "line-height: 1.6", ":focus-visible", "overflow-wrap: anywhere", "padding-right: 56px", "prefers-reduced-motion"]) expect(css).toContain(rule);
    expect(css).not.toContain("position: absolute");
    expect(source).toContain('className={`topbar ${advancedStyles.feedbackSpace}`}');
  });
});

describe("privacy-safe action instrumentation", () => {
  const files = ["app-shell", "ai-conversation-page", "approval-request-cards", "activity-panel", "trip-expense-summary", "member-management-controls", "locale-switcher", "create-trip-form",
    "new-ui/ui-mode-toggle", "new-ui/new-navigation", "new-ui/trip-overview-bar", "trip-adjacent-nav", "trip-deletion-controls"];
  it("uses only literal allowlisted action codes, never IDs, labels, values or URLs", () => {
    const seen = new Set<string>();
    for (const file of files) {
      const text = readFileSync(`src/components/${file}.tsx`, "utf8");
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const check = (expression: ts.Node): void => {
        if (ts.isStringLiteral(expression)) {
          expect(feedbackActions).toContain(expression.text); seen.add(expression.text);
        } else if (ts.isJsxExpression(expression) && expression.expression) check(expression.expression);
        else if (ts.isConditionalExpression(expression)) { check(expression.whenTrue); check(expression.whenFalse); }
        else throw new Error(`Nonliteral diagnostic action in ${file}`);
      };
      const walk = (node: ts.Node): void => {
        if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "data-feedback-action") { expect(node.initializer).toBeDefined(); check(node.initializer!); }
        ts.forEachChild(node, walk);
      };
      walk(parsed);
    }
    for (const code of ["navigate", "event_open", "event_edit", "event_save", "event_approve", "event_reject", "event_cancel", "expense_open", "expense_edit", "expense_save", "expense_approve", "expense_reject",
      "calendar_sync", "calendar_refresh", "ai_submit", "ai_new", "ai_resume", "trip_switch", "settings_save", "member_invite", "member_change", "logout"]) expect(seen.has(code)).toBe(true);
  });

  it("announces only authenticated identity, locale and section, with no unmount/network purge", () => {
    const effect = nodes.find((node): node is ts.CallExpression => ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect"
      && node.arguments[0]?.getText(tree).includes("announceFeedbackContext"))!;
    expect(effect).toBeDefined();
    const announceFeedbackContext = vi.fn();
    const run = (trip: string | undefined, member: string | undefined, lost: boolean) => {
      const code = ts.transpileModule(`const effect=${effect.arguments[0].getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      return new Function("feedbackTripId", "feedbackMemberId", "activityAccessLost", "section", "locale", "announceFeedbackContext", `${code};return effect();`)(trip, member, lost, "settings", "en", announceFeedbackContext);
    };
    expect(run("synthetic-trip", "synthetic-member", false)).toBeUndefined();
    expect(announceFeedbackContext).toHaveBeenCalledExactlyOnceWith({ tripId: "synthetic-trip", memberId: "synthetic-member", page: "settings", locale: "en" });
    run(undefined, undefined, false); run("synthetic-trip", "synthetic-member", true);
    expect(announceFeedbackContext).toHaveBeenCalledOnce();
    const signOut = source.slice(source.indexOf("const signOut ="), source.indexOf("const enableDisruptionNotifications ="));
    expect(signOut.indexOf("clearFeedbackContext()")).toBeLessThan(signOut.indexOf("await jsonRequest"));
    expect(source).toContain("if (response.status === 401) clearFeedbackContext();");
  });
});
