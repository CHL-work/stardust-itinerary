export const googleCalendarHomeUrl = "https://calendar.google.com/calendar/u/0/r";

export type CalendarSyncConfirmationCopy = Readonly<{
  created: string;
  updated: string;
  recreated: string;
  bulk: (count: number) => string;
  viewEvent: string;
  viewCalendar: string;
}>;

export type CalendarSyncConfirmationResult = Readonly<{
  action: "created" | "updated" | "recreated";
  htmlLink: string | null;
}>;

export type CalendarSyncConfirmation = Readonly<{
  message: string;
  viewUrl: string;
  viewLabel: string;
}>;

/**
 * Builds the user-facing result of an explicit Calendar sync.
 *
 * A single event's provider link is opaque and must be used verbatim. Google
 * event IDs are not sufficient to safely reconstruct the Calendar web URL.
 */
export function createCalendarSyncConfirmation(
  results: readonly CalendarSyncConfirmationResult[],
  copy: CalendarSyncConfirmationCopy,
): CalendarSyncConfirmation {
  const onlyResult = results.length === 1 ? results[0] : null;

  return {
    message: onlyResult
      ? onlyResult.action === "created"
        ? copy.created
        : onlyResult.action === "recreated"
          ? copy.recreated
          : copy.updated
      : copy.bulk(results.length),
    viewUrl: onlyResult?.htmlLink ?? googleCalendarHomeUrl,
    viewLabel: onlyResult?.htmlLink ? copy.viewEvent : copy.viewCalendar,
  };
}

/**
 * Dismisses the confirmation before staging its opaque provider URL for the
 * visible same-tab loading handoff.
 */
export function beginCalendarSyncConfirmation(
  confirmation: Pick<CalendarSyncConfirmation, "viewUrl">,
  dismiss: () => void,
  beginOpening: (url: string) => void,
): void {
  const viewUrl = confirmation.viewUrl;
  dismiss();
  beginOpening(viewUrl);
}

type RequestFrame = (callback: () => void) => number;
type CancelFrame = (handle: number) => void;

/**
 * Waits through two animation frames so React can commit and paint the
 * Calendar-loading interstitial before the browser starts external navigation.
 */
export function scheduleCalendarNavigation(
  url: string,
  requestFrame: RequestFrame,
  cancelFrame: CancelFrame,
  navigate: (url: string) => void,
): () => void {
  const viewUrl = url;
  let firstPending = true;
  let secondPending = false;
  let secondFrame: number | null = null;
  const firstFrame = requestFrame(() => {
    firstPending = false;
    secondPending = true;
    secondFrame = requestFrame(() => {
      secondPending = false;
      navigate(viewUrl);
    });
  });

  return () => {
    if (firstPending) cancelFrame(firstFrame);
    if (secondPending && secondFrame !== null) cancelFrame(secondFrame);
  };
}
