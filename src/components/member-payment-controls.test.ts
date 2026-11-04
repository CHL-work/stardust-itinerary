import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MemberPayment } from "@/lib/app/member-payments";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { formatMessage, locales } from "@/lib/i18n";
import { eligiblePaymentMember, MemberPaymentCard, MemberPaymentDecisionForm, MemberPaymentForm, MemberPaymentHistory, type PaymentDraft } from "./member-payment-controls";

const members = [{ id: "a", displayName: "Sender", status: "active" }, { id: "b", displayName: "Invited recipient", status: "invited" },
  { id: "c", displayName: "Disabled member", status: "revoked" }, { id: "d", displayName: "Removed member", status: "removed" }];
const draft: PaymentDraft = { fromMemberId: "a", toMemberId: "b", amount: "10.25", currency: "HKD", occurredAt: "2035-04-01T09:00", note: "", confirmation: false };
const payment: MemberPayment = { id: "payment-a", fromMemberId: "a", toMemberId: "b", fromMemberName: "Original sender", toMemberName: "Original recipient",
  accountingFromMemberId: "a", accountingToMemberId: "b", accountingFromMemberName: "Original sender", accountingToMemberName: "Original recipient",
  amountMinor: 1025, currency: "HKD", occurredAt: "2035-04-01T00:00:00Z", note: null, status: "pending", revision: 1,
  createdByMemberId: "a", createdAt: "2035-04-01T00:00:00Z", canReview: true, canVoid: true };
const formProps = { draft, members, isOwner: false, locale: "en" as const, timeZone: "Asia/Tokyo", busy: false, locked: false, error: null, change: vi.fn(), submit: vi.fn(), close: vi.fn() };
const historyProps = { payments: [payment], locale: "en" as const, timeZone: "Asia/Tokyo", busy: false, isOwner: true, act: vi.fn() };
const cardProps = { payment, locale: "en" as const, timeZone: "Asia/Tokyo", busy: false, isOwner: true, act: vi.fn() };
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

describe("repayment entry and history presentation", () => {
  it.each(locales)("uses selected language and explicit no-transfer confirmation in %s", (locale) => {
    const copy = memberPaymentMessages(locale);
    const html = renderToStaticMarkup(createElement(MemberPaymentForm, { ...formProps, locale }));
    expect(html).toContain(copy.explanation); expect(html).toContain(copy.confirm); expect(html).toContain(copy.partial);
    expect(html).toContain("Asia/Tokyo"); expect(html).toContain('type="checkbox"'); expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
    expect(html).toMatch(/<input required="" type="datetime-local" value="2035-04-01T09:00"/);
  });
  it("keeps financial Cantonese neutral and identical in both tones", () => {
    expect(memberPaymentMessages("zh-HK-lihkg")).toEqual(memberPaymentMessages("zh-HK"));
  });
  it("locks nonowner sender, allows invited recipients, and excludes disabled/removed members", () => {
    expect(members.filter(eligiblePaymentMember).map((member) => member.id)).toEqual(["a", "b"]);
    const html = renderToStaticMarkup(createElement(MemberPaymentForm, formProps));
    expect(html).toContain('<select required="" disabled="">'); expect(html).toContain("Invited recipient");
    expect(html).not.toContain("Disabled member"); expect(html).not.toContain("Removed member");
    const owner = renderToStaticMarkup(createElement(MemberPaymentForm, { ...formProps, isOwner: true }));
    expect(owner).not.toContain('<select required="" disabled="">');
  });
  it("freezes uncertain data while permitting an explicit identical confirmed retry", () => {
    const html = renderToStaticMarkup(createElement(MemberPaymentForm, { ...formProps, draft: { ...draft, confirmation: true }, locked: true, error: "Synthetic retained error" }));
    expect(html).toContain('<fieldset disabled="">'); expect(html).toContain("Synthetic retained error");
    expect(html).toMatch(/<button type="submit"[^>]*>Retry same record<\/button>/);
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled/);
  });
  it("warns on overpayment without capping it or requiring a suggestion", () => {
    const above = { ...draft, amount: "10.25", suggestion: { fromMemberId: "a", toMemberId: "b", currency: "HKD", amountMinor: 1000 } };
    const html = renderToStaticMarkup(createElement(MemberPaymentForm, { ...formProps, draft: above }));
    expect(html).toContain(memberPaymentMessages("en").aboveSuggestion); expect(html).toContain('value="10.25"');
    expect(renderToStaticMarkup(createElement(MemberPaymentForm, formProps))).not.toContain(memberPaymentMessages("en").aboveSuggestion);
    expect(renderToStaticMarkup(createElement(MemberPaymentForm, { ...formProps, draft: { ...above, currency: "JPY" } }))).not.toContain(memberPaymentMessages("en").aboveSuggestion);
  });
  it("collapses ordinary history with count/pending count but keeps owner review expanded", () => {
    const html = renderToStaticMarkup(createElement(MemberPaymentHistory, historyProps));
    expect(html).toMatch(/^<details/); expect(html).not.toContain('<details open'); expect(html).toContain("1 records · 1 awaiting approval");
    const review = renderToStaticMarkup(createElement(MemberPaymentHistory, { ...historyProps, reviewOnly: true }));
    expect(review).toMatch(/^<section/); expect(review).toContain("Repayment approvals");
  });
  it.each(locales)("renders a clearly labelled standalone repayment without a history wrapper in %s", (locale) => {
    const copy = memberPaymentMessages(locale);
    const html = renderToStaticMarkup(createElement(MemberPaymentCard, { ...cardProps, locale }));
    expect(html).toMatch(/^<article/); expect(html).toContain(`aria-label="${copy.repayment}"`);
    expect(html).toContain(`>${copy.repayment}</p>`); expect(html).toContain("Original sender"); expect(html).toContain("Original recipient");
    expect(html).toContain("10.25"); expect(html).toContain("HKD"); expect(html).toContain(copy.pending);
    expect(html).not.toContain("<details"); expect(html).not.toContain("<section"); expect(html).not.toContain(copy.history);
    expect(formatMessage(copy.dayCount, { count: 2 })).toContain("2");
    expect(formatMessage(copy.dayCount, { count: 2 })).not.toMatch(/[{}]/);
  });
  it.each(locales)("keeps every status and exact projected payment action localised in %s", (locale) => {
    const copy = memberPaymentMessages(locale);
    for (const status of ["pending", "rejected", "posted", "void"] as const) {
      const act = vi.fn(); const row = { ...payment, status };
      const rendered = MemberPaymentCard({ ...cardProps, locale, payment: row, act });
      const buttons = elements(rendered).filter((element) => element.type === "button");
      const actions = [
        ...(status === "pending" || status === "rejected" ? ["approve"] as const : []),
        ...(status === "pending" ? ["reject"] as const : []),
        ...(status !== "void" ? ["void"] as const : []),
      ];
      expect(buttons.map((button) => button.props.children)).toEqual(actions.map((action) => copy[action]));
      for (const button of buttons) {
        expect(button.props.type).toBe("button"); expect(button.props.disabled).toBe(false);
        (button.props.onClick as () => void)();
      }
      expect(act.mock.calls.map((call) => call[1])).toEqual(actions);
      for (const call of act.mock.calls) expect(call[0]).toBe(row);
      const html = renderToStaticMarkup(rendered);
      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain(status === "void" ? copy.voidStatus : copy[status]);
      expect(html.includes(copy.pendingHelp)).toBe(status === "pending" || status === "rejected");
      expect(html.includes(copy.voidedHelp)).toBe(status === "void");
    }
  });
  it("keeps standalone review and reversal buttons disabled while another save is in flight", () => {
    const act = vi.fn();
    const rendered = MemberPaymentCard({ ...cardProps, busy: true, act });
    const buttons = elements(rendered).filter((element) => element.type === "button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button.props.disabled).toBe(true);
    expect(act).not.toHaveBeenCalled();
  });
  it("reuses the standalone card without changing review-only filtering or historical order", () => {
    const older = { ...payment, id: "older", occurredAt: "2035-03-30T23:00:00Z", status: "rejected" as const };
    const posted = { ...payment, id: "posted", status: "posted" as const };
    const voided = { ...payment, id: "voided", status: "void" as const };
    const payments = [older, posted, payment, voided];
    const cards = elements(MemberPaymentHistory({ ...historyProps, payments, reviewOnly: true }))
      .filter((element) => element.type === MemberPaymentCard);
    expect(cards.map((card) => card.props.payment)).toEqual([payment, older]);
    for (const card of cards) {
      expect(card.props.act).toBe(historyProps.act); expect(card.props.timeZone).toBe("Asia/Tokyo");
      expect(card.props.isOwner).toBe(true); expect(card.props.busy).toBe(false);
    }
    expect(payments).toEqual([older, posted, payment, voided]);
    const all = elements(MemberPaymentHistory({ ...historyProps, payments }))
      .filter((element) => element.type === MemberPaymentCard);
    expect(all.map((card) => (card.props.payment as MemberPayment).id)).toEqual(["payment-a", "posted", "voided", "older"]);
  });
  it("does not expose owner review to members or unsupported reversal capability", () => {
    const html = renderToStaticMarkup(createElement(MemberPaymentHistory, { ...historyProps, isOwner: false, payments: [{ ...payment, canVoid: false }] }));
    expect(html).not.toContain("<button"); expect(html).toContain("Awaiting approval"); expect(html).toContain("Not included in balances until approved.");
    const ownerWithoutCapability = renderToStaticMarkup(createElement(MemberPaymentCard, { ...cardProps, payment: { ...payment, canReview: false, canVoid: false } }));
    expect(ownerWithoutCapability).not.toContain("<button"); expect(ownerWithoutCapability).toContain("Original sender");
    const memberWithdrawal = renderToStaticMarkup(createElement(MemberPaymentCard, { ...cardProps, isOwner: false }));
    expect(memberWithdrawal).toContain("Void record"); expect(memberWithdrawal).not.toContain(">Approve<"); expect(memberWithdrawal).not.toContain(">Reject<");
  });
  it("preserves original payment facts when removal reassigns bookkeeping and escapes notes", () => {
    const html = renderToStaticMarkup(createElement(MemberPaymentHistory, { ...historyProps, payments: [{ ...payment, accountingFromMemberId: "new", accountingFromMemberName: "New assignee", note: "<script> & note" }] }));
    expect(html).toContain("Original sender"); expect(html).toContain("New assignee"); expect(html).toContain("Original payment details above are retained.");
    expect(html).toContain("&lt;script&gt; &amp; note"); expect(html).not.toContain("<script>"); expect(html).toContain("9:00 AM");
  });
  it("requires a reason for rejection/void and distinguishes void from refund", () => {
    for (const action of ["approve", "reject", "void"] as const) {
      const html = renderToStaticMarkup(createElement(MemberPaymentDecisionForm, { ...formProps, decision: { payment, action, reason: "", confirmation: false }, change: vi.fn() }));
      expect(html.includes('<textarea required=""')).toBe(action !== "approve");
      expect(html).toContain('maxLength="500"');
      if (action === "void") expect(html).toContain("It does not refund or move money.");
    }
  });
  it("keeps controls and amounts readable on small screens", () => {
    const css = readFileSync("src/components/member-payment-controls.module.css", "utf8");
    expect(css).toContain("font-size: 16px"); expect(css).toContain("min-height: 44px");
    expect(css).toContain("overflow-wrap: anywhere"); expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
    expect(css).toMatch(/\.history summary, \.card summary\s*\{\s*min-height: 44px/);
  });
});
