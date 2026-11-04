import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemberRemovalReview, MemberRoleControl } from "@/components/member-management-controls";
import { memberManagementMessages } from "@/lib/app/member-management-i18n";
import type { MemberRemovalPreview } from "@/lib/app/member-removal";
import { locales, type Locale } from "@/lib/i18n";

const preview: MemberRemovalPreview = {
  member: { id: "synthetic-target", displayName: "Synthetic traveler", role: "editor", status: "active", revision: 4 }, previewDigest: "a".repeat(64),
  canRemove: false, canRemoveWithReassignment: true, blockedReason: "financial_links",
  counts: { createdEvents: 2, viewerLinks: 1, expenses: 1, actionableProposals: 3, aiRequests: 7, aiConversations: 2, reusableInvites: 2 },
  expenses: [{ id: "synthetic-expense", revision: 8, currency: "JPY", amountMinor: 101, paidByTarget: true, shareMinor: 51, description: "Synthetic lunch", requiresPayerReplacement: true, requiresShareRecipient: true,
    eligibleMembers: [{ id: "synthetic-recipient", displayName: "Synthetic recipient" }] }], hiddenPrivateExpenseCount: 0,
};
function renderRemoval(overrides: Partial<MemberRemovalPreview> = {}, locale: Locale = "en") {
  return renderToStaticMarkup(createElement(MemberRemovalReview, { preview: { ...preview, ...overrides }, locale, busy: false, submit: vi.fn(), cancel: vi.fn() }));
}

describe("member removal preview UI", () => {
  it.each(locales)("renders readable impact, retained records and explicit financial controls in %s", (locale) => {
    const html = renderRemoval({}, locale); const copy = memberManagementMessages(locale);
    for (const text of [copy.retained, copy.createdEvents, copy.viewerLinks, copy.aiRequests, copy.aiConversations, copy.reusableInvites, copy.inviteWarning, copy.financial, copy.payerReplacement, copy.shareRecipient, "Synthetic lunch", "Synthetic recipient"]) expect(html).toContain(text.replaceAll("'", "&#x27;"));
    expect(html.match(/<option value="" selected=""/gu)).toHaveLength(2);
    expect(html).not.toContain("<pre"); expect(html).not.toContain("checked=\"\"");
    expect(html).toContain("disabled=\"\">" + copy.removeConfirm);
  });
  it("formats yen minor amounts without dividing them by 100", () => {
    const html = renderRemoval(); expect(html).toContain("¥101"); expect(html).toContain("¥51");
  });
  it("shows private financial blockers without inventing expense content", () => {
    const html = renderRemoval({ expenses: [], hiddenPrivateExpenseCount: 2, canRemoveWithReassignment: false });
    expect(html).toContain("2 private expense(s)"); expect(html).not.toContain("Synthetic lunch");
    expect(html).not.toContain("<select"); expect(html).toContain("disabled=\"\">Remove member");
  });
  it("shows last-owner and empty-candidate blockers", () => {
    expect(renderRemoval({ blockedReason: "last_bound_owner", canRemoveWithReassignment: false })).toContain(memberManagementMessages("en").lastOwner);
    expect(renderRemoval({ expenses: [{ ...preview.expenses[0], eligibleMembers: [] }], canRemoveWithReassignment: false })).toContain(memberManagementMessages("en").noEligible);
  });
  it("uses neutral wording for financial and destructive actions in both Cantonese modes", () => {
    expect(memberManagementMessages("zh-HK-lihkg")).toEqual(memberManagementMessages("zh-HK"));
  });
  it.each(locales)("explains original cash facts, bookkeeping choices and permanent invalidation in %s", (locale) => {
    const copy = memberManagementMessages(locale);
    const html = renderRemoval({ expenses: [], counts: { ...preview.counts, payments: 1, pendingPayments: 2 }, payments: [{
      id: "repayment", revision: 3, currency: "JPY", amountMinor: 201, fromMemberName: "Actual sender", toMemberName: "Actual recipient",
      accountingFromMemberId: "synthetic-target", accountingToMemberId: "another", accountingFromMemberName: "Departing accounting member", accountingToMemberName: "Other accounting member",
      requiresFromReplacement: true, requiresToReplacement: false, eligibleMembers: [{ id: "another", displayName: "Remaining member" }],
    }] }, locale);
    for (const text of [copy.paymentFinancial, copy.paymentOriginal, copy.paymentAccounting, copy.paymentFromReplacement, copy.pendingPaymentWarning,
      copy.payments, copy.pendingPayments, "Actual sender", "Actual recipient", "Remaining member"]) expect(html).toContain(text.replaceAll("'", "&#x27;"));
    expect(html.match(/<option value="" selected=""/gu)).toHaveLength(1);
    expect(html).not.toContain("<pre"); expect(html).not.toContain("checked=\"\"");
    expect(html).toContain("disabled=\"\">" + copy.removeConfirm);
  });
});

describe("member role UI", () => {
  it.each(locales)("provides all three localized roles and starts without an actionable change in %s", (locale) => {
    const html = renderToStaticMarkup(createElement(MemberRoleControl, { member: { id: "member", role: "editor", status: "active", identityBound: true, currentRevision: 3 }, locale, busy: false, save: vi.fn() }));
    const copy = memberManagementMessages(locale);
    for (const text of [copy.owner, copy.editor, copy.viewer, copy.saveRole]) expect(html).toContain(text);
    expect(html).toContain("disabled=\"\">" + copy.saveRole);
  });
  it("disables promoting an unbound invitation to owner", () => {
    const html = renderToStaticMarkup(createElement(MemberRoleControl, { member: { id: "member", role: "editor", status: "invited", identityBound: false, currentRevision: 3 }, locale: "en", busy: false, save: vi.fn() }));
    expect(html).toContain('<option value="owner" disabled="">Owner</option>');
  });
});

describe("AppShell member mutation wiring", () => {
  const source = readFileSync("src/components/app-shell.tsx", "utf8");
  it("only opens a read-only preview before removal, and sends confirmation JSON on DELETE", () => {
    const open = source.slice(source.indexOf("const previewMemberRemoval"), source.indexOf("const confirmMemberRemoval"));
    expect(open).toContain('cache: "no-store"'); expect(open).not.toContain('method: "DELETE"');
    const confirm = source.slice(source.indexOf("const confirmMemberRemoval"), source.indexOf("const saveProfileName"));
    expect(confirm).toContain('method: "DELETE", body: JSON.stringify(input)');
    expect(confirm).toContain("memberRemoval.scope !== memberAdminScope");
    expect(confirm).toContain("preview: null"); expect(confirm).toContain("error.status === 409");
    expect(confirm).not.toContain("previewMemberRemoval(");
  });
  it("fences late private previews and signs out self-removed membership", () => {
    expect(source).toContain("requestId !== memberRemovalRequestId.current || scope !== memberAdminScopeRef.current");
    expect(source).toContain("snapshot.member.id === overview.session.memberId");
    expect(source).toContain("key={memberRemoval.preview.previewDigest}");
  });
  it("binds role edits to a revision and separates them from permission toggles", () => {
    expect(source).toContain("JSON.stringify({ role, expectedRevision: member.currentRevision })");
    expect(source).toContain("save={(role) => updateMemberRole(member, role)}");
  });
  it("routes every member to self-service creation and never selects an already-selected created trip", () => {
    expect(source).toContain("router.push(`/trips/new?locale=${encodeURIComponent(locale)}`)");
    expect(source).not.toContain("const createAndSwitchTrip");
    expect(source).not.toContain("newTripDraft");
    const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const cards: ts.JsxElement[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "article"
        && node.children.some((child) => ts.isJsxElement(child) && child.openingElement.tagName.getText(tree) === "h2"
          && child.children.some((label) => ts.isJsxExpression(label) && label.expression?.getText(tree) === "messages.switchTripTitle"))) cards.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.getText(tree)).toContain("onClick={openNewTrip}"); expect(card.getText(tree)).not.toContain("session.isOwner");
    for (let ancestor = card.parent; ancestor; ancestor = ancestor.parent) {
      if (ts.isConditionalExpression(ancestor)) expect(ancestor.condition.getText(tree)).not.toContain("session.isOwner");
      if (ts.isBinaryExpression(ancestor) && ancestor.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        expect(ancestor.left.getText(tree)).not.toContain("session.isOwner");
      }
    }
  });
});
