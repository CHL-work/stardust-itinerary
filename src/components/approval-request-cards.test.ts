import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalRequestCards, approvalMoney } from "@/components/approval-request-cards";
import { approvalMessages } from "@/lib/app/approval-i18n";
import type { ApprovalEventDisplay, ApprovalExpenseDisplay } from "@/lib/app/approval-presentation-types";
import type { ApprovalRequest } from "@/lib/app/types";
import { locales, messages, type Locale } from "@/lib/i18n";

const expense: ApprovalExpenseDisplay = { description: "Synthetic dinner bill", amountMinor: 101, currency: "JPY", payerName: "Synthetic payer", occurredAt: "2030-04-01T10:00:00Z", status: "posted", hasLinkedEvent: false, splits: [{ memberName: "Synthetic payer", shareMinor: 51 }, { memberName: "Former traveler", shareMinor: 50 }] };
const event: ApprovalEventDisplay = { title: "Synthetic dinner", itemType: "meal", dayDate: "2030-04-01", startsAt: "2030-04-01T10:00:00Z", endsAt: "2030-04-01T11:00:00Z", locationName: "Synthetic restaurant", mapUrl: null, departureLocationName: null, departureMapUrl: null, destinationLocationName: null, destinationMapUrl: null, notes: "A saved note", visibility: "private", audienceNames: ["Synthetic payer", "Former traveler"], isLocked: true, status: "planned", linkedExpense: expense };
const request: ApprovalRequest = { id: "synthetic-request", requestedByName: "Synthetic requester", source: "ai", entityType: "itinerary_item", entityId: null, operation: "create", baseRevision: null, patch: { internalSecret: "must never render", payerMemberId: "raw-member-id" }, reason: "Requested by traveler", status: "pending", reviewNote: null, createdAt: "2030-04-01T01:00:00Z", reviewedAt: null, proposalRevision: 2, display: { kind: "itinerary", event } };
function render(overrides: Partial<ApprovalRequest> = {}, locale: Locale = "en") {
  return renderToStaticMarkup(createElement(ApprovalRequestCards, { requests: [{ ...request, ...overrides }], locale, timeZone: "Asia/Tokyo", messages: messages[locale], busy: false, review: vi.fn() }));
}

function renderedButtons(node: ReactNode): Array<{ onClick?: () => void }> {
  if (Array.isArray(node)) return node.flatMap(renderedButtons);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return [];
  return node.type === "button" ? [node.props] : renderedButtons(node.props.children);
}

describe("readable approval cards", () => {
  it("shows a meal icon beside the localized type without replacing privacy or approval labels", () => {
    const html = render();
    expect(html).toContain('data-event-icon="meal"');
    expect(html).toContain(messages.en.eventTypeMeal);
    expect(html).toContain(messages.en.privateEvent);
    expect(html).toContain(messages.en.requestStatusPending);
  });
  it("shows a flight badge and matching takeoff/landing icons from the safe flight flag", () => {
    const html = render({ display: { kind: "itinerary", event: { ...event, itemType: "transport", isFlight: true, departureLocationName: "Airport Alpha", departureMapUrl: null, destinationLocationName: "Airport Beta", destinationMapUrl: null } } });
    expect(html).toContain('data-event-icon="flight"');
    expect(html).toContain('data-event-icon="flight-departure"');
    expect(html).toContain('data-event-icon="flight-arrival"');
    expect(html).toContain("Flight");
    expect(html).toContain("Trip time");
  });
  it("shows each flight endpoint's local date, clock and zone without exposing flight metadata", () => {
    const html = render({ display: { kind: "itinerary", event: { ...event, itemType: "transport", isFlight: true,
      startsAt: "2030-07-15T05:30:00Z", endsAt: "2030-07-15T07:30:00Z",
      departureLocationName: "Airport Alpha", destinationLocationName: "Airport Beta",
      flightPresentation: { isFlight: true, departureTimeZone: "America/Chicago", arrivalTimeZone: "America/Denver" } } } });
    expect(html).toContain("12:30 AM CDT");
    expect(html).toContain("01:30 AM MDT");
    expect(html).not.toContain("Trip time");
    expect(html).not.toContain("flightNumber");
    expect(html).toContain('dateTime="2030-07-15T05:30:00Z"');
  });
  it("labels a preceding local calendar date and retains unknown-zone fallback on historical flights", () => {
    const html = render({ display: { kind: "itinerary", event: { ...event, itemType: "transport", isFlight: true,
      startsAt: "2030-07-15T03:30:00Z", endsAt: "2030-07-15T05:30:00Z",
      departureLocationName: "DFW", destinationLocationName: "SLC" } } });
    expect(html).toContain("Jul 14, 2030, 10:30 PM CDT");
    expect(html).toContain("Jul 14, 2030, 11:30 PM MDT");
  });
  it.each(["pending", "rejected"] as const)("binds %s history actions to the exact rendered proposal version", (status) => {
    const review = vi.fn(); const current = { ...request, status, proposalRevision: 3 };
    const renderCurrent = () => ApprovalRequestCards({ requests: [current], locale: "en", messages: messages.en, busy: false, review });
    const oldButtons = renderedButtons(renderCurrent());
    expect(oldButtons).toHaveLength(status === "pending" ? 2 : 1);
    current.proposalRevision = 4;
    oldButtons.forEach((button) => button.onClick?.());
    expect(review.mock.calls).toEqual(status === "pending" ? [[request.id, "approve", 3], [request.id, "reject", 3]] : [[request.id, "approve", 3]]);
    const newButtons = renderedButtons(renderCurrent());
    newButtons[0].onClick?.();
    expect(review).toHaveBeenLastCalledWith(request.id, "approve", 4);
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("shows history but never invents a review version for %s", (proposalRevision) => {
    const html = render({ proposalRevision });
    expect(html).toContain("Synthetic dinner");
    expect(html).toContain("Proposal version: —");
    expect(html).not.toContain("<button");
    expect(render({ proposalRevision, status: "rejected" })).not.toContain("<button");
  });

  it.each(locales)("shows event, private audience and linked expense using %s labels", (locale) => {
    const html = render({}, locale); const copy = approvalMessages(locale);
    for (const text of ["Synthetic dinner", "Synthetic restaurant", "A saved note", copy.starts, copy.ends, copy.audience, copy.linkedExpense, copy.payer, "Former traveler"]) expect(html).toContain(text);
    expect(html).toContain(approvalMoney(101, "JPY", locale));
    expect(html).toContain(approvalMoney(51, "JPY", locale));
    expect(html).toContain(approvalMoney(50, "JPY", locale));
    expect(html).toContain(messages[locale].privateEvent);
    expect(html).not.toContain("<pre"); expect(html).not.toContain("must never render"); expect(html).not.toContain("raw-member-id");
  });
  it("formats event and review times in the trip timezone", () => {
    const html = render({ baseRevision: 3, reviewedAt: "2030-04-01T02:00:00Z" });
    expect(html).toContain("07:00 PM"); expect(html).toContain("11:00 AM");
    expect(html).toContain("Proposal version: 2"); expect(html).toContain("Based on revision: 3");
  });
  it("renders transport departure and arrival independently with one review action set", () => {
    const html = render({ display: { kind: "itinerary", event: { ...event, itemType: "transport", departureLocationName: "Station Alpha", departureMapUrl: null, destinationLocationName: "Station Beta", destinationMapUrl: null, linkedExpense: null } } });
    expect(html).toContain("Station Alpha"); expect(html).toContain("Station Beta");
    expect(html).toContain("Departure"); expect(html).toContain("Arrival");
    expect(html.match(/approval-transport-point"/gu)).toHaveLength(2);
    expect(html.match(/>Approve request</gu)).toHaveLength(1);
    expect(html).not.toContain("Synthetic restaurant");
  });
  it("offers pending approve/reject and rejected reapproval, never terminal review/delete controls", () => {
    expect(render()).toContain(messages.en.approveRequest); expect(render()).toContain(messages.en.rejectRequest);
    expect(render({ status: "rejected" })).toContain(messages.en.reapproveRejectedRequest);
    expect(render({ status: "rejected" })).not.toContain(messages.en.rejectRequest);
    for (const status of ["approved", "superseded"] as const) {
      const html = render({ status });
      expect(html).not.toContain(messages.en.approveRequest); expect(html).not.toContain(messages.en.rejectRequest);
      expect(html).not.toContain(messages.en.reapproveRejectedRequest); expect(html).not.toContain("<button");
      expect(html).toContain("Synthetic dinner");
    }
  });
  it.each(["pending", "rejected", "approved", "superseded"] as const)("retains %s content but hides every action after member-removal invalidation", (status) => {
    const html = render({ status, reviewBlockedReason: "member_removed" });
    expect(html).toContain("Synthetic dinner"); expect(html).toContain(approvalMessages("en").memberRemoved);
    expect(html).not.toContain("<button");
  });
  it("does not guess a card from raw JSON when safe historical detail is unavailable", () => {
    const html = render({ display: { kind: "unavailable" } });
    expect(html).toContain(approvalMessages("en").unavailable);
    expect(html).not.toContain("must never render"); expect(html).not.toContain("<pre");
    expect(html).not.toContain(messages.en.approveRequest);
    expect(html).toContain(messages.en.rejectRequest);
  });
  it("shows a standalone expense and an unavailable participant without raw IDs or hidden event titles", () => {
    const html = render({ entityType: "expense", display: { kind: "expense", expense: { ...expense, payerName: null, hasLinkedEvent: true, splits: [{ memberName: null, shareMinor: 101 }] } } });
    expect(html).toContain(approvalMessages("en").memberUnavailable); expect(html).toContain(approvalMessages("en").linkedEvent);
    expect(html).not.toContain("raw-member-id");
  });
  it("escapes notes and refuses active or credential-bearing map URLs", () => {
    const html = render({ display: { kind: "itinerary", event: { ...event, notes: "<script>not executable</script>", mapUrl: "https://secret:password@www.google.com/maps" } } });
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).not.toContain("secret:password");
    expect(html).toContain("https://www.google.com/maps/search/");
  });
  it("uses neutral financial and destructive-action text in both Cantonese modes", () => {
    expect(approvalMessages("zh-HK-lihkg")).toEqual(approvalMessages("zh-HK"));
  });
});
