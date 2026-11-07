import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AI_PROMPT_MAX_CHARACTERS,
  aiProposalOutcomeMessage,
  aiRequestFailureMessage,
  aiLogExecutionLabel,
  ApprovalHistoryPanel,
  ApprovalReviewContent,
  ApprovalRequestList,
  canEditPendingEvent,
  JsonRequestError,
  maximumTripEndDate,
  mergeApprovalHistory,
  NextEventHeader,
  PendingExpenseList,
  PendingItineraryList,
  pendingUpdateTargetIds,
  TimelineList,
  tripEndDateIsWithinBounds,
} from "@/components/app-shell";
import type { ApprovalRequest, PendingExpenseProjection, PendingItineraryProjection } from "@/lib/app/types";
import type { MemberPayment } from "@/lib/app/member-payments";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { projectTimelinePoints } from "@/lib/app/timeline";
import { messages, locales } from "@/lib/i18n";
import { mobileCardsMessages } from "@/lib/app/mobile-cards-i18n";
import { readFileSync } from "node:fs";

function renderedButtons(node: ReactNode): Array<{ onClick?: () => void; disabled?: boolean }> {
  if (Array.isArray(node)) return node.flatMap(renderedButtons);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return [];
  return node.type === "button" ? [node.props] : renderedButtons(node.props.children);
}

const pendingEvent: PendingItineraryProjection = {
  requestId: "request-1",
  status: "pending",
  operation: "create",
  targetItemId: null,
  createdByMemberId: "member-1",
  requestedByMemberId: "member-1",
  requestedByName: "Traveler",
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
  proposalRevision: 1,
  tripDayId: "day-1",
  title: "Pending dinner",
  itemType: "meal",
  startsAt: "2026-09-01T13:00:00.000Z",
  endsAt: "2026-09-01T14:00:00.000Z",
  locationName: "Tokyo Station",
  mapUrl: null,
  departureLocationName: null,
  departureMapUrl: null,
  destinationLocationName: null,
  destinationMapUrl: null,
  flight: null,
  notes: "Waiting for approval",
  visibility: "trip",
  viewerMemberIds: [],
};

describe("AI pending edit feedback", () => {
  it.each([
    ["en", "Awaiting owner approval."],
    ["zh-HK", "等待管理員審批。"],
    ["zh-HK-lihkg", "等待管理員審批。"],
    ["ja-JP", "オーナーの承認待ちです。"],
  ] as const)("uses pending-state feedback without claiming a duplicate create in %s", (locale, expected) => {
    expect(aiProposalOutcomeMessage({ proposalCount: 1, proposalIds: ["existing-pending-request"],
      proposalId: "existing-pending-request", changeStatus: "pending" }, messages[locale])).toBe(expected);
  });
});

describe("canEditPendingEvent", () => {
  const canEditItinerary = { canEditItinerary: true };

  it("allows an owner or editor to edit an audience-visible pending event", () => {
    expect(canEditPendingEvent(pendingEvent, { memberId: "member-1", isOwner: false, role: "editor" }, canEditItinerary)).toBe(true);
    expect(canEditPendingEvent(pendingEvent, { memberId: "owner-1", isOwner: true, role: "owner" }, canEditItinerary)).toBe(true);
    expect(canEditPendingEvent(pendingEvent, { memberId: "member-2", isOwner: false, role: "editor" }, canEditItinerary)).toBe(true);
    expect(canEditPendingEvent(pendingEvent, { memberId: "viewer-1", isOwner: false, role: "viewer" }, canEditItinerary)).toBe(false);
  });

  it("hides editing when itinerary editing is disabled", () => {
    expect(canEditPendingEvent(
      pendingEvent,
      { memberId: "member-1", isOwner: false, role: "editor" },
      { canEditItinerary: false },
    )).toBe(false);
  });

  it("keeps pending cancel and restore requests read-only for editors", () => {
    for (const operation of ["cancel", "restore"] as const) {
      expect(canEditPendingEvent(
        { ...pendingEvent, operation },
        { memberId: "member-1", isOwner: false, role: "editor" },
        canEditItinerary,
      )).toBe(false);
    }
  });
});

describe("pendingUpdateTargetIds", () => {
  it("hides only canonical rows replaced by a visible pending update", () => {
    expect([...pendingUpdateTargetIds([
      pendingEvent,
      { ...pendingEvent, requestId: "request-2", operation: "update", targetItemId: "item-1" },
      { ...pendingEvent, requestId: "request-3", operation: "cancel", targetItemId: "item-2" },
      { ...pendingEvent, requestId: "request-4", operation: "restore", targetItemId: "item-3" },
      { ...pendingEvent, requestId: "request-5", operation: "update", targetItemId: null },
    ])]).toEqual(["item-1", "item-2", "item-3"]);
  });
});

function renderPendingList(ownerControls = false) {
  return renderToStaticMarkup(createElement(PendingItineraryList, {
    points: projectTimelinePoints([{ ...pendingEvent, id: pendingEvent.requestId }], {
      tripDays: [{ id: "day-1", date: "2026-09-01" }],
      timeZone: "Asia/Tokyo",
    }),
    locale: "en",
    messages: messages.en,
    timeZone: "Asia/Tokyo",
    busy: false,
    edit: ownerControls ? vi.fn() : undefined,
    canEdit: ownerControls ? () => true : undefined,
    approve: ownerControls ? vi.fn() : undefined,
    reject: ownerControls ? vi.fn() : undefined,
  }));
}

describe("PendingItineraryList", () => {
  it.each(locales.flatMap((locale) => (["create", "update"] as const).map((operation) => [locale, operation] as const)))(
    "keeps short ordered owner/editor actions and stable loading labels in %s for %s", (locale, operation) => {
      const copy = mobileCardsMessages(locale);
      const expectedLabels = locale === "en" ? ["Edit", "Approve", "Reject"]
        : locale === "ja-JP" ? ["編集", "承認", "却下"] : ["編輯", "批准", "拒絕"];
      expect([copy.editShort, copy.approveShort, copy.rejectShort]).toEqual(expectedLabels);
      for (const owner of [false, true]) {
        for (const opening of [false, true]) {
          const request = { ...pendingEvent, id: pendingEvent.requestId, operation, targetItemId: operation === "update" ? "item-1" : null };
          const edit = vi.fn(); const approve = vi.fn(); const reject = vi.fn();
          const node = PendingItineraryList({
            points: projectTimelinePoints([request], { tripDays: [{ id: "day-1", date: "2026-09-01" }], timeZone: "Asia/Tokyo" }),
            locale, messages: messages[locale], timeZone: "Asia/Tokyo", busy: false,
            edit, canEdit: () => true, approve: owner ? approve : undefined, reject: owner ? reject : undefined,
            editingRequestId: opening ? request.requestId : undefined,
          });
          const markup = renderToStaticMarkup(node);
          const labels = Array.from(markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/gsu), (match) => match[1]);
          expect(labels).toEqual(owner ? expectedLabels : expectedLabels.slice(0, 1));
          expect(markup).toContain('class="card-actions pending-review-actions"');
          expect(renderedButtons(node).map((button) => button.disabled)).toEqual(Array(owner ? 3 : 1).fill(opening));
          if (opening) expect(markup).toContain('aria-busy="true"');
          expect(markup).not.toContain(messages[locale].loadingPendingEvent);
          expect(edit).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
        }
      }
    },
  );

  it("uses a single-row grid with equal columns and no text wrapping for the short pending actions", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.pending-timeline-row > \.pending-review-actions\s*\{[^}]*display:\s*grid;[^}]*grid-auto-flow:\s*column;[^}]*grid-auto-columns:\s*minmax\(0,\s*1fr\);/u);
    expect(css).toMatch(/\.pending-timeline-row > \.pending-review-actions > button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*44px;[^}]*padding:\s*8px 4px;[^}]*font-size:\s*13px;[^}]*white-space:\s*nowrap;/u);
  });

  it.each([false, true])("binds both review decisions to the rendered version (overview fallback %s)", (allowActionFallback) => {
    const approve = vi.fn(); const reject = vi.fn();
    const points = projectTimelinePoints([{ ...pendingEvent, id: pendingEvent.requestId, proposalRevision: 3 }], {
      tripDays: [{ id: "day-1", date: "2026-09-01" }], timeZone: "Asia/Tokyo",
    });
    const render = () => PendingItineraryList({ points, locale: "en", messages: messages.en, timeZone: "Asia/Tokyo", busy: false, allowActionFallback, approve, reject });
    const oldButtons = renderedButtons(render());
    expect(oldButtons).toHaveLength(2);
    points[0].item.proposalRevision = 4;
    oldButtons[0].onClick?.(); oldButtons[1].onClick?.();
    expect(approve).toHaveBeenLastCalledWith(pendingEvent.requestId, 3);
    expect(reject).toHaveBeenLastCalledWith(pendingEvent.requestId, 3);
    const newButtons = renderedButtons(render());
    newButtons[0].onClick?.(); newButtons[1].onClick?.();
    expect(approve).toHaveBeenLastCalledWith(pendingEvent.requestId, 4);
    expect(reject).toHaveBeenLastCalledWith(pendingEvent.requestId, 4);
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("does not review a missing or invalid rendered event revision %s", (proposalRevision) => {
    const approve = vi.fn(); const reject = vi.fn();
    const points = projectTimelinePoints([{ ...pendingEvent, id: pendingEvent.requestId, proposalRevision: proposalRevision as number }], {
      tripDays: [{ id: "day-1", date: "2026-09-01" }], timeZone: "Asia/Tokyo",
    });
    const buttons = renderedButtons(PendingItineraryList({ points, locale: "en", messages: messages.en, timeZone: "Asia/Tokyo", busy: false, approve, reject }));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) { expect(button.disabled).toBe(true); button.onClick?.(); }
    expect(approve).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
  });

  it("shows a pending event to a member without exposing approval controls", () => {
    const markup = renderPendingList();

    expect(markup).toContain("Pending dinner");
    expect(markup).toContain(messages.en.pendingOwnerApproval);
    expect(markup).not.toContain(mobileCardsMessages("en").approveShort);
    expect(markup).not.toContain(mobileCardsMessages("en").rejectShort);
  });

  it("shows the same pending event with approve and reject controls to an owner", () => {
    const markup = renderPendingList(true);

    expect(markup).toContain("Pending dinner");
    expect(markup).toContain(messages.en.pendingOwnerApproval);
    expect(markup).toContain(mobileCardsMessages("en").editShort);
    expect(markup).toContain(mobileCardsMessages("en").approveShort);
    expect(markup).toContain(mobileCardsMessages("en").rejectShort);
  });

  it("lets the requester edit a pending event without exposing owner controls", () => {
    const markup = renderToStaticMarkup(createElement(PendingItineraryList, {
      points: projectTimelinePoints([{ ...pendingEvent, id: pendingEvent.requestId }], {
        tripDays: [{ id: "day-1", date: "2026-09-01" }],
        timeZone: "Asia/Tokyo",
      }),
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      busy: false,
      edit: vi.fn(),
      canEdit: (request: PendingItineraryProjection) => request.requestedByMemberId === "member-1",
    }));

    expect(markup).toContain(mobileCardsMessages("en").editShort);
    expect(markup).not.toContain(mobileCardsMessages("en").approveShort);
    expect(markup).not.toContain(mobileCardsMessages("en").rejectShort);
  });

  it("lets another authorized editor open a trip-visible pending event", () => {
    const markup = renderToStaticMarkup(createElement(PendingItineraryList, {
      points: projectTimelinePoints([{ ...pendingEvent, id: pendingEvent.requestId }], {
        tripDays: [{ id: "day-1", date: "2026-09-01" }],
        timeZone: "Asia/Tokyo",
      }),
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      busy: false,
      edit: vi.fn(),
      canEdit: () => true,
    }));

    expect(markup).toContain("Pending dinner");
    expect(markup).toContain(messages.en.pendingOwnerApproval);
    expect(markup).toContain(mobileCardsMessages("en").editShort);
    expect(markup).not.toContain(mobileCardsMessages("en").approveShort);
    expect(markup).not.toContain(mobileCardsMessages("en").rejectShort);
  });

  it("lets a selected editor open a private pending event without owner controls", () => {
    const privatePendingEvent = {
      ...pendingEvent,
      visibility: "private" as const,
      viewerMemberIds: ["member-2"],
      title: "Private JoJo event",
    };
    const markup = renderToStaticMarkup(createElement(PendingItineraryList, {
      points: projectTimelinePoints([{ ...privatePendingEvent, id: privatePendingEvent.requestId }], {
        tripDays: [{ id: "day-1", date: "2026-09-01" }],
        timeZone: "Asia/Tokyo",
      }),
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      busy: false,
      edit: vi.fn(),
      canEdit: () => true,
    }));

    expect(markup).toContain("Private JoJo event");
    expect(markup).toContain(messages.en.privateEvent);
    expect(markup).toContain(mobileCardsMessages("en").editShort);
    expect(markup).not.toContain(mobileCardsMessages("en").approveShort);
    expect(markup).not.toContain(mobileCardsMessages("en").rejectShort);
  });

  it("distinguishes a proposed update from a not-yet-created event", () => {
    const markup = renderToStaticMarkup(createElement(PendingItineraryList, {
      points: projectTimelinePoints([{
        ...pendingEvent,
        id: pendingEvent.requestId,
        operation: "update" as const,
        targetItemId: "item-1",
      }], {
        tripDays: [{ id: "day-1", date: "2026-09-01" }],
        timeZone: "Asia/Tokyo",
      }),
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      busy: false,
      edit: vi.fn(),
      canEdit: () => true,
    }));

    expect(markup).toContain(messages.en.pendingEventUpdate);
    expect(markup).toContain(messages.en.pendingEventUpdateNotApplied);
    expect(markup).not.toContain(messages.en.pendingEventNotConfirmed);
  });

  it("shows a pending cancellation as a reviewed change without an edit action", () => {
    const markup = renderToStaticMarkup(createElement(PendingItineraryList, {
      points: projectTimelinePoints([{
        ...pendingEvent,
        id: pendingEvent.requestId,
        operation: "cancel" as const,
        targetItemId: "item-1",
      }], {
        tripDays: [{ id: "day-1", date: "2026-09-01" }],
        timeZone: "Asia/Tokyo",
      }),
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      busy: false,
      edit: vi.fn(),
      canEdit: () => false,
      approve: vi.fn(),
      reject: vi.fn(),
    }));

    expect(markup).toContain(messages.en.cancelEvent);
    expect(markup).toContain(messages.en.pendingOwnerApproval);
    expect(markup).toContain(messages.en.pendingEventUpdateNotApplied);
    expect(markup).toContain(mobileCardsMessages("en").approveShort);
    expect(markup).toContain(mobileCardsMessages("en").rejectShort);
    expect(markup).not.toContain(mobileCardsMessages("en").editShort);
  });

  it("keeps the short localized edit label stable while exposing busy state", () => {
    const markup = renderToStaticMarkup(createElement(PendingItineraryList, {
      points: projectTimelinePoints([{ ...pendingEvent, id: pendingEvent.requestId }], {
        tripDays: [{ id: "day-1", date: "2026-09-01" }],
        timeZone: "Asia/Tokyo",
      }),
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      busy: false,
      edit: vi.fn(),
      canEdit: () => true,
      editingRequestId: pendingEvent.requestId,
    }));

    expect(markup).toContain(mobileCardsMessages("en").editShort);
    expect(markup).not.toContain(messages.en.loadingPendingEvent);
    expect(markup).toContain('aria-busy="true"');
  });

  it("shows both named endpoints and times for a pending transport event", () => {
    const transport = {
      ...pendingEvent,
      id: pendingEvent.requestId,
      itemType: "transport" as const,
      locationName: null,
      mapUrl: null,
      startsAt: "2026-09-01T14:00:00.000Z",
      endsAt: "2026-09-01T16:00:00.000Z",
      departureLocationName: "Haneda Airport",
      departureMapUrl: "https://www.google.com/maps/place/Haneda+Airport",
      destinationLocationName: "Tokyo Station",
      destinationMapUrl: "https://www.google.com/maps/place/Tokyo+Station",
    };
    const markup = renderToStaticMarkup(createElement(PendingItineraryList, {
      points: projectTimelinePoints([transport], {
        tripDays: [
          { id: "day-1", date: "2026-09-01" },
          { id: "day-2", date: "2026-09-02" },
        ],
        timeZone: "Asia/Tokyo",
      }),
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      busy: false,
      edit: vi.fn(),
      canEdit: () => true,
      approve: vi.fn(),
      reject: vi.fn(),
    }));

    expect(markup.match(/data-pending-timeline-point="departure"/g)).toHaveLength(1);
    expect(markup.match(/data-pending-timeline-point="arrival"/g)).toHaveLength(1);
    expect(markup).toContain("Haneda Airport");
    expect(markup).toContain("Tokyo Station");
    expect(markup).toContain(messages.en.departureLabel);
    expect(markup).toContain(messages.en.destinationLabel);
    expect(markup).toContain("Sep 1");
    expect(markup).toContain("Sep 2");
    expect(markup.split(mobileCardsMessages("en").editShort)).toHaveLength(2);
    expect(markup.split(mobileCardsMessages("en").approveShort)).toHaveLength(2);
    expect(markup.split(mobileCardsMessages("en").rejectShort)).toHaveLength(2);
  });
});

describe("PendingExpenseList", () => {
  const pendingExpense: PendingExpenseProjection = {
    requestId: "expense-request-1",
    proposalRevision: 1,
    status: "pending",
    requestedByMemberId: "member-1",
    requestedByName: "Traveler",
    createdAt: "2026-09-01T12:00:00.000Z",
    description: "AI ramen dinner",
    amountMinor: 3000,
    currency: "JPY",
    payerMemberId: "member-1",
    payerName: "Traveler",
    itineraryItemId: null,
    itineraryItemTitle: null,
    occurredAt: "2026-09-01T13:00:00.000Z",
    splits: [{ memberId: "member-1", memberName: "Traveler", shareMinor: 3000 }],
  };

  const renderPendingExpense = (isOwner: boolean) => renderToStaticMarkup(createElement(PendingExpenseList, {
    expenses: [pendingExpense],
    locale: "en",
    messages: messages.en,
    timeZone: "Asia/Tokyo",
    busy: false,
    isOwner,
    review: vi.fn(),
  }));

  it("shows involved members a pending expense outside canonical totals", () => {
    const markup = renderPendingExpense(false);
    expect(markup).toContain("AI ramen dinner");
    expect(markup).toContain(messages.en.pendingExpenseNotIncluded);
    expect(markup).not.toContain(messages.en.approveRequest);
    expect(markup).not.toContain(messages.en.rejectRequest);
  });

  it("gives only the owner approval controls", () => {
    const markup = renderPendingExpense(true);
    expect(markup).toContain(messages.en.approveRequest);
    expect(markup).toContain(messages.en.rejectRequest);
  });

  it("binds expense approve and reject to the rendered version instead of a later snapshot", () => {
    const review = vi.fn(); const expense = { ...pendingExpense, proposalRevision: 3 };
    const render = () => PendingExpenseList({ expenses: [expense], locale: "en", messages: messages.en, timeZone: "Asia/Tokyo", busy: false, isOwner: true, review });
    const oldButtons = renderedButtons(render());
    expect(oldButtons).toHaveLength(2);
    expense.proposalRevision = 4;
    oldButtons[0].onClick?.(); oldButtons[1].onClick?.();
    expect(review.mock.calls).toEqual([[expense.requestId, "approve", 3], [expense.requestId, "reject", 3]]);
    const newButtons = renderedButtons(render());
    newButtons[0].onClick?.(); newButtons[1].onClick?.();
    expect(review.mock.calls.slice(2)).toEqual([[expense.requestId, "approve", 4], [expense.requestId, "reject", 4]]);
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("does not review a missing or invalid rendered expense revision %s", (proposalRevision) => {
    const review = vi.fn();
    const buttons = renderedButtons(PendingExpenseList({ expenses: [{ ...pendingExpense, proposalRevision: proposalRevision as number }], locale: "en", messages: messages.en, timeZone: "Asia/Tokyo", busy: false, isOwner: true, review }));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) { expect(button.disabled).toBe(true); button.onClick?.(); }
    expect(review).not.toHaveBeenCalled();
  });
});

describe("TimelineList", () => {
  it("renders each event's weather inside the left rail above its time", () => {
    type TimelineProps = Parameters<typeof TimelineList>[0];
    type TimelineItem = TimelineProps["points"][number]["item"];
    const weather = {
      targetRole: "location" as const,
      forecastAt: "2026-09-06T10:00:00.000Z",
      sampledAt: "2026-09-06T10:00:00.000Z",
      fetchedAt: "2026-09-04T10:00:00.000Z",
      staleAfter: "2026-09-04T10:30:00.000Z",
      stale: false,
      locationLabel: "Tokyo Station",
      locationPrecision: "event" as const,
      provider: "open-meteo" as const,
      weatherCode: 1,
      condition: "mainly_clear",
      icon: "partly-cloudy-day",
      temperatureCelsius: 27,
      apparentTemperatureCelsius: 29,
      precipitationProbabilityPercent: 20,
    };
    const item = {
      id: "item-1",
      tripDayId: "day-1",
      title: "Tokyo dinner",
      itemType: "meal",
      startsAt: "2026-09-06T10:00:00.000Z",
      endsAt: "2026-09-06T11:00:00.000Z",
      locationName: "Tokyo Station",
      mapUrl: null,
      departureLocationName: null,
      departureMapUrl: null,
      destinationLocationName: null,
      destinationMapUrl: null,
      flight: null,
      notes: null,
      createdByMemberId: "member-1",
      creatorName: "Traveler",
      visibility: "trip",
      viewerMemberIds: [],
      status: "planned",
      isLocked: false,
      currentRevision: 1,
      weather,
      weatherForecasts: [weather],
      disruption: null,
      calendarLink: null,
    } satisfies TimelineItem;
    const overview = {
      trip: { timeZone: "Asia/Tokyo" },
      permissions: { canEditItinerary: false, canSyncCalendar: false },
    } as TimelineProps["overview"];
    const points = projectTimelinePoints([item], {
      tripDays: [{ id: "day-1", date: "2026-09-06" }],
      timeZone: "Asia/Tokyo",
    });
    const markup = renderToStaticMarkup(createElement(TimelineList, {
      overview,
      locale: "en",
      messages: messages.en,
      points,
      busy: false,
      calendarBusy: false,
      openEvent: vi.fn(),
      cancelOrRestore: vi.fn(),
      syncCalendar: vi.fn(),
      showDisruption: vi.fn(),
      emptyMessage: "No events",
    }));

    const weatherIndex = markup.indexOf("weather-forecast-badge");
    const probabilityIndex = markup.indexOf("weather-forecast-probability");
    const timeRailIndex = markup.indexOf("timeline-time has-weather");
    const timeIndex = markup.indexOf("<time>");
    const detailsIndex = markup.indexOf("timeline-event-link");
    expect(timeRailIndex).toBeGreaterThan(-1);
    expect(weatherIndex).toBeGreaterThan(-1);
    expect(weatherIndex).toBeGreaterThan(timeRailIndex);
    expect(probabilityIndex).toBeGreaterThan(weatherIndex);
    expect(markup.slice(probabilityIndex, markup.indexOf("</small>", probabilityIndex))).toContain("20%");
    expect(timeIndex).toBeGreaterThan(weatherIndex);
    expect(detailsIndex).toBeGreaterThan(timeIndex);
    expect(markup.match(/weather-forecast-badge/g)).toHaveLength(1);

    const unknownProbabilityWeather = {
      ...weather,
      precipitationProbabilityPercent: null,
    };
    const unknownProbabilityPoints = projectTimelinePoints([{
      ...item,
      weather: unknownProbabilityWeather,
      weatherForecasts: [unknownProbabilityWeather],
    }], {
      tripDays: [{ id: "day-1", date: "2026-09-06" }],
      timeZone: "Asia/Tokyo",
    });
    const unknownProbabilityMarkup = renderToStaticMarkup(createElement(TimelineList, {
      overview,
      locale: "en",
      messages: messages.en,
      points: unknownProbabilityPoints,
      busy: false,
      calendarBusy: false,
      openEvent: vi.fn(),
      cancelOrRestore: vi.fn(),
      syncCalendar: vi.fn(),
      showDisruption: vi.fn(),
      emptyMessage: "No events",
    }));
    expect(unknownProbabilityMarkup).not.toContain("weather-forecast-probability");
  });

  it("renders transport endpoints as separate chronological rows with one action set", () => {
    type TimelineProps = Parameters<typeof TimelineList>[0];
    type TimelineItem = TimelineProps["points"][number]["item"];
    const forecast = (targetRole: "departure" | "destination", temperatureCelsius: number, precipitationProbabilityPercent: number) => ({
      targetRole,
      forecastAt: targetRole === "departure" ? "2026-09-06T00:00:00.000Z" : "2026-09-06T03:00:00.000Z",
      sampledAt: targetRole === "departure" ? "2026-09-06T00:00:00.000Z" : "2026-09-06T03:00:00.000Z",
      fetchedAt: "2026-09-04T10:00:00.000Z",
      staleAfter: "2026-09-04T10:30:00.000Z",
      stale: false,
      locationLabel: targetRole === "departure" ? "Haneda Airport" : "Fukuoka Airport",
      locationPrecision: "event" as const,
      provider: "open-meteo" as const,
      weatherCode: 1,
      condition: "mainly_clear",
      icon: "partly-cloudy-day",
      temperatureCelsius,
      apparentTemperatureCelsius: temperatureCelsius,
      precipitationProbabilityPercent,
    });
    const departureWeather = forecast("departure", 25, 15);
    const destinationWeather = forecast("destination", 28, 80);
    const item = {
      id: "transport-1",
      tripDayId: "day-1",
      title: "Flight to Fukuoka",
      itemType: "transport",
      startsAt: "2026-09-06T00:00:00.000Z",
      endsAt: "2026-09-06T03:00:00.000Z",
      locationName: null,
      mapUrl: null,
      departureLocationName: "Haneda Airport",
      departureMapUrl: null,
      destinationLocationName: "Fukuoka Airport",
      destinationMapUrl: null,
      flight: null,
      notes: null,
      createdByMemberId: "member-1",
      creatorName: "Traveler",
      visibility: "trip",
      viewerMemberIds: [],
      status: "planned",
      isLocked: false,
      currentRevision: 1,
      weather: destinationWeather,
      weatherForecasts: [departureWeather, destinationWeather],
      disruption: null,
      calendarLink: null,
    } satisfies TimelineItem;
    const points = projectTimelinePoints([item], {
      tripDays: [{ id: "day-1", date: "2026-09-06" }],
      timeZone: "Asia/Tokyo",
    });
    const overview = {
      trip: { timeZone: "Asia/Tokyo" },
      permissions: { canEditItinerary: true, canSyncCalendar: true },
    } as TimelineProps["overview"];
    const markup = renderToStaticMarkup(createElement(TimelineList, {
      overview,
      locale: "en",
      messages: messages.en,
      points,
      busy: false,
      calendarBusy: false,
      openEvent: vi.fn(),
      cancelOrRestore: vi.fn(),
      syncCalendar: vi.fn(),
      showDisruption: vi.fn(),
      emptyMessage: "No events",
    }));

    expect(markup.match(/data-timeline-point="departure"/g)).toHaveLength(1);
    expect(markup.match(/data-timeline-point="arrival"/g)).toHaveLength(1);
    expect(markup).toContain("Haneda Airport");
    expect(markup).toContain("Fukuoka Airport");
    expect(markup).toContain(messages.en.departureLabel);
    expect(markup).toContain(messages.en.destinationLabel);
    expect(markup.match(/weather-forecast-badge/g)).toHaveLength(2);
    const departureRowStart = markup.indexOf('data-timeline-point="departure"');
    const arrivalRowStart = markup.indexOf('data-timeline-point="arrival"');
    expect(markup.slice(departureRowStart, arrivalRowStart)).toContain("15%");
    expect(markup.slice(arrivalRowStart)).toContain("80%");
    expect(markup.match(/id="item-transport-1"/g)).toHaveLength(1);
    expect(markup.match(/Edit<\/button>/g)).toHaveLength(1);
    expect(markup.match(/Cancel event<\/button>/g)).toHaveLength(1);
    expect(markup.match(/Add to calendar<\/button>/g)).toHaveLength(1);

    const arrivalOnlyMarkup = renderToStaticMarkup(createElement(TimelineList, {
      overview,
      locale: "en",
      messages: messages.en,
      points: points.filter((point) => point.kind === "arrival"),
      allowActionFallback: true,
      busy: false,
      calendarBusy: false,
      openEvent: vi.fn(),
      cancelOrRestore: vi.fn(),
      syncCalendar: vi.fn(),
      showDisruption: vi.fn(),
      emptyMessage: "No events",
    }));
    expect(arrivalOnlyMarkup.match(/id="item-transport-1"/g)).toHaveLength(1);
    expect(arrivalOnlyMarkup.match(/Edit<\/button>/g)).toHaveLength(1);
    expect(arrivalOnlyMarkup.match(/Cancel event<\/button>/g)).toHaveLength(1);
    expect(arrivalOnlyMarkup.match(/Add to calendar<\/button>/g)).toHaveLength(1);
  });

  it("renders the Overview next-event forecast at the start of its header", () => {
    type HeaderItem = NonNullable<Parameters<typeof NextEventHeader>[0]["item"]>;
    const item = {
      id: "next-item",
      title: "Next Tokyo dinner",
      disruption: null,
    } as HeaderItem;
    const weather = {
        targetRole: "location" as const,
        forecastAt: "2026-09-06T10:00:00.000Z",
        sampledAt: "2026-09-06T10:00:00.000Z",
        fetchedAt: "2026-09-04T10:00:00.000Z",
        staleAfter: "2026-09-04T10:30:00.000Z",
        stale: false,
        locationLabel: "Tokyo Station",
        locationPrecision: "event" as const,
        provider: "open-meteo" as const,
        weatherCode: 1,
        condition: "mainly_clear",
        icon: "partly-cloudy-day",
        temperatureCelsius: 27,
        apparentTemperatureCelsius: 29,
        precipitationProbabilityPercent: 20,
      };
    const markup = renderToStaticMarkup(createElement(NextEventHeader, {
      item,
      weather,
      locale: "en",
      messages: messages.en,
      timeZone: "Asia/Tokyo",
      showDisruption: vi.fn(),
    }));

    expect(markup.indexOf("weather-forecast-badge")).toBeGreaterThan(-1);
    expect(markup.indexOf("weather-forecast-probability")).toBeGreaterThan(-1);
    expect(markup).toContain("20%");
    expect(markup.indexOf("status-pill")).toBeGreaterThan(markup.indexOf("weather-forecast-badge"));
  });
});

const approvalRequest: ApprovalRequest = {
  id: "request-1",
  proposalRevision: 1,
  requestedByName: "Traveler",
  source: "ai",
  entityType: "itinerary_item",
  entityId: null,
  operation: "create",
  baseRevision: null,
  patch: { title: "Pending dinner" },
  display: { kind: "itinerary", event: {
    title: "Pending dinner", itemType: "meal", dayDate: "2026-09-01", startsAt: "2026-09-01T10:00:00Z", endsAt: null,
    locationName: "Synthetic restaurant", mapUrl: null, departureLocationName: null, departureMapUrl: null,
    destinationLocationName: null, destinationMapUrl: null, notes: null, visibility: "trip", audienceNames: [], isLocked: false, status: "planned", linkedExpense: null,
  } },
  reason: "Traveler requested dinner",
  status: "pending",
  reviewNote: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  reviewedAt: null,
};

function renderApprovalHistory(status: ApprovalRequest["status"]) {
  return renderToStaticMarkup(createElement(ApprovalRequestList, {
    requests: [{
      ...approvalRequest,
      status,
      reviewNote: status === "pending" ? null : `${status} by owner`,
      reviewedAt: status === "pending" ? null : "2026-09-01T12:30:00.000Z",
    }],
    locale: "en",
    messages: messages.en,
    busy: false,
    review: vi.fn(),
  }));
}

describe("ApprovalRequestList", () => {
  it("offers approve and reject for a pending request", () => {
    const markup = renderApprovalHistory("pending");

    expect(markup).toContain("Pending dinner");
    expect(markup).toContain(messages.en.approveRequest);
    expect(markup).toContain(messages.en.rejectRequest);
  });

  it("keeps a rejected request in history and allows later approval", () => {
    const markup = renderApprovalHistory("rejected");

    expect(markup).toContain(messages.en.requestStatusRejected);
    expect(markup).toContain(messages.en.reapproveRejectedRequest);
    expect(markup).not.toContain(messages.en.rejectRequest);
  });

  it("keeps an approved request in history without review or delete controls", () => {
    const markup = renderApprovalHistory("approved");

    expect(markup).toContain(messages.en.requestStatusApproved);
    expect(markup).not.toContain(messages.en.approveRequest);
    expect(markup).not.toContain(messages.en.rejectRequest);
    expect(markup).not.toContain(messages.en.reapproveRejectedRequest);
    expect(markup).not.toContain("Delete");
  });
});

describe("ApprovalHistoryPanel", () => {
  const renderPanel = (input: Partial<Parameters<typeof ApprovalHistoryPanel>[0]> = {}) => renderToStaticMarkup(createElement(ApprovalHistoryPanel, {
    requests: [approvalRequest],
    locale: "en",
    messages: messages.en,
    busy: false,
    loading: false,
    error: null,
    hasMore: false,
    retry: vi.fn(),
    loadMore: vi.fn(),
    review: vi.fn(),
    ...input,
  }));

  it("shows an initial loading state without claiming the history is empty", () => {
    const markup = renderPanel({ requests: [], loading: true });

    expect(markup).toContain(messages.en.approvalHistoryLoading);
    expect(markup).not.toContain(messages.en.noApprovalHistory);
  });

  it("offers bounded continuation only while another cursor is available", () => {
    const withMore = renderPanel({ hasMore: true });
    const exhausted = renderPanel({ hasMore: false });

    expect(withMore).toContain(messages.en.loadMoreApprovalHistory);
    expect(exhausted).not.toContain(messages.en.loadMoreApprovalHistory);
  });

  it("keeps loaded rows visible and provides a retry after a later-page failure", () => {
    const markup = renderPanel({ error: "Temporary history error", hasMore: true });

    expect(markup).toContain("Pending dinner");
    expect(markup).toContain("Temporary history error");
    expect(markup).toContain(messages.en.retryApprovalHistory);
  });

  it("merges pages by request id without duplicating a boundary row", () => {
    expect(mergeApprovalHistory(
      [approvalRequest],
      [{ ...approvalRequest, status: "approved", reviewNote: "Approved" }],
    )).toEqual([{ ...approvalRequest, status: "approved", reviewNote: "Approved" }]);
  });

  it.each(locales)("renders older actionable pending work before reviewed and invalidated history in %s", (locale) => {
    const display = approvalRequest.display;
    if (display?.kind !== "itinerary") throw new Error("The synthetic fixture must display an itinerary event");
    const titled = (id: string, title: string, patch: Partial<ApprovalRequest>): ApprovalRequest => ({
      ...approvalRequest, id, display: { kind: "itinerary", event: { ...display.event, title } }, ...patch,
    });
    const reviewed = titled("reviewed", "Synthetic reviewed title", { status: "approved", createdAt: "2026-09-03T12:00:00.000Z" });
    const invalidated = titled("invalidated", "Synthetic invalidated title", { reviewBlockedReason: "member_removed", createdAt: "2026-09-02T12:00:00.000Z" });
    const pending = titled("pending", "Synthetic pending title", { createdAt: "2026-09-01T12:00:00.000Z" });
    const markup = renderPanel({ requests: [reviewed, invalidated, pending], locale, messages: messages[locale] });
    expect(markup.indexOf("Synthetic pending title")).toBeLessThan(markup.indexOf("Synthetic reviewed title"));
    expect(markup.indexOf("Synthetic reviewed title")).toBeLessThan(markup.indexOf("Synthetic invalidated title"));
    expect(Array.from(markup.matchAll(/<button\b[^>]*>/g))).toHaveLength(2);
  });

  it("keeps server order and does not re-sort timestamps or UUIDs within either priority", () => {
    const rows: ApprovalRequest[] = [
      { ...approvalRequest, id: "history-z", status: "approved", createdAt: "2026-09-04T12:00:00.000Z" },
      { ...approvalRequest, id: "pending-a", createdAt: "2026-09-01T12:00:00.000Z" },
      { ...approvalRequest, id: "history-a", status: "rejected", createdAt: "2026-09-05T12:00:00.000Z" },
      { ...approvalRequest, id: "pending-z", createdAt: "2026-09-01T12:00:00.000Z" },
      { ...approvalRequest, id: "blocked", reviewBlockedReason: "member_removed" },
    ];
    const before = structuredClone(rows);
    expect(mergeApprovalHistory([], rows).map((request) => request.id))
      .toEqual(["pending-a", "pending-z", "history-z", "history-a", "blocked"]);
    expect(rows).toEqual(before);
  });

  it("deduplicates incoming pages before applying changed status and blocked-state priority", () => {
    const current: ApprovalRequest[] = [
      { ...approvalRequest, id: "approved-later" },
      { ...approvalRequest, id: "blocked-later" },
      { ...approvalRequest, id: "still-pending" },
      { ...approvalRequest, id: "pending-again", status: "rejected" },
      { ...approvalRequest, id: "old-history", status: "approved" },
    ];
    const incoming: ApprovalRequest[] = [
      { ...approvalRequest, id: "approved-later", status: "approved", proposalRevision: 2 },
      { ...approvalRequest, id: "blocked-later", reviewBlockedReason: "member_removed", proposalRevision: 3 },
      { ...approvalRequest, id: "pending-again", proposalRevision: 4 },
      { ...approvalRequest, id: "new-pending" },
      { ...approvalRequest, id: "new-history", status: "rejected" },
      { ...approvalRequest, id: "new-pending", proposalRevision: 5 },
    ];
    const result = mergeApprovalHistory(current, incoming);
    expect(result.map((request) => request.id)).toEqual([
      "still-pending", "pending-again", "new-pending", "approved-later", "blocked-later", "old-history", "new-history",
    ]);
    expect(result.find((request) => request.id === "approved-later")).toBe(incoming[0]);
    expect(result.find((request) => request.id === "blocked-later")).toBe(incoming[1]);
    expect(result.find((request) => request.id === "pending-again")).toBe(incoming[2]);
    expect(result.find((request) => request.id === "new-pending")?.proposalRevision).toBe(5);
    expect(current[0].status).toBe("pending");
  });
});

describe("pending repayment approval placement", () => {
  const payment: MemberPayment = {
    id: "payment-pending", fromMemberId: "member-a", toMemberId: "member-b", accountingFromMemberId: "member-a", accountingToMemberId: "member-b",
    fromMemberName: "Synthetic sender", toMemberName: "Synthetic recipient", accountingFromMemberName: "Synthetic sender", accountingToMemberName: "Synthetic recipient",
    currency: "JPY", amountMinor: 100, occurredAt: "2026-09-01T12:00:00Z", createdAt: "2026-09-01T12:00:00Z",
    note: "Synthetic pending repayment", status: "pending", revision: 3, createdByMemberId: "member-a", canVoid: false, canReview: true,
  };
  const props = { requests: [{ ...approvalRequest, status: "approved" as const }], locale: "en" as const, messages: messages.en,
    timeZone: "Asia/Tokyo", busy: false, loading: false, error: null, hasMore: false, retry: vi.fn(), loadMore: vi.fn(), review: vi.fn(), paymentAction: vi.fn() };
  it.each(locales)("shows actionable repayments above event/expense history and other repayments below in %s", (locale) => {
    const html = renderToStaticMarkup(createElement(ApprovalReviewContent, { ...props, locale, messages: messages[locale], payments: [
      { ...payment, id: "rejected", status: "rejected", note: "Synthetic rejected repayment" },
      { ...payment, id: "blocked", canReview: false, note: "Synthetic blocked repayment" }, payment,
      { ...payment, id: "posted", status: "posted", note: "Synthetic posted repayment" },
    ] }));
    expect(html.indexOf("Synthetic pending repayment")).toBeLessThan(html.indexOf("Pending dinner"));
    expect(html.indexOf("Pending dinner")).toBeLessThan(html.indexOf("Synthetic rejected repayment"));
    expect(html.indexOf("Pending dinner")).toBeLessThan(html.indexOf("Synthetic blocked repayment"));
    expect(html).not.toContain("Synthetic posted repayment");
    expect(html.match(/Synthetic pending repayment/g)).toHaveLength(1);
    expect(html.match(/Synthetic rejected repayment/g)).toHaveLength(1);
    expect(Array.from(html.matchAll(/<button\b[^>]*>/g))).toHaveLength(3);
  });
  it("does not render empty duplicate repayment groups or hide pending repayments during history loading", () => {
    const empty = renderToStaticMarkup(createElement(ApprovalReviewContent, { ...props, payments: [] }));
    expect(empty).not.toContain(memberPaymentMessages("en").reviewTitle);
    const loading = renderToStaticMarkup(createElement(ApprovalReviewContent, { ...props, requests: [], loading: true, payments: [payment] }));
    expect(loading).toContain("Synthetic pending repayment"); expect(loading).toContain(messages.en.approvalHistoryLoading);
    expect(loading.match(new RegExp(memberPaymentMessages("en").reviewTitle, "g"))).toHaveLength(2); // section label and heading
  });
  it("keeps the existing approval action callback, revision and busy state", () => {
    const act = vi.fn();
    const node = ApprovalReviewContent({ ...props, busy: true, payments: [payment], paymentAction: act });
    const children = isValidElement<{ children: ReactNode[] }>(node) ? node.props.children : [];
    const group = children.find((child) => isValidElement<{ payments?: MemberPayment[] }>(child) && child.props.payments?.includes(payment));
    expect(isValidElement(group)).toBe(true);
    if (!isValidElement<{ act: typeof act; busy: boolean; reviewOnly: boolean; isOwner: boolean; payments: MemberPayment[] }>(group)) return;
    expect(group.props).toMatchObject({ act, busy: true, reviewOnly: true, isOwner: true });
    expect(group.props.payments[0]).toBe(payment); expect(group.props.payments[0].revision).toBe(3);
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(source).toContain('section === "requests" && overview.session.isOwner');
    expect(source).toContain('payment={payment} locale={locale} timeZone={overview.trip.timeZone} busy={busy} isOwner={overview.session.isOwner} act={openPaymentAction}');
  });
});

describe("aiLogExecutionLabel", () => {
  it("does not present deterministic local decisions as model calls", () => {
    expect(aiLogExecutionLabel({
      requestedModel: "gpt-6.1-sol",
      effectiveModel: "gpt-6.1-sol",
      provider: "local",
      transport: "deterministic_gate",
    })).toBe("Local scope gate · no provider call");
    expect(aiLogExecutionLabel({
      requestedModel: "gpt-6.1-sol",
      effectiveModel: null,
      provider: "local",
      transport: "policy_gate",
    })).toBe("Local policy gate · no provider call");
  });

  it("keeps the effective model label for a real provider call", () => {
    expect(aiLogExecutionLabel({
      requestedModel: "gpt-6.1-sol",
      effectiveModel: "claude-haiku-5-5",
      provider: "anthropic",
      transport: "claude-agent-sdk",
    })).toBe("claude-haiku-5-5");
  });
});

describe("AI request feedback", () => {
  it("reports a pending proposal batch with a localized count", () => {
    expect(aiProposalOutcomeMessage({
      proposalIds: ["proposal-1", "proposal-2", "proposal-3"],
      proposalCount: 3,
      proposalId: "proposal-1",
      changeStatus: "pending",
    }, messages["zh-HK"])).toBe("已建立 3 個變更審批請求，正等待管理員審批。");
  });

  it("keeps the existing singular approval message for one proposal", () => {
    expect(aiProposalOutcomeMessage({
      proposalIds: ["proposal-1"],
      proposalCount: 1,
      proposalId: "proposal-1",
      changeStatus: "pending",
    }, messages.en)).toBe(messages.en.aiApprovalCreated);
  });

  it("turns proposal validation details into safe localized guidance", () => {
    const error = new JsonRequestError(
      "The submitted values are invalid.",
      400,
      null,
      ["itemType", "startsAt"],
    );

    expect(aiRequestFailureMessage(error, messages["zh-HK-lihkg"]))
      .toBe(messages["zh-HK"].aiInvalidProposal);
    expect(aiRequestFailureMessage(error, messages["zh-HK-lihkg"]))
      .not.toContain("itemType");
  });

  it("uses the selected locale's generic copy for unrelated request failures", () => {
    expect(aiRequestFailureMessage(new Error("private provider output"), messages["ja-JP"]))
      .toBe(messages["ja-JP"].aiRequestFailed);
  });

  it.each(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const)("explains missing search evidence safely in %s", (locale) => {
    const error = new JsonRequestError("Live place search was required, but the AI returned no search evidence. No itinerary change was proposed.", 409);
    expect(aiRequestFailureMessage(error, messages[locale])).toBe(messages[locale].aiSearchEvidenceMissing);
    expect(messages["zh-HK-lihkg"].aiSearchEvidenceMissing).toBe(messages["zh-HK"].aiSearchEvidenceMissing);
  });

  it("gives localized recovery guidance for an expired session", () => {
    const error = new JsonRequestError("Authentication is required.", 401);

    expect(aiRequestFailureMessage(error, messages["ja-JP"]))
      .toBe(messages["ja-JP"].aiSessionExpired);
  });

  it("preserves a server-approved policy explanation and localizes an empty denial", () => {
    expect(aiRequestFailureMessage(
      new JsonRequestError("The daily AI limit of 20 prompts has been reached.", 403),
      messages["zh-HK"],
    )).toBe("The daily AI limit of 20 prompts has been reached.");
    expect(aiRequestFailureMessage(
      new JsonRequestError("Request failed (403)", 403),
      messages["zh-HK"],
    )).toBe(messages["zh-HK"].aiRequestDenied);
    expect(aiRequestFailureMessage(
      new JsonRequestError("AI is disabled for this trip.", 403),
      messages["zh-HK"],
    )).toBe(messages["zh-HK"].aiUnavailable);
  });

  it("distinguishes a busy conversation from other conflicts", () => {
    const error = new JsonRequestError(
      "Another AI request is already being processed for this conversation.",
      409,
    );

    expect(aiRequestFailureMessage(error, messages["zh-HK-lihkg"]))
      .toBe(messages["zh-HK-lihkg"].aiConversationBusy);
  });

  it.each([502, 503, 504])("localizes temporary AI service status %s", (status) => {
    const error = new JsonRequestError(`Request failed (${status})`, status);

    expect(aiRequestFailureMessage(error, messages.en)).toBe(messages.en.aiServiceUnavailable);
  });

  it("distinguishes a browser network failure without exposing arbitrary errors", () => {
    expect(aiRequestFailureMessage(new TypeError("Failed to fetch"), messages["zh-HK"]))
      .toBe(messages["zh-HK"].aiNetworkFailed);
    expect(aiRequestFailureMessage(new TypeError("private parsing detail"), messages["zh-HK"]))
      .toBe(messages["zh-HK"].aiRequestFailed);
  });

  it("explains prompt validation and shares the server's 8,000-character boundary", () => {
    const error = new JsonRequestError(
      "The submitted values are invalid.",
      400,
      null,
      ["prompt"],
    );

    expect(AI_PROMPT_MAX_CHARACTERS).toBe(8_000);
    expect(aiRequestFailureMessage(error, messages.en)).toBe(messages.en.aiPromptInvalid);
  });

  it("keeps unknown provider failures generic even when the server supplied detail", () => {
    const error = new JsonRequestError("private provider detail", 500, "PROVIDER_ERROR");

    expect(aiRequestFailureMessage(error, messages.en)).toBe(messages.en.aiRequestFailed);
  });
});

describe("trip end-date safeguards", () => {
  it("uses the inclusive 366-calendar-day product ceiling", () => {
    expect(maximumTripEndDate("2026-08-29")).toBe("2027-08-29");
    expect(maximumTripEndDate("2024-02-29")).toBe("2025-02-28");
  });

  it("accepts only real ISO dates inside the extension bounds", () => {
    expect(tripEndDateIsWithinBounds("2026-09-10", "2026-09-05", "2027-08-29")).toBe(true);
    expect(tripEndDateIsWithinBounds("2026-09-04", "2026-09-05", "2027-08-29")).toBe(false);
    expect(tripEndDateIsWithinBounds("2027-08-30", "2026-09-05", "2027-08-29")).toBe(false);
    expect(tripEndDateIsWithinBounds("2026-02-30", "2026-01-01", "2026-12-31")).toBe(false);
  });
});
