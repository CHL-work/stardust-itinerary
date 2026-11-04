import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ path: "/en" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
import { FeedbackWidget } from "@/components/feedback-widget";
import { FeedbackOperations } from "@/components/feedback-operations";
import { feedbackCopy } from "@/lib/feedback/i18n";
import { locales } from "@/lib/i18n";
import type { FeedbackSubmission } from "@/lib/feedback/contracts";

/** Execute the actual send function with inert state and a local transport. */
async function submissionHarness(status = 200, includeActions = true, pending: FeedbackSubmission | null = null) {
  const source = await readFile("src/components/feedback-widget.tsx", "utf8");
  const ast = ts.createSourceFile("feedback-widget.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let send: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "send") send = node; ts.forEachChild(node, visit); }
  visit(ast); expect(send).toBeDefined();
  const compiled = ts.transpileModule(send!.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const scope = { tripId: "10000000-0000-4000-8000-000000000001", memberId: "20000000-0000-4000-8000-000000000001", scopeKey: "a".repeat(64) };
  const current = { scope, isOperator: false, buildVersion: null };
  const diagnostics = { page: "settings" as const, locale: "en" as const, formFactor: "phone" as const, osFamily: "ios" as const, browserFamily: "safari" as const, online: true, breadcrumbs: [] };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/feedback"); expect(init?.method).toBe("POST");
    return Response.json(status === 428 ? { error: { code: "FEEDBACK_POLICY_CHANGED" } } : { report: { id: "30000000-0000-4000-8000-000000000001", title: "Synthetic feedback", status: "queued", allowIssuePublication: pending?.allowIssuePublication ?? true }, replayed: Boolean(pending) }, { status });
  });
  const bindings = {
    sending: false, verified: { current }, verifiedScopeKey: (scope: { scopeKey: string } | null) => scope?.scopeKey,
    title: " Synthetic feedback ", description: " Synthetic button failed. ", kind: "bug", pending, includeActions, diagnostics,
    crypto: { randomUUID: () => "40000000-0000-4000-8000-000000000001" }, readContext: vi.fn(async () => current),
    withStableSession: async (run: () => Promise<Response>) => run(), fetch: fetcher,
    setSending: vi.fn(), setNotice: vi.fn(), setPending: vi.fn(), setContext: vi.fn(), resetDraft: vi.fn(), clearFeedbackContext: vi.fn(),
    setReceipt: vi.fn(), setRecent: vi.fn(), setTitle: vi.fn(), setDescription: vi.fn(), feedbackTrail: { record: vi.fn() },
  };
  const run = new Function(...Object.keys(bindings), `${compiled}; return send;`)(...Object.values(bindings)) as () => Promise<void>;
  return { run, bindings, fetcher, diagnostics, scope };
}

describe("global private feedback UI boundaries", () => {
  it("anchors the 44px launcher at the page top-right instead of following viewport scroll", async () => {
    const css = await readFile("src/components/feedback-widget.module.css", "utf8");
    const launcher = css.match(/\.launcher\s*\{([^}]+)\}/u)?.[1];
    expect(launcher).toBeDefined();
    expect(launcher).toMatch(/position:\s*absolute\s*;/u);
    expect(launcher).toContain("right: max(12px, env(safe-area-inset-right))");
    expect(launcher).toContain("top: max(12px, env(safe-area-inset-top))");
    expect(launcher).toMatch(/width:\s*44px;\s*height:\s*44px;/u);
    expect(css).not.toMatch(/position:\s*(?:fixed|sticky)\b/u);
    const layout = await readFile("src/app/layout.tsx", "utf8");
    expect(layout).toMatch(/\{children\}\s*<FeedbackWidget\s*\/>\s*<\/body>/u);
    const globals = await readFile("src/app/globals.css", "utf8");
    const offlineHeader = globals.match(/\.offline-itinerary-topbar\s*\{([^}]+)\}/u)?.[1];
    expect(offlineHeader).toContain("padding-right: calc(max(12px, env(safe-area-inset-right)) + 62px)");
  });
  it.each(locales)("renders an accessible localized global entry while signed out (%s)", (locale) => {
    state.path = `/${locale}/privacy`;
    const html = renderToStaticMarkup(createElement(FeedbackWidget));
    expect(html).toContain(`aria-label="${feedbackCopy[locale].open}"`);
    expect(html).toContain("aria-labelledby=\"feedback-heading\"");
    expect(html).not.toContain("scopeKey");
    expect(html).not.toContain("actorUserId");
    expect(html).not.toContain("STARDUST_FEEDBACK_GITHUB_TOKEN");
    expect(renderToStaticMarkup(createElement(FeedbackOperations, { locale }))).toBe("");
  });
  it("has one optional diagnostic checkbox and no publication toggle or state", async () => {
    const source = await readFile("src/components/feedback-widget.tsx", "utf8");
    expect(source.match(/type="checkbox"/gu)).toHaveLength(1);
    expect(source).toContain("checked={includeActions}"); expect(source).toContain("setIncludeActions(true)");
    expect(source).toContain("allowIssuePublication: true");
    expect(source).not.toMatch(/setAllowIssuePublication|checked=\{allowIssuePublication\}|copy\.publish\b/u);
    expect(source).toContain("{copy.disclosure}");
    expect(source).toContain('!item.allowIssuePublication ? ` · ${copy.private}` : ""');
  });
  it.each(locales)("discloses eligibility rather than guaranteed delivery and labels the ten-minute attachment (%s)", locale => {
    const copy = feedbackCopy[locale];
    expect(copy.diagnostics).toContain("10"); expect(copy.diagnostics).not.toContain("30");
    expect(copy.disclosure).toContain("Astra"); expect(copy.disclosure).toContain("GitHub");
    expect(copy.disclosure).toContain(locale === "en" ? "not guaranteed" : locale === "ja-JP" ? "保証されません" : "不保證");
    expect(copy.policy.length).toBeGreaterThan(20); expect(copy.private.length).toBeGreaterThan(0);
    if (locale === "zh-HK-lihkg") expect(copy.disclosure).toBe(feedbackCopy["zh-HK"].disclosure);
  });
  it.each([true, false])("always opts new reports into review while diagnostics remain optional (%s)", async includeActions => {
    const { run, fetcher, diagnostics } = await submissionHarness(200, includeActions); await run();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(payload.allowIssuePublication).toBe(true); expect(payload.title).toBe("Synthetic feedback");
    if (includeActions) expect(payload.diagnostics).toEqual(diagnostics); else expect(payload).not.toHaveProperty("diagnostics");
  });
  it("keeps a stale policy-rejected pending payload and draft unchanged without resubmitting", async () => {
    const fixture = await submissionHarness();
    const pending: FeedbackSubmission = { clientRequestId: "40000000-0000-4000-8000-000000000002", scope: fixture.scope, title: "Historical choice", description: "Synthetic report text", kind: "bug", allowIssuePublication: false };
    const { run, bindings, fetcher } = await submissionHarness(428, true, pending); await run();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(pending);
    expect(bindings.setPending).toHaveBeenCalledExactlyOnceWith(pending); expect(bindings.setNotice).toHaveBeenLastCalledWith("policy");
    for (const setter of [bindings.resetDraft, bindings.setTitle, bindings.setDescription, bindings.setContext, bindings.clearFeedbackContext, bindings.setReceipt]) expect(setter).not.toHaveBeenCalled();
    expect(bindings.setSending).toHaveBeenLastCalledWith(false);
  });
  it("freezes retry payloads and clears content-free trails on verified account changes", async () => {
    const source = await readFile("src/components/feedback-widget.tsx", "utf8");
    expect(source).toContain("pending ?? {");
    expect(source).toContain("setPending(payload)");
    expect(source).toContain("body: JSON.stringify(payload)");
    expect(source).toContain("disabled={sending || Boolean(pending)}");
    expect(source).toMatch(/if \(verified\.current && changed\)\s*\{\s*verified\.current = null; clearFeedbackContext\(\);/u);
    expect(source).toContain("verifiedScopeKey(current.scope) !== originalScope");
  });
  it("collects static semantic action attributes but no typed values or DOM text", async () => {
    const source = await readFile("src/components/feedback-widget.tsx", "utf8");
    const listeners = source.slice(source.indexOf("const click ="), source.indexOf("window.addEventListener(\"focus\""));
    expect(listeners).toContain('getAttribute("data-feedback-action")');
    expect(listeners).not.toMatch(/(?:\.value|innerHTML|textContent|innerText|location\.href|keydown|keyup|keypress)/u);
    expect(source).not.toMatch(/(?:localStorage|sessionStorage|indexedDB|sendBeacon)/u);
  });
  it("rechecks host authorization and exact opaque scope before showing private operator responses", async () => {
    const source = await readFile("src/components/feedback-operations.tsx", "utf8");
    expect(source).toContain('fetch("/api/feedback/operator"');
    expect(source).toContain('fetch("/api/feedback/context"');
    expect(source).toContain("current.isOperator && current.scope.scopeKey === expected.scopeKey");
    expect(source).toContain("setOperator(false); setData(null)");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
