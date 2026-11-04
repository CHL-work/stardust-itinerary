import { describe, expect, it, vi } from "vitest";

import {
  beginCalendarSyncConfirmation,
  createCalendarSyncConfirmation,
  googleCalendarHomeUrl,
  scheduleCalendarNavigation,
  type CalendarSyncConfirmationCopy,
} from "@/lib/calendar/sync-confirmation";

const copy: CalendarSyncConfirmationCopy = {
  created: "created message",
  updated: "updated message",
  recreated: "recreated message",
  bulk: (count) => `bulk message: ${count}`,
  viewEvent: "view event",
  viewCalendar: "view calendar",
};

describe("Calendar sync confirmation", () => {
  it("uses a single created event's provider link without reconstructing it", () => {
    const providerHtmlLink = "https://calendar.google.com/calendar/event?eid=opaque-provider-value";

    expect(createCalendarSyncConfirmation([{
      action: "created",
      htmlLink: providerHtmlLink,
    }], copy)).toEqual({
      message: "created message",
      viewUrl: providerHtmlLink,
      viewLabel: "view event",
    });
  });

  it("delegates updated-event text to the caller", () => {
    expect(createCalendarSyncConfirmation([{
      action: "updated",
      htmlLink: "https://calendar.google.com/provider-owned-updated-link",
    }], copy)).toEqual({
      message: "updated message",
      viewUrl: "https://calendar.google.com/provider-owned-updated-link",
      viewLabel: "view event",
    });
  });

  it("distinguishes an event recreated after Google deleted its old copy", () => {
    expect(createCalendarSyncConfirmation([{
      action: "recreated",
      htmlLink: "https://calendar.google.com/recreated-provider-link",
    }], copy)).toEqual({
      message: "recreated message",
      viewUrl: "https://calendar.google.com/recreated-provider-link",
      viewLabel: "view event",
    });
  });

  it("falls back to the Calendar home when a single result has no provider link", () => {
    expect(createCalendarSyncConfirmation([{
      action: "created",
      htmlLink: null,
    }], copy)).toEqual({
      message: "created message",
      viewUrl: googleCalendarHomeUrl,
      viewLabel: "view calendar",
    });
  });

  it("uses the Calendar home and caller-provided count text for bulk results", () => {
    const bulk = vi.fn((count: number) => `localized bulk: ${count}`);

    expect(createCalendarSyncConfirmation([
      { action: "created", htmlLink: "https://calendar.google.com/first" },
      { action: "updated", htmlLink: "https://calendar.google.com/second" },
    ], { ...copy, bulk })).toEqual({
      message: "localized bulk: 2",
      viewUrl: googleCalendarHomeUrl,
      viewLabel: "view calendar",
    });
    expect(bulk).toHaveBeenCalledOnce();
    expect(bulk).toHaveBeenCalledWith(2);
  });

  it("dismisses before navigating once with a snapshot of the provider URL", () => {
    const calls: string[] = [];
    const confirmation = { viewUrl: "https://calendar.google.com/original-provider-link" };
    const dismiss = vi.fn(() => {
      calls.push("dismiss");
      confirmation.viewUrl = "https://calendar.google.com/replaced-after-dismiss";
    });
    const navigate = vi.fn((url: string) => {
      calls.push(`navigate:${url}`);
    });

    beginCalendarSyncConfirmation(confirmation, dismiss, navigate);

    expect(calls).toEqual([
      "dismiss",
      "navigate:https://calendar.google.com/original-provider-link",
    ]);
    expect(dismiss).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("waits for two frames before navigating to the exact provider URL", () => {
    const frames: Array<() => void> = [];
    const requestFrame = vi.fn((callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.fn();
    const navigate = vi.fn();

    scheduleCalendarNavigation(
      "https://calendar.google.com/opaque-provider-link",
      requestFrame,
      cancelFrame,
      navigate,
    );

    expect(navigate).not.toHaveBeenCalled();
    frames[0]();
    expect(navigate).not.toHaveBeenCalled();
    frames[1]();
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("https://calendar.google.com/opaque-provider-link");
  });

  it("cancels whichever scheduled frame has not run", () => {
    const frames: Array<() => void> = [];
    const requestFrame = vi.fn((callback: () => void) => {
      frames.push(callback);
      return frames.length * 10;
    });
    const cancelFrame = vi.fn();

    const cancelFirst = scheduleCalendarNavigation("https://calendar.google.com/first", requestFrame, cancelFrame, vi.fn());
    cancelFirst();
    expect(cancelFrame).toHaveBeenCalledWith(10);

    cancelFrame.mockClear();
    const cancelSecond = scheduleCalendarNavigation("https://calendar.google.com/second", requestFrame, cancelFrame, vi.fn());
    frames[1]();
    cancelSecond();
    expect(cancelFrame).toHaveBeenCalledWith(30);
  });
});
