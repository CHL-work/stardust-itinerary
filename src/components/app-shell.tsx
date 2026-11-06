"use client";

import {
  AlertTriangle,
  Bell,
  Bot,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Clock3,
  Copy,
  Droplets,
  Lock,
  LogOut,
  MapPin,
  PencilLine,
  Plus,
  ReceiptText,
  RefreshCw,
  Route,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Unlock,
  Users,
  UserPlus,
  X,
} from "lucide-react";

import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import { tripDateErrors, validTripDateRange } from "@/lib/app/trip-date-range";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DocumentLanguage } from "@/components/document-language";
import { DayEventMap } from "@/components/day-event-map";
import { projectDayMapStops } from "@/lib/maps/day-stops";
import { ActivityPanel, ActivitySettingsEntry } from "@/components/activity-panel";
import { advancedSettingsMessages, advancedRequestStatus } from "@/lib/app/advanced-settings-i18n";
import advancedStyles from "@/components/advanced-settings.module.css";
import { announceFeedbackContext, clearFeedbackContext, feedbackTrail } from "@/lib/feedback/client-context";
import { FeedbackOperations } from "@/components/feedback-operations";
import { AdminEntry } from "@/components/admin-entry";
import { activityMessages } from "@/lib/app/activity-i18n";
import type { ActivityEntry } from "@/lib/app/activity-types";
import { CalendarTimelineCard } from "@/components/calendar-timeline-card";
import { CalendarImportDialog } from "@/components/calendar-import-dialog";
import { calendarImportMessages } from "@/lib/calendar/import-i18n";
import { projectPersonalCalendarEvents, projectCalendarAwareTimelinePoints, type PersonalCalendarEvent, type PersonalCalendarPoint } from "@/lib/calendar/timeline";
import type { CalendarSourceMetadata } from "@/lib/calendar/import-contracts";
import { AiConversationPage } from "@/components/ai-conversation-page";
import { AiInstructionsSettings } from "@/components/ai-instructions-settings";
import { AiKeysSettings } from "@/components/ai-keys-settings";
import { aiKeysMessages, type AiKeysCopy } from "@/lib/ai/keys-i18n";
import { guestMessages } from "@/lib/app/guest-i18n";
import { ownKeyModel, ownKeyModels } from "@/lib/ai/own-key-model";
import { aiInstructionsMessages } from "@/lib/ai/instructions-i18n";
import { parseAiProviderFailureDetails, type AiProviderFailureDetails } from "@/lib/ai/provider-failure";
import { aiProviderFailureMessage, type AiFailurePresentationOptions } from "@/lib/ai/provider-failure-presentation";
import { AiReadableText } from "@/components/ai-readable-text";
import { ExpenseDisplayCard } from "@/components/expense-display-card";
import { CurrentDayGroups, DayAccordion, type DayGroupsHandle } from "@/components/current-day-groups";
import { mobileCardsMessages } from "@/lib/app/mobile-cards-i18n";
import { ApprovalRequestCards } from "@/components/approval-request-cards";
import { EventEditorFeedback, EventExpenseParticipants } from "@/components/event-editor-feedback";
import { EventTimeFields } from "@/components/event-time-fields";
import { ExpenseSplitEditor } from "@/components/expense-split-editor";
import { TripExpenseSummary, PersonalExpenseWidget } from "@/components/trip-expense-summary";
import { MemberPaymentForm, MemberPaymentDecisionForm, MemberPaymentHistory, MemberPaymentCard, eligiblePaymentMember,
  type PaymentDraft, type PaymentDecision, type PaymentAction } from "@/components/member-payment-controls";
import type { MemberPayment } from "@/lib/app/member-payments";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { paymentAmountInput } from "@/lib/app/member-payment-format";
import type { SummarySettlement } from "@/lib/domain/expense-summary";
import { expensePageMessages } from "@/lib/app/expense-page-i18n";
import { groupExpenseDays, compareExpenseDayEntries } from "@/lib/app/expense-day-groups";
import { parseExpenseAmount } from "@/lib/app/expense-entry";
import { expenseAmountInput } from "@/lib/app/expense-currency";
import { expenseSplitPatch, expenseSplitPreview, initializeExpenseSplits, type ExpenseSplitDraft } from "@/lib/app/expense-split-editor";
import { resolveExpenseEvent } from "@/lib/app/expense-retained-event";
import { eventEditorFailureMessage, eventEditorMessages } from "@/lib/app/event-editor-i18n";
import {
  constrainNewEventExpense,
  currencyFactor,
  eventExpenseDefaults,
  eventExpenseMembers as eligibleEventExpenseMembers,
  preserveUnchangedLinkedExpense,
  validateEventExpense,
  type EventExpenseDraft,
} from "@/lib/app/event-expense-editor";
import { MemberRemovalReview, MemberRoleControl } from "@/components/member-management-controls";
import { memberManagementMessages } from "@/lib/app/member-management-i18n";
import type { MemberRole } from "@/lib/app/member-management-client";
import type { MemberRemovalInput, MemberRemovalPreview } from "@/lib/app/member-removal";
import { AiImagePicker, useAiImageDraft, type AiImagePickerProps } from "@/components/ai-image-picker";
import { aiHistoryMessages } from "@/lib/ai/history-i18n";
import { aiRequestDeliveryTimeoutMs } from "@/lib/ai/request-budget";
import { aiImageMessages, type AiImageMessages } from "@/lib/ai/image-i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NewBottomNav, QuickAiButton } from "@/components/new-ui/new-navigation";
import { ItineraryDayJump, OverviewDayStrip, TripOverviewBar } from "@/components/new-ui/trip-overview-bar";
import { TripAdjacentNav } from "@/components/trip-adjacent-nav";
import { TripDeletionCard, TripDeletionReview } from "@/components/trip-deletion-controls";
import type { TripDeletionPreview } from "@/lib/app/trip-deletion-contract";
import { tripDeletionMessages } from "@/lib/app/trip-deletion-i18n";
import { UiModeSettingsCard, UiModeToggle } from "@/components/new-ui/ui-mode-toggle";
import { countdownParts, pickCurrentTripDay, shiftTripDay, tripLocalDateKey } from "@/lib/app/day-view";
import { createRevalidationCoordinator, type RevalidationMode } from "@/lib/app/revalidation";
import { notifyBrowserDisruptions } from "@/lib/disruptions/notifications";
import {
  nextUpcomingTimelinePoint,
  projectTimelinePoints,
  type TimelinePoint,
  type TimelineSource,
} from "@/lib/app/timeline";
import {
  DEFAULT_OWNER_MODEL,
  selectableOwnerModels,
  type ApprovalHistoryPage,
  type ApprovalRequest,
  type DisruptionReasonCode,
  type EventDisruption,
  type EventWeatherForecast,
  type OwnerModel,
  type PendingExpenseProjection,
  type PendingItineraryEditDetail,
  type PendingItineraryProjection,
} from "@/lib/app/types";
import { addMinutesToWallTime, minutesBetweenWallTimes } from "@/lib/app/wall-time";
import { withStableSession } from "@/lib/auth/client-session";
import { createAiRequestRecoveryClient, watchAiRequestRecovery, type AiRecoveryState, type AiRequestRecoveryClient } from "@/lib/ai/request-recovery-client";
import { AI_QUICK_REPLY_TTL_MS, aiQuickReplyAt, aiQuickReplyExpired } from "@/lib/ai/quick-reply";
import type { AiPlannerResult, AiRequestRecoveryResponse } from "@/lib/ai/request-recovery-types";
import {
  parsePendingCalendarSync,
  pendingCalendarSyncStorageKey,
  serializePendingCalendarSync,
  type PendingCalendarSync,
} from "@/lib/calendar/pending-sync";
import {
  beginCalendarSyncConfirmation,
  createCalendarSyncConfirmation,
  scheduleCalendarNavigation,
  type CalendarSyncConfirmation,
} from "@/lib/calendar/sync-confirmation";
import { formatMessage, type Locale, type Messages } from "@/lib/i18n";
import { disruptionDetailLocale, selectLocalizedDisruptionDetail } from "@/lib/disruptions/localization";
import {
  isOfflineFallbackEligible,
  loadLastOfflineItinerarySnapshot,
  purgePrivateOfflineDataOnSignOut,
  clearOfflineItinerarySnapshot,
  replaceOfflineItinerarySnapshot,
  type OfflineItinerarySnapshot,
} from "@/lib/offline/itinerary-snapshot";

type Section = "today" | "itinerary" | "expenses" | "ai" | "requests" | "activity" | "settings";

const passiveRevalidationIntervalMs = 15_000;
const weatherRefreshCheckIntervalMs = 30 * 60_000;

type Permissions = {
  canEditItinerary: boolean;
  itineraryRequiresApproval: boolean;
  canEditExpenses: boolean;
  expenseRequiresApproval: boolean;
  canSyncCalendar: boolean;
};

export function canEditPendingEvent(
  request: Pick<PendingItineraryProjection, "requestedByMemberId" | "operation">,
  session: { memberId: string; isOwner: boolean; role: string },
  permissions: Pick<Permissions, "canEditItinerary">,
): boolean {
  return (request.operation === "create" || request.operation === "update")
    && permissions.canEditItinerary
    && (session.isOwner || session.role === "editor");
}

export function pendingUpdateTargetIds(
  requests: readonly Pick<PendingItineraryProjection, "operation" | "targetItemId">[],
): Set<string> {
  return new Set(requests.flatMap((request) => (
    request.operation !== "create" && request.targetItemId ? [request.targetItemId] : []
  )));
}

type AiMemoryUsage = {
  previousTurnsUsed: number;
  tokenEstimate: number;
  tokenBudget: number;
  checkpointVersion: number | null;
  truncated: boolean;
};

type AiPlannerResponse = {
  message: string;
  proposalIds: string[];
  proposalCount: number;
  proposalId: string | null;
  changeStatus: "approved" | "pending" | null;
  entityId: string | null;
  model: string;
  webSearch: { performed: boolean; queryCount: number; sources: string[] };
  memory: AiMemoryUsage;
};

export class JsonRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly validationPaths: string[];
  readonly providerFailure: AiProviderFailureDetails | null;

  constructor(message: string, status: number, code: string | null = null, validationPaths: string[] = [], providerFailure: AiProviderFailureDetails | null = null) {
    super(message);
    this.name = "JsonRequestError";
    this.status = status;
    this.code = code;
    this.validationPaths = validationPaths;
    this.providerFailure = providerFailure;
  }
}

export const AI_PROMPT_MAX_CHARACTERS = 8_000;

type ItineraryItem = {
  id: string;
  tripDayId: string;
  title: string;
  itemType: string;
  startsAt: string | null;
  endsAt: string | null;
  sourceCalendar?: CalendarSourceMetadata;
  locationName: string | null;
  mapUrl: string | null;
  departureLocationName: string | null;
  departureMapUrl: string | null;
  destinationLocationName: string | null;
  destinationMapUrl: string | null;
  notes: string | null;
  createdByMemberId: string;
  creatorName: string;
  visibility: "trip" | "private";
  viewerMemberIds: string[];
  status: string;
  isLocked: boolean;
  currentRevision: number;
  weather: EventWeatherForecast | null;
  weatherForecasts: EventWeatherForecast[];
  disruption: EventDisruption | null;
  calendarLink: null | { eventId: string; htmlLink: string | null; syncedRevision: number; status: string };
};

type PendingTimelineItem = PendingItineraryProjection & { id: string };

type PendingEventEditorTarget = {
  kind: "pending";
  detail: PendingItineraryEditDetail;
};

type EventEditorTarget = ItineraryItem | "new" | PendingEventEditorTarget;

function isPendingEventEditorTarget(
  target: EventEditorTarget | null,
): target is PendingEventEditorTarget {
  return Boolean(target && target !== "new" && "kind" in target && target.kind === "pending");
}

type Overview = {
  session: {
    memberId: string; userId?: string; displayName: string; role: string; isOwner: boolean;
    /** A 24-hour guest account (JOB-064): when it and its demo trip are deleted. */
    isGuest?: boolean; guestExpiresAt?: string | null;
  };
  availableTrips: Array<{
    id: string; name: string; destinationName: string; startsOn: string; endsOn: string;
    role: string; current: boolean;
  }>;
  trip: {
    id: string;
    name: string;
    destinationName: string;
    timeZone: string;
    defaultLocale: string;
    defaultCurrency: string;
    startsOn: string;
    endsOn: string;
    maxMembers: number;
    memberCount: number;
    joinLinkActive: boolean;
  };
  members: Array<{
    id: string;
    displayName: string;
    role: string;
    status: string;
    identityBound: boolean;
    googleEmail?: string | null;
    /** Owner view only: whose AI keys this member may use (JOB-063). */
    aiKeyGrant?: { sponsorMemberId: string; sponsorName: string } | null;
    currentRevision?: number;
    canRemove: boolean;
    permissions: Permissions;
  }>;
  permissions: Permissions;
  days: Array<{ id: string; date: string; label: string | null }>;
  itinerary: ItineraryItem[];
  pendingItinerary: PendingItineraryProjection[];
  pendingExpenses: PendingExpenseProjection[];
  memberPayments?: MemberPayment[];
  expenses: Array<{
    id: string; description: string; amountMinor: number; currency: string; status: string;
    occurredAt: string; currentRevision: number; payerMemberId: string; payerName: string;
    itineraryItemId: string | null; itineraryItemTitle: string | null;
    itineraryItemRemoved?: boolean;
    itineraryItemAudience?: { createdByMemberId: string; visibility: "trip" | "private"; viewerMemberIds: string[] } | null;
    splits: Array<{ memberId: string; memberName: string; shareMinor: number }>;
    currentMemberShareMinor: number;
  }>;
  expenseLedger: {
    balances: Array<{ memberId: string; memberName: string; currency: string; paidMinor: number; shareMinor: number; netMinor: number }>;
    settlements: Array<{ currency: string; fromMemberId: string; fromMemberName: string; toMemberId: string; toMemberName: string; amountMinor: number }>;
  };
  approvalPendingCount: number;
  ai: {
    enabled: boolean; ownerDefaultModel: string; effectiveModel: string;
    canSelectModel?: boolean; hostSubscriptionEnabled?: boolean;
    /** The platform operator's own AI, on the server's keys they pay for (JOB-072). */
    operatorOwnAi?: boolean;
    /** Providers the signed-in user holds their own API key for (JOB-061). */
    ownKeyProviders?: string[];
    /** A trip owner's AI keys shared with the user (JOB-063): who shares them and which model runs. */
    sharedKey?: { sponsorName: string; model: string } | null;
    /** AI is allowed here, but only with the user's own key, and they have none. */
    keyRequired?: boolean;
    /** Free guest AI (JOB-071): the free model's name and the guest's requests left today. */
    freeAi?: { model: string; limit: number; remainingToday: number } | null;
    memberDailyLimit: number; usedToday: number; remainingToday: number | null;
  };
  liveOperations: null | {
    weather: null | {
      status: "succeeded" | "partial" | "failed";
      candidateCount: number;
      cacheHitCount: number;
      refreshedCount: number;
      failedCount: number;
      errorCode: string | null;
      startedAt: string;
      completedAt: string;
      lastSuccessAt: string | null;
    };
    disruption: null | {
      enabled: boolean;
      intervalMinutes: number;
      nextDueAt: string;
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      lastErrorCode: string | null;
      latestRunStatus: "running" | "succeeded" | "failed" | "skipped" | null;
      latestRunCompletedAt: string | null;
    };
  };
  activity: ActivityEntry[];
  aiLogs: Array<{
    id: string; actorName: string; prompt: string | null; result: string | null;
    requestedModel: string; effectiveModel: string | null; status: string;
    feature: string; provider: string | null; transport: string | null; billingBasis: string | null;
    inputTokens: number | null; outputTokens: number | null; latencyMs: number | null;
    error: string | null; createdAt: string;
  }>;
  calendar: { connected: boolean; connectionUrl: string; setupUrl: string };
};

export function aiLogExecutionLabel(log: {
  requestedModel: string;
  effectiveModel: string | null;
  provider: string | null;
  transport: string | null;
}): string {
  if (log.provider === "local") {
    if (log.transport === "deterministic_gate") return "Local scope gate · no provider call";
    if (log.transport === "policy_gate") return "Local policy gate · no provider call";
    return "Local application decision · no provider call";
  }
  return log.effectiveModel || log.requestedModel;
}

type EventDraft = {
  title: string;
  tripDayId: string;
  itemType: "activity" | "meal" | "transport" | "lodging" | "note";
  startsAt: string;
  endsAt: string;
  durationMinutes: string;
  durationWasEdited?: boolean;
  locationName: string;
  mapUrl: string;
  departureLocationName: string;
  departureMapUrl: string;
  destinationLocationName: string;
  destinationMapUrl: string;
  notes: string;
  visibility: "trip" | "private";
  viewerMemberIds: string[];
  isLocked: boolean;
  linkedExpense: EventExpenseDraft;
};

type ExpenseDraft = ExpenseSplitDraft & {
  id: string | null;
  currentRevision: number | null;
  description: string;
  amount: string;
  currency: string;
  payerMemberId: string;
  itineraryItemId: string;
  occurredAt: string;
  splitMemberIds: string[];
};

type PaymentDialog = { scope: string } & ({ kind: "create"; draft: PaymentDraft } | { kind: "action"; decision: PaymentDecision });
type PaymentAttempt = { scope: string; url: string; method: "POST" | "PATCH"; body: string };

type TripSettingsDraft = {
  scope: string;
  destinationName: string;
  timeZone: string;
  maxMembers: string;
  startsOn: string;
  endsOn: string;
  expectedStartsOn: string;
  expectedEndsOn: string;
};

type TripSettingsOverview = {
  session: Pick<Overview["session"], "memberId" | "userId" | "isOwner">;
  trip: Pick<Overview["trip"], "id" | "destinationName" | "timeZone" | "maxMembers" | "startsOn" | "endsOn">;
};

export function tripSettingsScope(data: Pick<TripSettingsOverview, "session"> & { trip: { id: string } }): string {
  return `${data.trip.id}:${data.session.memberId}:${data.session.userId ?? ""}`;
}

export function reconcileTripSettingsDraft(current: TripSettingsDraft | null, data: TripSettingsOverview, syncDrafts: boolean): TripSettingsDraft | null {
  if (!data.session.isOwner) return null;
  const scope = tripSettingsScope(data);
  if (!syncDrafts && current?.scope === scope) return current;
  return { scope, destinationName: data.trip.destinationName, timeZone: data.trip.timeZone,
    maxMembers: String(data.trip.maxMembers), startsOn: data.trip.startsOn, endsOn: data.trip.endsOn,
    expectedStartsOn: data.trip.startsOn, expectedEndsOn: data.trip.endsOn };
}

type CalendarState = {
  events: PersonalCalendarEvent[];
  conflicts: Array<{ itineraryItemId: string; itineraryTitle: string; calendarEventId: string; calendarTitle: string }>;
};

function calendarAuthorizationNeedsReconnect(message: string): boolean {
  return /connect google calendar|calendar access expired|permission is missing/i.test(message);
}

function formatMoney(amountMinor: number | null, currency: string | null, locale: string): string {
  if (amountMinor === null || !currency) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / currencyFactor(currency));
}

function formatDateTime(value: string | null, locale: string, timeZone: string): string {
  if (!value) return "Time not set";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateTimeParts(value: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function inputDateTime(value: string | null, timeZone: string): string {
  if (!value) return "";
  const parts = dateTimeParts(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function zonedInputToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Enter a valid date and time.");
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = dateTimeParts(new Date(instant), timeZone);
    const observedWallTime = Date.UTC(Number(observed.year), Number(observed.month) - 1, Number(observed.day), Number(observed.hour), Number(observed.minute));
    instant += target - observedWallTime;
  }
  return new Date(instant).toISOString();
}

function formatTime(value: string | null, locale: string, timeZone: string): string {
  if (!value) return "TBD";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTripDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatCountdown(targetMs: number, nowMs: number, locale: string): string {
  const parts = countdownParts(targetMs, nowMs);
  if (!parts) return "0 min";
  const values = [
    [parts.days, "day"],
    [parts.hours, "hour"],
    [parts.minutes, "minute"],
  ] as const;
  return values
    .filter(([value]) => value > 0)
    .slice(0, 2)
    .map(([value, unit]) => new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short" }).format(value))
    .join(" ");
}

function itineraryMapUrl(item: ItineraryItem): string {
  if (item.mapUrl && isTrustedGoogleMapsUrl(item.mapUrl)) return item.mapUrl;
  const query = item.locationName || item.title;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function endpointMapUrl(locationName: string, mapUrl: string | null): string {
  if (mapUrl && isTrustedGoogleMapsUrl(mapUrl)) return mapUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName)}`;
}

function countLabel(count: number, one: string, many: string): string {
  return formatMessage(count === 1 ? one : many, { count });
}

function addCalendarDays(dateKey: string, days: number): string {
  const value = new Date(`${dateKey}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function maximumTripEndDate(startsOn: string): string {
  return addCalendarDays(startsOn, 365);
}

export function tripEndDateIsWithinBounds(value: string, minimum: string, maximum: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && value >= minimum
    && value <= maximum;
}

function countLabelWithPending(
  confirmedCount: number,
  pendingCount: number,
  one: string,
  many: string,
  messages: Messages,
): string {
  const confirmed = countLabel(confirmedCount, one, many);
  return pendingCount
    ? `${confirmed} · ${countLabel(pendingCount, messages.pendingEventCountOne, messages.pendingEventCountMany)}`
    : confirmed;
}

export function aiProposalOutcomeMessage(
  result: Pick<AiPlannerResponse, "proposalCount" | "proposalIds" | "proposalId" | "changeStatus">,
  messages: Messages,
): string {
  const proposalCount = Number.isInteger(result.proposalCount) && result.proposalCount >= 0
    ? result.proposalCount
    : result.proposalIds?.length ?? (result.proposalId ? 1 : 0);
  if (result.changeStatus === "approved") return messages.aiPlanApplied;
  if (result.changeStatus === "pending") {
    return proposalCount > 1
      ? formatMessage(messages.aiApprovalBatchCreated, { count: proposalCount })
      : messages.aiApprovalCreated;
  }
  return "";
}

export function aiRequestFailureMessage(error: unknown, messages: Messages, imageCopy?: AiImageMessages, presentation?: AiFailurePresentationOptions): string {
  if (!(error instanceof JsonRequestError)) {
    if (error instanceof TypeError
        && /(?:failed to fetch|networkerror|network request failed|load failed)/iu.test(error.message)) {
      return messages.aiNetworkFailed;
    }
    return messages.aiRequestFailed;
  }
  if (error.status === 401) return messages.aiSessionExpired;
  if (error.status === 403) {
    if (/^AI is disabled for this trip\.?$/iu.test(error.message)) return messages.aiUnavailable;
    return /^Request failed \(403\)$/u.test(error.message) ? messages.aiRequestDenied : error.message;
  }
  const code = error.code?.toUpperCase();
  const providerMessage = presentation && aiProviderFailureMessage({ errorCode: code, providerFailure: error.providerFailure }, presentation);
  if (providerMessage) return providerMessage;
  if (code?.startsWith("AI_IMAGE_") || error.validationPaths.some((path) => path.split(".")[0] === "images")) {
    return imageCopy?.requestFailed ?? messages.aiRequestFailed;
  }
  if (code === "AI_SEARCH_EVIDENCE_MISSING"
      || (error.status === 409 && /^Live place search was required, but the AI returned no search evidence\./u.test(error.message))) {
    return messages.aiSearchEvidenceMissing;
  }
  if (code === "AI_INVALID_PROPOSAL" || code === "INVALID_AI_PROPOSAL" || code === "AI_PROPOSAL_INVALID") {
    return messages.aiInvalidProposal;
  }
  const requestFields = new Set(["prompt", "model", "locale", "clientRequestId", "conversationId", "images"]);
  if (error.validationPaths.some((path) => !requestFields.has(path.split(".")[0] ?? ""))) {
    return messages.aiInvalidProposal;
  }
  if (error.status === 409 && /^(?:AI proposal \d+|The AI (?:proposal|response|returned))/iu.test(error.message)) {
    return messages.aiInvalidProposal;
  }
  if (error.status === 409 && /another AI request is already being processed/iu.test(error.message)) {
    return messages.aiConversationBusy;
  }
  if (error.status === 409 && /active AI conversation changed/iu.test(error.message)) {
    return messages.aiConversationChanged;
  }
  if (error.status === 400 && error.validationPaths.some((path) => path === "prompt")) {
    return messages.aiPromptInvalid;
  }
  if ([502, 503, 504].includes(error.status)) return messages.aiServiceUnavailable;
  return messages.aiRequestFailed;
}

export function aiRecoveryStatusMessage(state: AiRecoveryState, messages: Messages): string | null {
  if (state.phase === "checking") return messages.aiRestoringRequest;
  if (state.phase === "running") return messages.aiProcessingInBackground;
  if (state.phase === "reconnecting") return messages.aiReconnectingRequest;
  if (state.phase === "busy_elsewhere") return messages.aiBusyInAnotherTrip;
  return null;
}

export function aiRecoveryReply(state: AiRecoveryState, messages: Messages, imageCopy?: AiImageMessages, presentation?: AiFailurePresentationOptions): string | null {
  if (state.result) {
    return [state.result.message, aiProposalOutcomeMessage(state.result, messages)].filter(Boolean).join(" ");
  }
  if (state.request?.status === "interrupted") return messages.aiRequestInterrupted;
  if (state.request?.status === "failed") {
    const code = state.request.errorCode ?? "";
    const providerMessage = presentation && aiProviderFailureMessage(state.request, presentation);
    if (providerMessage) return providerMessage;
    if (code.toUpperCase().startsWith("AI_IMAGE_")) return imageCopy?.requestFailed ?? messages.aiRequestFailed;
    if (/abort|timeout|deadline/iu.test(code)) return messages.aiRequestTimedOut;
    if (/search.*evidence/iu.test(code)) return messages.aiSearchEvidenceMissing;
    if (/invalid.*proposal|validation|zod/iu.test(code)) return messages.aiInvalidProposal;
    return messages.aiRequestFailed;
  }
  if (state.request?.status === "succeeded") return state.request.message;
  return state.error ? aiRequestFailureMessage(state.error, messages, imageCopy, presentation) : null;
}

function eventStatusLabel(status: string, messages: Messages): string {
  if (status === "cancelled") return messages.eventStatusCancelled;
  return messages.eventStatusPlanned;
}

function eventTypeLabel(type: string, messages: Messages): string {
  const labels: Record<string, string> = {
    activity: messages.eventTypeActivity,
    meal: messages.eventTypeMeal,
    transport: messages.eventTypeTransport,
    lodging: messages.eventTypeLodging,
    note: messages.eventTypeNote,
  };
  return labels[type] ?? type;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await withStableSession(() => fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })).catch((error: unknown) => { feedbackTrail.record("request_error"); throw error; });
  const body = await response.json().catch(() => ({})) as {
    error?: unknown;
    code?: unknown;
    errorCode?: unknown;
    issues?: unknown;
    providerFailure?: unknown;
  } & T;
  if (!response.ok) {
    feedbackTrail.record("request_error");
    if (response.status === 401) clearFeedbackContext();
    const message = typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
    const code = typeof body.code === "string"
      ? body.code
      : typeof body.errorCode === "string" ? body.errorCode : null;
    const validationPaths = Array.isArray(body.issues)
      ? body.issues.map((issue) => {
        if (!issue || typeof issue !== "object" || !Array.isArray((issue as { path?: unknown }).path)) return "$";
        const path = (issue as { path: unknown[] }).path
          .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
          .map(String)
          .join(".");
        return path || "$";
      })
      : [];
    throw new JsonRequestError(message, response.status, code, validationPaths, parseAiProviderFailureDetails(body.providerFailure));
  }
  return body;
}

export function mergeApprovalHistory(
  current: ApprovalRequest[],
  incoming: ApprovalRequest[],
): ApprovalRequest[] {
  const requests = new Map(current.map((request) => [request.id, request]));
  for (const request of incoming) requests.set(request.id, request);
  const pending: ApprovalRequest[] = [];
  const history: ApprovalRequest[] = [];
  // Preserve server order within each group, including timestamp microseconds.
  for (const request of requests.values()) {
    (request.status === "pending" && !request.reviewBlockedReason ? pending : history).push(request);
  }
  return [...pending, ...history];
}

function LoadingPanel({ error, retry }: { error: string | null; retry: () => void }) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Image className="auth-logo" src="/stardust-mark.png" alt="" width={96} height={96} priority />
        <h1>Stardust Itinerary</h1>
        {error ? (
          <>
            <p>{error}</p>
            <div className="dialog-actions">
              <button className="auth-secondary" onClick={retry}><RefreshCw size={16} /> Retry</button>
              <Link className="auth-primary" href="/auth/sign-in">Sign in with Google</Link>
            </div>
          </>
        ) : <p>Loading your private trip…</p>}
      </section>
    </main>
  );
}

function offlineLocationUrl(locationName: string, mapUrl: string | null): string {
  if (mapUrl && isTrustedGoogleMapsUrl(mapUrl)) return mapUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName)}`;
}

function OfflineItineraryPanel({
  snapshot,
  locale,
  messages,
  retry,
}: {
  snapshot: OfflineItinerarySnapshot;
  locale: Locale;
  messages: Messages;
  retry: () => void;
}) {
  const days = useMemo(() => [...snapshot.days], [snapshot.days]);
  const [selectedDayId, setSelectedDayId] = useState(() => (
    pickCurrentTripDay(days, snapshot.trip.timeZone)?.id ?? days[0]!.id
  ));
  const offlineSwipeStart = useRef<{ x: number; y: number } | null>(null);

  const selectedDayIndex = Math.max(0, days.findIndex((day) => day.id === selectedDayId));
  const selectedDay = days[selectedDayIndex]!;
  const points = useMemo(() => projectTimelinePoints(snapshot.itinerary, {
    tripDays: days,
    timeZone: snapshot.trip.timeZone,
  }).filter((point) => point.tripDayId === selectedDay.id), [days, selectedDay.id, snapshot.itinerary, snapshot.trip.timeZone]);
  const moveDay = (offset: -1 | 1) => {
    const nextDay = days[selectedDayIndex + offset];
    if (nextDay) setSelectedDayId(nextDay.id);
  };
  const finishSwipe = (clientX: number, clientY: number) => {
    const start = offlineSwipeStart.current;
    offlineSwipeStart.current = null;
    if (!start) return;
    const horizontalDistance = clientX - start.x;
    const verticalDistance = clientY - start.y;
    if (Math.abs(horizontalDistance) < 54 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) return;
    moveDay(horizontalDistance < 0 ? 1 : -1);
  };

  return (
    <div className="offline-itinerary-page">
      <DocumentLanguage locale={locale} />
      <header className="offline-itinerary-topbar">
        <div className="brand-lockup">
          <div className="stand-mark"><Image src="/stardust-mark.png" alt="" width={42} height={42} priority /></div>
          <div><p className="brand-name">{messages.appName}</p><p className="brand-subtitle">STARDUST ITINERARY</p></div>
        </div>
        <div className="offline-topbar-actions"><UiModeToggle locale={locale} /><LocaleSwitcher locale={locale} /></div>
      </header>
      <main className="offline-itinerary-content">
        <section className="offline-status-card" role="status">
          <div><p className="eyebrow">{messages.offlineModeTitle}</p><h1>{snapshot.trip.name}</h1><p>{messages.offlineModeDescription}</p></div>
          <button className="primary-button fit-button" onClick={retry}><RefreshCw size={16} /> {messages.retryLiveApp}</button>
        </section>
        <section
          className="offline-day-card"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            offlineSwipeStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const touch = event.changedTouches[0];
            if (touch) finishSwipe(touch.clientX, touch.clientY);
          }}
          onTouchCancel={() => { offlineSwipeStart.current = null; }}
        >
          <div className="offline-day-heading">
            <div aria-live="polite"><p className="eyebrow">{snapshot.trip.destinationName} · {snapshot.trip.timeZone}</p><h2>{formatTripDay(selectedDay.date, locale)}</h2><small>{selectedDay.label ? `${selectedDay.label} · ` : ""}{formatMessage(messages.offlineDayPosition, { current: selectedDayIndex + 1, total: days.length })}</small></div>
            <div className="offline-day-navigation">
              <button className="ghost-button" disabled={selectedDayIndex <= 0} onClick={() => moveDay(-1)} aria-label={messages.previousDay}><ChevronLeft size={17} /><span>{messages.previousDay}</span></button>
              <label className="offline-day-picker"><span className="sr-only">{messages.offlineChooseDay}</span><select value={selectedDay.id} onChange={(event) => setSelectedDayId(event.target.value)} aria-label={messages.offlineChooseDay}>{days.map((day) => <option value={day.id} key={day.id}>{formatTripDay(day.date, locale)}{day.label ? ` · ${day.label}` : ""}</option>)}</select></label>
              <button className="ghost-button" disabled={selectedDayIndex >= days.length - 1} onClick={() => moveDay(1)} aria-label={messages.nextDay}><span>{messages.nextDay}</span><ChevronRight size={17} /></button>
            </div>
          </div>
          <p className="offline-swipe-hint"><ChevronLeft size={14} /> {messages.swipeDay} <ChevronRight size={14} /></p>
          <small className="offline-saved-at">{formatMessage(messages.offlineSavedAt, { date: formatDateTime(snapshot.savedAt, locale, snapshot.trip.timeZone) })}</small>
          <p className="offline-private-note"><Lock size={15} /> {formatMessage(messages.offlinePrivateDeviceNotice, { name: snapshot.session.displayName })}</p>
          <div className="offline-event-list">
            {points.length ? points.map((point) => (
              <article className="offline-event-card" key={point.key}>
                <div className="offline-event-time"><Clock3 size={16} /><strong>{point.at ? formatTime(point.at, locale, snapshot.trip.timeZone) : messages.timeNotSet}</strong></div>
                <div className="offline-event-copy"><h3>{point.item.title}</h3><small>{point.kind === "departure" ? messages.departureLabel : point.kind === "arrival" ? messages.destinationLabel : eventTypeLabel(point.item.itemType, messages)} · {eventStatusLabel(point.item.status, messages)}</small></div>
                {point.locationName ? <a className="offline-location-link" href={offlineLocationUrl(point.locationName, point.mapUrl)} target="_blank" rel="noreferrer"><MapPin size={15} /><span>{point.locationName}</span></a> : null}
              </article>
            )) : <p className="empty-state">{messages.noOfflineEvents}</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

const TRIP_DELETED_NOTICE_KEY = "stardust.trip-deleted-notice";

function Modal({ title, children, close, closeLabel = "Close" }: { title: string; children: React.ReactNode; close: () => void; closeLabel?: string }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label={closeLabel}><X size={18} /></button></div>
        {children}
      </section>
    </div>
  );
}

export function AppShell({ locale, messages }: { locale: Locale; messages: Messages }) {
  const router = useRouter();
  const memberCopy = memberManagementMessages(locale);
  const keysCopy = aiKeysMessages(locale);
  const advancedCopy = advancedSettingsMessages(locale);
  const eventEditorCopy = eventEditorMessages(locale);
  const expensePageCopy = expensePageMessages(locale);
  const cardCopy = mobileCardsMessages(locale);
  const paymentCopy = memberPaymentMessages(locale);
  const cardMutationPending = useRef(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  // Sharing AI keys (JOB-063) needs at least one key of the owner's own.
  const ownKeysToShare = (overview?.ai.ownKeyProviders?.length ?? 0) > 0;
  const [offlineSnapshot, setOfflineSnapshot] = useState<OfflineItinerarySnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [section, updateSection] = useState<Section>("today");
  const instructionsDirty = useRef(false);
  const instructionsDirtyChanged = useCallback((dirty: boolean) => { instructionsDirty.current = dirty; }, []);
  const confirmInstructionsLeave = useCallback(() => !instructionsDirty.current || window.confirm(aiInstructionsMessages(locale).leaveConfirm), [locale]);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalRequest[]>([]);
  const [approvalHistoryNextCursor, setApprovalHistoryNextCursor] = useState<string | null>(null);
  const [approvalHistoryTripId, setApprovalHistoryTripId] = useState<string | null>(null);
  const [approvalHistoryLoading, setApprovalHistoryLoading] = useState(false);
  const [approvalHistoryError, setApprovalHistoryError] = useState<string | null>(null);
  const approvalHistoryRequestId = useRef(0);
  const approvalHistoryOpenTripId = useRef<string | null>(null);
  const approvalHistoryKnownTripId = useRef<string | null>(null);
  const approvalHistoryObservedPendingCount = useRef<number | null>(null);
  const [selectedOverviewDate, setSelectedOverviewDate] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const setSection = useCallback((next: Section) => {
    if (next !== "settings" && !confirmInstructionsLeave()) return;
    setNowMs(Date.now()); updateSection(next);
  }, [confirmInstructionsLeave]);
  const overviewSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const [editingItem, setEditingItem] = useState<EventEditorTarget | null>(null);
  const [pendingEventLoadingId, setPendingEventLoadingId] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [eventSaveError, setEventSaveError] = useState<string | null>(null);
  const eventSaveInFlight = useRef(false);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [expenseFormError, setExpenseFormError] = useState<string | null>(null);
  const expenseSavePending = useRef(false);
  const expenseOriginal = useRef<Overview["expenses"][number] | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<PaymentDialog | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentLocked, setPaymentLocked] = useState(false);
  const paymentInFlight = useRef(false);
  const paymentAttempt = useRef<PaymentAttempt | null>(null);
  const paymentScope = overview ? `${overview.trip.id}:${overview.session.memberId}` : null;
  const paymentScopeRef = useRef(paymentScope);
  useEffect(() => { paymentScopeRef.current = paymentScope; return () => { paymentScopeRef.current = null; }; }, [paymentScope]);
  const itineraryGroupsRef = useRef<DayGroupsHandle>(null);
  const expenseGroupsRef = useRef<DayGroupsHandle>(null);
  const [activityOpeningId, setActivityOpeningId] = useState<string | null>(null);
  const [activityAccessLost, setActivityAccessLost] = useState(false);
  const [activityDetail, setActivityDetail] = useState<{ scope: string; request: ApprovalRequest } | null>(null);
  const activityRequestGeneration = useRef(0);
  const [calendarRead, setCalendarRead] = useState<{ scope: string; state: CalendarState } | null>(null);
  const calendarScope = overview?.calendar.connected && overview.permissions.canSyncCalendar ? `${overview.trip.id}:${overview.session.memberId}` : null;
  const calendarScopeRef = useRef(calendarScope);
  const calendarReadGeneration = useRef(0);
  const calendarActionGeneration = useRef(0);
  const calendarState = calendarRead?.scope === calendarScope ? calendarRead.state : null;
  const [calendarImport, setCalendarImport] = useState<{ scope: string; eventId: string } | null>(null);
  const [calendarImportBusy, setCalendarImportBusy] = useState(false);
  const calendarImportSaving = useRef(false);
  useEffect(() => { calendarScopeRef.current = calendarScope; return () => { calendarScopeRef.current = null; }; }, [calendarScope]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarOAuthResult, setCalendarOAuthResult] = useState<"connected" | "error" | null>(null);
  const [calendarConnectIntent, setCalendarConnectIntent] = useState<PendingCalendarSync | null>(null);
  const calendarResumeStarted = useRef(false);
  const [calendarConfirmation, setCalendarConfirmation] = useState<CalendarSyncConfirmation | null>(null);
  const [calendarOpeningUrl, setCalendarOpeningUrl] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiRecovery, setAiRecovery] = useState<{ scope: string; value: AiRecoveryState; observedAt: number } | null>(null);
  const [aiClock, setAiClock] = useState(() => Date.now());
  const [quickAiScope, setQuickAiScope] = useState<string | null>(null);
  const aiRecoveryClient = useRef<AiRequestRecoveryClient | null>(null);
  const [aiConversationResetOpen, setAiConversationResetOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_OWNER_MODEL);
  // A per-request choice of a model that runs on the user's own key; "" leaves it to the server.
  const [ownKeyChoice, setOwnKeyChoice] = useState("");
  const [tripSettings, setTripSettings] = useState<TripSettingsDraft | null>(null);
  const tripSettingsSaving = useRef(false);
  const tripSettingsScopeRef = useRef<string | null>(null);
  const [memberClaimLinks, setMemberClaimLinks] = useState<Record<string, string>>({});
  const [tripJoinLink, setTripJoinLink] = useState<string | null>(null);
  const [inviteToast, setInviteToast] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState<string | null>(null);
  // The invite checkboxes for sharing the owner's AI keys (JOB-063); both start unchecked.
  const [newMemberShareKeys, setNewMemberShareKeys] = useState(false);
  const [joinLinkShareKeys, setJoinLinkShareKeys] = useState(false);
  const [memberPendingDisable, setMemberPendingDisable] = useState<{ id: string; displayName: string } | null>(null);
  const [memberRemoval, setMemberRemoval] = useState<{
    scope: string; member: Overview["members"][number]; preview: MemberRemovalPreview | null; loading: boolean; error: string | null;
  } | null>(null);
  const memberRemovalRequestId = useRef(0);
  const memberAdminScope = overview?.session.isOwner ? `${overview.trip.id}:${overview.session.memberId}` : null;
  const memberAdminScopeRef = useRef(memberAdminScope);
  const tripDeletionCopy = tripDeletionMessages(locale);
  const tripDeletionRequestId = useRef(0);
  const [tripDeletion, setTripDeletion] = useState<{ scope: string; preview: TripDeletionPreview | null; loading: boolean; error: string | null; uncertain?: boolean } | null>(null);
  const feedbackTripId = overview?.trip.id;
  const feedbackMemberId = overview?.session.memberId;
  useEffect(() => {
    if (feedbackTripId && feedbackMemberId && !activityAccessLost) {
      announceFeedbackContext({ tripId: feedbackTripId, memberId: feedbackMemberId, page: section, locale });
    }
  }, [feedbackTripId, feedbackMemberId, section, locale, activityAccessLost]);
  useEffect(() => {
    memberAdminScopeRef.current = memberAdminScope;
    activityRequestGeneration.current += 1;
    const timer = window.setTimeout(() => { setActivityOpeningId(null); setActivityDetail(null); }, 0);
    return () => { memberAdminScopeRef.current = null; window.clearTimeout(timer); };
  }, [memberAdminScope]);
  const [profileName, setProfileName] = useState("");
  const [memberDailyLimit, setMemberDailyLimit] = useState("20");
  const [disruptionDetailItem, setDisruptionDetailItem] = useState<ItineraryItem | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() => (
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  ));

  const overviewRevalidation = useMemo(() => createRevalidationCoordinator(
    () => jsonRequest<Overview>("/api/app/overview", { cache: "no-store" }),
  ), []);

  const refresh = useCallback(async ({
    mode = "fresh",
    syncDrafts = true,
  }: { mode?: RevalidationMode; syncDrafts?: boolean } = {}) => {
    setLoadError(null);
    const result = await overviewRevalidation.run(mode);
    if (!result.isLatest) return;
    if (!result.ok) {
      const fallbackFailure = result.error instanceof JsonRequestError
        ? { kind: "http-error" as const, status: result.error.status }
        : { kind: "network-error" as const };
      if (isOfflineFallbackEligible(fallbackFailure)) {
        const cached = loadLastOfflineItinerarySnapshot();
        if (cached) {
          setOfflineSnapshot(cached);
          setLoadError(null);
          return;
        }
      }
      if (result.error instanceof JsonRequestError && [401, 403].includes(result.error.status)) {
        tripSettingsScopeRef.current = null;
        setTripSettings(null);
        clearFeedbackContext();
        activityRequestGeneration.current += 1;
        setActivityDetail(null); setActivityAccessLost(true); setActivityOpeningId(null);
        calendarScopeRef.current = null;
        calendarReadGeneration.current += 1; calendarActionGeneration.current += 1;
        setCalendarRead(null); setCalendarImport(null); setCalendarConfirmation(null);
        memberRemovalRequestId.current += 1;
        memberAdminScopeRef.current = null;
        setMemberRemoval(null);
        setMemberPendingDisable(null);
        tripDeletionRequestId.current += 1;
        setTripDeletion(null);
      }
      setLoadError(result.error instanceof Error ? result.error.message : "Unable to load the trip.");
      return;
    }

    const data = result.value;
    const nextCalendarScope = data.calendar.connected && data.permissions.canSyncCalendar ? `${data.trip.id}:${data.session.memberId}` : null;
    if (calendarScopeRef.current !== nextCalendarScope) {
      calendarReadGeneration.current += 1; calendarActionGeneration.current += 1;
      setCalendarRead(null); setCalendarBusy(false); setCalendarImport(null); setCalendarImportBusy(false); setCalendarConfirmation(null);
      calendarImportSaving.current = false;
    }
    if (!data.permissions.canEditItinerary) {
      setCalendarImport(null); setCalendarImportBusy(false); calendarImportSaving.current = false;
    }
    calendarScopeRef.current = nextCalendarScope;
    memberAdminScopeRef.current = data.session.isOwner ? `${data.trip.id}:${data.session.memberId}` : null;
    tripSettingsScopeRef.current = data.session.isOwner ? tripSettingsScope(data) : null;
    setTripSettings((current) => reconcileTripSettingsDraft(current, data, syncDrafts));
    setOfflineSnapshot(null);
    setOverview(data);
    setActivityAccessLost(false);
    setSelectedOverviewDate((current) => data.days.some((day) => day.date === current)
      ? current
      : pickCurrentTripDay(data.days, data.trip.timeZone)?.date ?? null);
    if (syncDrafts) {
      setSelectedModel(data.ai.ownerDefaultModel);
      setProfileName(data.session.displayName);
      setMemberDailyLimit(String(data.ai.memberDailyLimit));
    }
    if (!data.trip.joinLinkActive) setTripJoinLink(null);
    setMemberClaimLinks((current) => Object.fromEntries(
      Object.entries(current).filter(([memberId]) => data.members.some(
        (member) => member.id === memberId && member.status === "invited" && !member.identityBound,
      )),
    ));
    return data;
  }, [overviewRevalidation, setCalendarRead, setCalendarImport, setCalendarImportBusy, setCalendarConfirmation]);

  const aiScope = overview ? `${overview.trip.id}:${overview.session.memberId}` : null;
  const aiTripId = overview?.trip.id ?? null;
  const aiState: AiRecoveryState = aiRecovery?.scope === aiScope
    ? aiRecovery.value
    : { phase: "checking", request: null, result: null, error: null };
  const aiThinking = aiState.phase !== "idle";
  const aiStatusText = aiRecoveryStatusMessage(aiState, messages);
  const aiReply = aiRecoveryReply(aiState, messages, aiImageMessages(locale), { locale, timeZone: overview?.trip.timeZone ?? "UTC", isOwner: overview?.session.isOwner ?? false });
  const aiSources = aiState.result?.webSearch.sources.slice(0, 5) ?? [];
  const aiMemory = aiState.result?.memory ?? null;
  // The quick composer forgets an idle answer after ten minutes, and the next
  // quick question starts a new conversation (D-082). History keeps everything.
  const aiObservedAt = aiRecovery?.scope === aiScope ? aiRecovery.observedAt : null;
  const aiQuickReplyGone = aiQuickReplyExpired(aiState, aiObservedAt, Math.max(aiClock, aiObservedAt ?? 0));
  const aiQuickReplyTime = aiThinking || aiQuickReplyGone ? null : aiQuickReplyAt(aiState, aiObservedAt);
  const quickAiOpen = quickAiScope !== null && quickAiScope === aiScope;
  const aiHistoryCopy = aiHistoryMessages(locale);
  const instructionsCopy = aiInstructionsMessages(locale);
  const aiImages = useAiImageDraft(aiScope);
  const clearAiImages = aiImages.clear;

  useEffect(() => {
    if (!aiScope || !aiTripId) return;
    const client = createAiRequestRecoveryClient({
      uuid: () => crypto.randomUUID(),
      load: async (clientRequestId) => {
        const abort = new AbortController();
        const timeout = window.setTimeout(() => abort.abort(), 15_000);
        try {
          const query = clientRequestId ? `?clientRequestId=${encodeURIComponent(clientRequestId)}` : "";
          return await jsonRequest<AiRequestRecoveryResponse>(`/api/trips/${aiTripId}/ai${query}`, {
            cache: "no-store", signal: abort.signal,
          });
        } finally { window.clearTimeout(timeout); }
      },
      submit: async (input) => {
        const abort = new AbortController();
        const timeout = window.setTimeout(() => abort.abort(), aiRequestDeliveryTimeoutMs(Boolean(input.images?.length)));
        try {
          return await jsonRequest<AiPlannerResult | AiRequestRecoveryResponse>(`/api/trips/${aiTripId}/ai`, {
            method: "POST", body: JSON.stringify(input), signal: abort.signal,
          });
        } finally { window.clearTimeout(timeout); }
      },
      changed: (value) => {
        const status = value.error && typeof value.error === "object" && "status" in value.error ? value.error.status : null;
        if (status === 401 || status === 403) clearAiImages();
        setAiRecovery({ scope: aiScope, value, observedAt: Date.now() });
      },
      completed: () => {
        setAiPrompt("");
        clearAiImages();
        void refresh({ syncDrafts: false });
      },
    });
    aiRecoveryClient.current = client;
    const stopWatching = watchAiRequestRecovery({
      check: () => client.check(), visible: () => document.visibilityState === "visible", document, window,
      active: () => client.getState().phase !== "idle",
    });
    return () => {
      stopWatching();
      client.dispose();
      if (aiRecoveryClient.current === client) aiRecoveryClient.current = null;
    };
  }, [aiScope, aiTripId, refresh, clearAiImages]);

  useEffect(() => {
    if (aiQuickReplyTime === null) return;
    const tick = () => setAiClock(Date.now());
    const timer = window.setTimeout(tick, Math.max(0, aiQuickReplyTime + AI_QUICK_REPLY_TTL_MS - Date.now()) + 250);
    // Phone browsers pause timers in the background; check again on return.
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [aiQuickReplyTime]);

  const loadApprovalHistory = useCallback(async (mode: "reset" | "more" = "reset") => {
    if (!overview?.session.isOwner) return;
    const tripId = overview.trip.id;
    const cursor = mode === "more" && approvalHistoryTripId === tripId
      ? approvalHistoryNextCursor
      : null;
    if (mode === "more" && !cursor) return;

    const requestId = ++approvalHistoryRequestId.current;
    setApprovalHistoryLoading(true);
    setApprovalHistoryError(null);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page = await jsonRequest<ApprovalHistoryPage>(
        `/api/trips/${tripId}/change-requests${query}`,
        { cache: "no-store" },
      );
      if (requestId !== approvalHistoryRequestId.current) return;
      setApprovalHistory((current) => mode === "more" && approvalHistoryTripId === tripId
        ? mergeApprovalHistory(current, page.requests)
        : page.requests);
      setApprovalHistoryNextCursor(page.nextCursor);
      setApprovalHistoryTripId(tripId);
      approvalHistoryObservedPendingCount.current = overview.approvalPendingCount;
    } catch (error) {
      if (requestId !== approvalHistoryRequestId.current) return;
      setApprovalHistoryError(error instanceof Error ? error.message : messages.approvalHistoryLoadFailed);
    } finally {
      if (requestId === approvalHistoryRequestId.current) setApprovalHistoryLoading(false);
    }
  }, [approvalHistoryNextCursor, approvalHistoryTripId, messages.approvalHistoryLoadFailed, overview]);

  useEffect(() => {
    const tripId = overview?.trip.id ?? null;
    if (approvalHistoryKnownTripId.current === tripId) return;
    approvalHistoryKnownTripId.current = tripId;
    approvalHistoryRequestId.current += 1;
    approvalHistoryOpenTripId.current = null;
    approvalHistoryObservedPendingCount.current = null;
    setApprovalHistory([]);
    setApprovalHistoryNextCursor(null);
    setApprovalHistoryTripId(null);
    setApprovalHistoryLoading(false);
    setApprovalHistoryError(null);
  }, [overview?.trip.id]);

  useEffect(() => {
    if (section !== "requests" || !overview?.session.isOwner) {
      approvalHistoryOpenTripId.current = null;
      return;
    }
    if (approvalHistoryOpenTripId.current === overview.trip.id) return;
    approvalHistoryOpenTripId.current = overview.trip.id;
    void loadApprovalHistory("reset");
  }, [loadApprovalHistory, overview?.session.isOwner, overview?.trip.id, section]);

  useEffect(() => {
    if (
      section !== "requests"
      || !overview?.session.isOwner
      || approvalHistoryTripId !== overview.trip.id
      || approvalHistoryObservedPendingCount.current === null
      || approvalHistoryObservedPendingCount.current === overview.approvalPendingCount
      || approvalHistoryLoading
    ) return;
    approvalHistoryObservedPendingCount.current = overview.approvalPendingCount;
    void loadApprovalHistory("reset");
  }, [approvalHistoryLoading, approvalHistoryTripId, loadApprovalHistory, overview?.approvalPendingCount, overview?.session.isOwner, overview?.trip.id, section]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const weatherTripId = overview?.trip.id ?? null;
  useEffect(() => {
    if (!weatherTripId) return;
    let cancelled = false;
    let requestInFlight = false;
    let lastRequestedAt = 0;
    const revalidationTimers = new Set<number>();
    const triggerWeatherRefresh = () => {
      if (document.visibilityState !== "visible") return;
      const requestedAt = Date.now();
      if (requestInFlight || requestedAt - lastRequestedAt < 5_000) return;
      requestInFlight = true;
      lastRequestedAt = requestedAt;
      void jsonRequest<{ status: "scheduled" }>(`/api/trips/${weatherTripId}/weather/refresh`, {
        method: "POST",
        body: "{}",
      }).then(() => {
        if (cancelled) return;
        for (const timer of revalidationTimers) window.clearTimeout(timer);
        revalidationTimers.clear();
        for (const delay of [4_000, 12_000, 25_000]) {
          const timer = window.setTimeout(() => {
            revalidationTimers.delete(timer);
            if (!cancelled) void refresh({ mode: "passive", syncDrafts: false });
          }, delay);
          revalidationTimers.add(timer);
        }
      }).catch(() => {
        // Weather is best-effort. A cached forecast remains visible when refresh fails.
      }).finally(() => {
        requestInFlight = false;
      });
    };
    triggerWeatherRefresh();
    const timer = window.setInterval(triggerWeatherRefresh, weatherRefreshCheckIntervalMs);
    window.addEventListener("focus", triggerWeatherRefresh);
    document.addEventListener("visibilitychange", triggerWeatherRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const revalidationTimer of revalidationTimers) window.clearTimeout(revalidationTimer);
      revalidationTimers.clear();
      window.removeEventListener("focus", triggerWeatherRefresh);
      document.removeEventListener("visibilitychange", triggerWeatherRefresh);
    };
  }, [refresh, weatherTripId]);

  const overviewLoaded = Boolean(overview);
  useEffect(() => {
    if (!overviewLoaded) return;
    let deleted = false;
    try {
      deleted = window.sessionStorage.getItem(TRIP_DELETED_NOTICE_KEY) === "1";
      window.sessionStorage.removeItem(TRIP_DELETED_NOTICE_KEY);
    } catch { /* the notice is optional */ }
    if (!deleted) return;
    const timer = window.setTimeout(() => setNotice(tripDeletionCopy.deleted), 0);
    return () => window.clearTimeout(timer);
  }, [overviewLoaded, tripDeletionCopy.deleted]);

  useEffect(() => {
    if (!overview) return;
    replaceOfflineItinerarySnapshot({
      session: overview.session,
      trip: overview.trip,
      days: overview.days,
      visibleItinerary: overview.itinerary,
    });
  }, [overview]);

  useEffect(() => {
    if (!overview) return;
    let cancelled = false;
    void notifyBrowserDisruptions({
      tripId: overview.trip.id,
      memberId: overview.session.memberId,
      warnings: overview.itinerary.flatMap((item) => (
        item.visibility === "trip" && item.disruption
          ? [{ id: item.id, title: item.title, disruption: item.disruption }] : []
      )),
      title: messages.disruptionNotificationTitle,
      body: (item) => formatMessage(messages.disruptionNotificationBody, {
        event: item.title,
        reason: disruptionReasonLabel(item.disruption.reasonCode, messages),
      }),
      url: `/${locale}`,
      isCurrent: () => !cancelled,
    });
    return () => { cancelled = true; };
  }, [locale, messages, notificationPermission, overview]);

  useEffect(() => {
    const revalidateVisiblePage = () => {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now());
        void refresh({ mode: "passive", syncDrafts: false });
      }
    };
    const timer = window.setInterval(revalidateVisiblePage, passiveRevalidationIntervalMs);
    window.addEventListener("focus", revalidateVisiblePage);
    document.addEventListener("visibilitychange", revalidateVisiblePage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", revalidateVisiblePage);
      document.removeEventListener("visibilitychange", revalidateVisiblePage);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!inviteToast) return;
    const timer = window.setTimeout(() => setInviteToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [inviteToast]);

  useEffect(() => {
    if (!calendarOpeningUrl) return;
    return scheduleCalendarNavigation(
      calendarOpeningUrl,
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
      (url) => window.location.assign(url),
    );
  }, [calendarOpeningUrl]);

  useEffect(() => {
    const clearCalendarOpeningState = () => setCalendarOpeningUrl(null);
    window.addEventListener("pageshow", clearCalendarOpeningState);
    return () => window.removeEventListener("pageshow", clearCalendarOpeningState);
  }, []);

  useEffect(() => {
    const calendarResult = new URLSearchParams(window.location.search).get("calendar");
    if (!calendarResult) return;
    const timer = window.setTimeout(() => {
      const result = calendarResult === "connected" ? "connected" : "error";
      setCalendarOAuthResult(result);
      if (result === "error") sessionStorage.removeItem(pendingCalendarSyncStorageKey);
      setNotice(calendarResult === "connected"
        ? messages.calendarConnectedFinishing
        : messages.calendarConnectionFailed);
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [messages.calendarConnectedFinishing, messages.calendarConnectionFailed]);

  const navItems = overview ? [
    { id: "today" as const, label: messages.today, icon: CalendarDays },
    { id: "itinerary" as const, label: messages.itinerary, icon: Route },
    { id: "expenses" as const, label: messages.expenses, icon: ReceiptText },
    { id: "ai" as const, label: aiHistoryCopy.tab, icon: Bot },
    ...(overview.session.isOwner ? [
      { id: "requests" as const, label: formatMessage(messages.approvalRequestsNav, { count: overview.approvalPendingCount }), icon: Check },
    ] : []),
    { id: "settings" as const, label: messages.settings, icon: Settings },
  ] : [];

  const openEvent = (item: ItineraryItem | "new", preferredDate?: string) => {
    if (!overview || eventSaveInFlight.current) return;
    setEventSaveError(null);
    const currentTripDay = overview.days.find((day) => day.date === preferredDate)
      ?? pickCurrentTripDay(overview.days, overview.trip.timeZone);
    const defaultStart = currentTripDay
      ? (tripLocalDateKey(new Date(), overview.trip.timeZone) === currentTripDay.date
        ? inputDateTime(new Date().toISOString(), overview.trip.timeZone)
        : `${currentTripDay.date}T09:00`)
      : "";
    const expenseSelection = eventExpenseDefaults(overview.members, item === "new" ? {
      createdByMemberId: overview.session.memberId, visibility: "trip", viewerMemberIds: [],
    } : item, overview.session.memberId);
    const emptyLinkedExpense = {
      enabled: false,
      description: "",
      amount: "",
      currency: overview.trip.defaultCurrency,
      payerMemberId: expenseSelection.payerMemberId,
      occurredAt: defaultStart,
      status: "posted" as const,
      splitMemberIds: expenseSelection.splitMemberIds,
      splitMode: "equal" as const,
    };
    setEditingItem(item);
    setEventDraft(item === "new" ? {
      title: "",
      tripDayId: currentTripDay?.id ?? "",
      itemType: "activity",
      startsAt: defaultStart,
      endsAt: "",
      durationMinutes: "",
      locationName: "",
      mapUrl: "",
      departureLocationName: "",
      departureMapUrl: "",
      destinationLocationName: "",
      destinationMapUrl: "",
      notes: "",
      visibility: "trip",
      viewerMemberIds: [],
      isLocked: false,
      linkedExpense: emptyLinkedExpense,
    } : {
      title: item.title,
      tripDayId: item.tripDayId,
      itemType: item.itemType as EventDraft["itemType"],
      startsAt: inputDateTime(item.startsAt, overview.trip.timeZone),
      endsAt: inputDateTime(item.endsAt, overview.trip.timeZone),
      durationMinutes: item.startsAt && item.endsAt
        ? String(Math.max(1, Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000)))
        : "",
      locationName: item.locationName ?? "",
      mapUrl: item.mapUrl ?? "",
      departureLocationName: item.departureLocationName ?? "",
      departureMapUrl: item.departureMapUrl ?? "",
      destinationLocationName: item.destinationLocationName ?? "",
      destinationMapUrl: item.destinationMapUrl ?? "",
      notes: item.notes ?? "",
      visibility: item.visibility,
      viewerMemberIds: item.viewerMemberIds,
      isLocked: item.isLocked,
      linkedExpense: {
        ...emptyLinkedExpense,
        occurredAt: inputDateTime(item.startsAt, overview.trip.timeZone),
      },
    });
  };

  const openPendingEvent = async (request: PendingItineraryProjection) => {
    if (!overview || eventSaveInFlight.current || !canEditPendingEvent(request, overview.session, overview.permissions)) return;
    setEventSaveError(null);
    setBusy(true);
    setPendingEventLoadingId(request.requestId);
    setNotice(null);
    try {
      const detail = await jsonRequest<PendingItineraryEditDetail>(
        `/api/trips/${overview.trip.id}/change-requests/${request.requestId}`,
      );
      const patch = detail.patch;
      const expenseSelection = eventExpenseDefaults(overview.members, {
        ...patch, createdByMemberId: detail.createdByMemberId,
      }, detail.createdByMemberId);
      const startsAt = inputDateTime(patch.startsAt, overview.trip.timeZone);
      const endsAt = inputDateTime(patch.endsAt, overview.trip.timeZone);
      const linkedExpense = patch.linkedExpense;
      setEditingItem({ kind: "pending", detail });
      setEventDraft({
        title: patch.title,
        tripDayId: patch.tripDayId,
        itemType: patch.itemType,
        startsAt,
        endsAt,
        durationMinutes: patch.startsAt && patch.endsAt
          ? String(Math.max(1, Math.round((new Date(patch.endsAt).getTime() - new Date(patch.startsAt).getTime()) / 60_000)))
          : "",
        locationName: patch.locationName ?? "",
        mapUrl: patch.mapUrl ?? "",
        departureLocationName: patch.departureLocationName ?? "",
        departureMapUrl: patch.departureMapUrl ?? "",
        destinationLocationName: patch.destinationLocationName ?? "",
        destinationMapUrl: patch.destinationMapUrl ?? "",
        notes: patch.notes ?? "",
        visibility: patch.visibility,
        viewerMemberIds: patch.viewerMemberIds,
        isLocked: patch.isLocked,
        linkedExpense: linkedExpense ? {
          enabled: true,
          description: linkedExpense.description,
          amount: expenseAmountInput(linkedExpense.amountMinor, linkedExpense.currency),
          currency: linkedExpense.currency,
          payerMemberId: linkedExpense.payerMemberId,
          occurredAt: inputDateTime(linkedExpense.occurredAt, overview.trip.timeZone),
          status: linkedExpense.status ?? "posted",
          splitMemberIds: linkedExpense.splitMemberIds,
          ...initializeExpenseSplits(linkedExpense.amountMinor, linkedExpense.currency, linkedExpense.splitMemberIds, linkedExpense.splitAmounts),
        } : {
          enabled: false,
          description: "",
          amount: "",
          currency: overview.trip.defaultCurrency,
          payerMemberId: expenseSelection.payerMemberId,
          occurredAt: startsAt,
          status: "posted",
          splitMemberIds: expenseSelection.splitMemberIds,
          splitMode: "equal",
        },
      });
    } catch {
      setNotice(messages.pendingEventLoadFailed);
    } finally {
      setPendingEventLoadingId(null);
      setBusy(false);
    }
  };

  const openExpense = (expense?: Overview["expenses"][number], options?: { itineraryItemId?: string; individual?: boolean }) => {
    if (!overview || !overview.permissions.canEditExpenses || expenseSavePending.current) return;
    const linkedItem = overview.itinerary.find((item) => item.id === options?.itineraryItemId);
    if (options?.itineraryItemId && (!linkedItem || linkedItem.status === "cancelled")) return;
    const members = eligibleEventExpenseMembers(overview.members, linkedItem ?? {
      createdByMemberId: overview.session.memberId, visibility: "trip", viewerMemberIds: [],
    });
    const individual = options?.individual !== false;
    expenseOriginal.current = expense ?? null;
    setExpenseFormError(null);
    setExpenseDraft(expense ? {
      id: expense.id,
      currentRevision: expense.currentRevision,
      description: expense.description,
      amount: expenseAmountInput(expense.amountMinor, expense.currency),
      currency: expense.currency,
      payerMemberId: expense.payerMemberId,
      itineraryItemId: expense.itineraryItemId ?? "",
      occurredAt: inputDateTime(expense.occurredAt, overview.trip.timeZone),
      splitMemberIds: expense.splits.map((split) => split.memberId),
      ...initializeExpenseSplits(expense.amountMinor, expense.currency, expense.splits.map((split) => split.memberId),
        expense.splits.map((split) => ({ memberId: split.memberId, amountMinor: split.shareMinor }))),
    } : {
      id: null,
      currentRevision: null,
      description: linkedItem?.title ?? "",
      amount: "",
      currency: overview.trip.defaultCurrency,
      payerMemberId: overview.session.memberId,
      itineraryItemId: linkedItem?.id ?? "",
      occurredAt: inputDateTime(new Date().toISOString(), overview.trip.timeZone),
      splitMemberIds: individual ? members.filter((member) => member.id === overview.session.memberId).map((member) => member.id)
        : members.map((member) => member.id),
      splitMode: "equal",
    });
  };

  const closeExpense = () => {
    if (expenseSavePending.current) return;
    setExpenseDraft(null);
    setExpenseFormError(null);
    expenseOriginal.current = null;
  };

  const chooseExpenseParticipants = (individual: boolean) => {
    if (!overview || !expenseDraft || expenseSavePending.current) return;
    const item = resolveExpenseEvent(overview, expenseDraft);
    const members = eligibleEventExpenseMembers(overview.members, item ?? {
      createdByMemberId: overview.session.memberId, visibility: "trip", viewerMemberIds: [],
    });
    const actorEligible = members.some((member) => member.id === overview.session.memberId);
    if (individual && !actorEligible) return;
    setExpenseDraft({ ...expenseDraft,
      payerMemberId: individual ? overview.session.memberId : expenseDraft.payerMemberId,
      splitMemberIds: individual ? [overview.session.memberId] : members.map((member) => member.id),
    });
    setExpenseFormError(null);
  };

  const openMemberPayment = (suggestion?: SummarySettlement) => {
    if (!overview || busy || paymentInFlight.current || !overview.permissions.canEditExpenses) return;
    const scope = `${overview.trip.id}:${overview.session.memberId}`;
    if (paymentAttempt.current?.scope === scope && paymentDialog?.scope === scope) {
      setPaymentDialogOpen(true); return;
    }
    const eligible = overview.members.filter(eligiblePaymentMember);
    const fromMemberId = overview.session.memberId;
    if (!eligible.some((member) => member.id === fromMemberId)) return;
    const useSuggestion = suggestion?.fromMemberId === fromMemberId
      && eligible.some((member) => member.id === suggestion.toMemberId);
    paymentAttempt.current = null; setPaymentLocked(false); setPaymentError(null);
    setPaymentDialog({ kind: "create", scope, draft: {
      fromMemberId, toMemberId: useSuggestion ? suggestion.toMemberId : "",
      amount: useSuggestion ? paymentAmountInput(suggestion.amountMinor, suggestion.currency) : "",
      currency: useSuggestion ? suggestion.currency : overview.trip.defaultCurrency,
      occurredAt: inputDateTime(new Date().toISOString(), overview.trip.timeZone), note: "", confirmation: false,
      ...(useSuggestion ? { suggestion: { fromMemberId, toMemberId: suggestion.toMemberId, currency: suggestion.currency, amountMinor: suggestion.amountMinor } } : {}),
    } });
    setPaymentDialogOpen(true);
  };

  const openPaymentAction = (payment: MemberPayment, action: PaymentAction) => {
    if (!overview || busy || paymentInFlight.current) return;
    const scope = `${overview.trip.id}:${overview.session.memberId}`;
    if (paymentAttempt.current?.scope === scope && paymentDialog?.scope === scope) { setPaymentDialogOpen(true); return; }
    const current = overview.memberPayments?.find((row) => row.id === payment.id && row.revision === payment.revision);
    if (!current || (action === "void" ? !current.canVoid || current.status === "void"
      : !overview.session.isOwner || !current.canReview || (action === "reject" ? current.status !== "pending" : !["pending", "rejected"].includes(current.status)))) return;
    paymentAttempt.current = null; setPaymentLocked(false); setPaymentError(null);
    setPaymentDialog({ kind: "action", scope, decision: { payment: current, action, reason: "", confirmation: false } });
    setPaymentDialogOpen(true);
  };

  const closeMemberPayment = () => {
    if (paymentInFlight.current) return;
    setPaymentDialogOpen(false);
    if (paymentAttempt.current) setNotice(paymentCopy.uncertain);
    else { setPaymentDialog(null); setPaymentError(null); }
  };

  const submitMemberPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !paymentDialog || paymentDialog.scope !== paymentScopeRef.current || busy || paymentInFlight.current) return;
    const scope = paymentDialog.scope;
    let attempt = paymentAttempt.current?.scope === scope ? paymentAttempt.current : null;
    if (!attempt) {
      let payload: Record<string, unknown>; let url = `/api/trips/${overview.trip.id}/payments`; let method: "POST" | "PATCH" = "POST";
      if (paymentDialog.kind === "create") {
        const draft = paymentDialog.draft;
        const eligible = overview.members.filter(eligiblePaymentMember);
        if (!overview.permissions.canEditExpenses || (!overview.session.isOwner && draft.fromMemberId !== overview.session.memberId)) { setPaymentError(paymentCopy.forbidden); return; }
        if (draft.fromMemberId === draft.toMemberId || ![draft.fromMemberId, draft.toMemberId].every((id) => eligible.some((member) => member.id === id))) { setPaymentError(paymentCopy.self); return; }
        const amountMinor = parseExpenseAmount(draft.amount, draft.currency);
        if (amountMinor === null) { setPaymentError(paymentCopy.precision); return; }
        if (!draft.confirmation || !/^[A-Z]{3}$/.test(draft.currency) || draft.note.length > 1000 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.occurredAt)) { setPaymentError(paymentCopy.invalid); return; }
        let occurredAt: string;
        try {
          occurredAt = zonedInputToIso(draft.occurredAt, overview.trip.timeZone);
          if (inputDateTime(occurredAt, overview.trip.timeZone) !== draft.occurredAt) throw new Error("Invalid payment time");
        } catch { setPaymentError(paymentCopy.invalid); return; }
        payload = { fromMemberId: draft.fromMemberId, toMemberId: draft.toMemberId, amountMinor, currency: draft.currency,
          occurredAt, ...(draft.note.trim() ? { note: draft.note.trim() } : {}), confirmation: true };
      } else {
        const { payment, action, confirmation, reason } = paymentDialog.decision;
        const current = overview.memberPayments?.find((row) => row.id === payment.id && row.revision === payment.revision);
        if (!current || (action === "void" ? !current.canVoid || current.status === "void" : !overview.session.isOwner || !current.canReview
          || (action === "reject" ? current.status !== "pending" : !["pending", "rejected"].includes(current.status)))) { setPaymentError(paymentCopy.stale); return; }
        if (!confirmation || reason.length > 500 || (action !== "approve" && !reason.trim())) { setPaymentError(paymentCopy.invalid); return; }
        url += `/${payment.id}`; method = "PATCH";
        payload = { action, expectedRevision: payment.revision, confirmation: true, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      }
      attempt = { scope, url, method, body: JSON.stringify({ ...payload, clientRequestId: crypto.randomUUID() }) };
      paymentAttempt.current = attempt;
    }
    paymentInFlight.current = true; setPaymentLocked(true); setPaymentError(null); setBusy(true);
    const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 45_000);
    try {
      const result = await jsonRequest<MemberPayment>(attempt.url, { method: attempt.method, body: attempt.body, signal: abort.signal });
      if (!result?.id || !["pending", "posted", "rejected", "void"].includes(result.status)) throw new Error("Unconfirmed payment response");
      if (paymentScopeRef.current !== scope) return;
      paymentAttempt.current = null; setPaymentLocked(false); setPaymentDialog(null); setPaymentDialogOpen(false);
      setNotice(result.status === "pending" ? paymentCopy.pendingSaved : result.status === "posted" ? paymentCopy.recorded : paymentCopy.actionSaved);
      await refresh({ syncDrafts: false }).catch(() => setNotice(paymentCopy.refreshedLater));
    } catch (error) {
      if (paymentScopeRef.current !== scope) return;
      const status = error instanceof JsonRequestError ? error.status : null;
      if (status !== null && status >= 400 && status < 500 && status !== 408) {
        paymentAttempt.current = null; setPaymentLocked(false);
        setPaymentError(status === 401 ? paymentCopy.signedOut : status === 403 || status === 404 ? paymentCopy.forbidden : status === 409 ? paymentCopy.stale : paymentCopy.invalid);
      } else setPaymentError(paymentCopy.uncertain);
    } finally { clearTimeout(timeout); paymentInFlight.current = false; if (paymentScopeRef.current === scope) setBusy(false); }
  };

  const loadCalendar = useCallback(async (showBusy = true) => {
    if (!overview?.calendar.connected || !overview.permissions.canSyncCalendar) return;
    const scope = `${overview.trip.id}:${overview.session.memberId}`;
    if (calendarScopeRef.current !== scope) return;
    const generation = ++calendarReadGeneration.current;
    const action = showBusy ? ++calendarActionGeneration.current : null;
    if (showBusy) setCalendarBusy(true);
    try {
      const state = await jsonRequest<CalendarState>(`/api/trips/${overview.trip.id}/calendar`);
      if (calendarScopeRef.current === scope && calendarReadGeneration.current === generation) setCalendarRead({ scope, state });
    } catch (error) {
      if (calendarScopeRef.current !== scope || calendarReadGeneration.current !== generation) return;
      const message = error instanceof Error ? error.message : messages.calendarSyncFailed;
      if (calendarAuthorizationNeedsReconnect(message)) {
        setCalendarRead(null);
        await refresh();
      }
      if (showBusy && calendarScopeRef.current === scope && calendarReadGeneration.current === generation) setNotice(message);
    } finally {
      if (showBusy && calendarScopeRef.current === scope && calendarActionGeneration.current === action) setCalendarBusy(false);
    }
  }, [messages.calendarSyncFailed, overview, refresh, setCalendarRead, setNotice]);

  useEffect(() => {
    if ((section !== "today" && section !== "itinerary") || !overview?.calendar.connected) return;
    // Passive revalidation must not flash syncing labels or interrupt notices.
    const timer = window.setTimeout(() => void loadCalendar(false), 0);
    return () => window.clearTimeout(timer);
  }, [section, overview?.calendar.connected, loadCalendar]);

  const syncCalendar = useCallback(async (mode: "all" | "item", itemId?: string) => {
    if (!overview?.calendar.connected || !overview.permissions.canSyncCalendar) return;
    const scope = `${overview.trip.id}:${overview.session.memberId}`;
    if (calendarScopeRef.current !== scope) return;
    const action = ++calendarActionGeneration.current;
    let nextConfirmation: CalendarSyncConfirmation | null = null;
    setCalendarConfirmation(null);
    setCalendarBusy(true);
    try {
      const result = await jsonRequest<{ results: Array<{
        itemId: string;
        eventId: string;
        htmlLink: string | null;
        action: "created" | "updated" | "recreated";
      }> }>(`/api/trips/${overview.trip.id}/calendar/sync`, {
        method: "POST",
        body: JSON.stringify(mode === "all" ? { mode } : { mode, itemId }),
      });
      if (calendarScopeRef.current !== scope || calendarActionGeneration.current !== action) return;
      nextConfirmation = createCalendarSyncConfirmation(result.results, {
        created: messages.calendarAdded,
        updated: messages.calendarUpdated,
        recreated: messages.calendarRecreated,
        bulk: (count) => formatMessage(messages.calendarBulkSynced, { count }),
        viewEvent: messages.viewCalendarEvent,
        viewCalendar: messages.viewCalendar,
      });
      await Promise.all([refresh(), loadCalendar(false)]);
    } catch (error) {
      if (calendarScopeRef.current !== scope || calendarActionGeneration.current !== action) return;
      const message = error instanceof Error ? error.message : messages.calendarSyncFailed;
      if (calendarAuthorizationNeedsReconnect(message)) {
        setCalendarConnectIntent(mode === "all" ? { mode: "all" } : { mode: "item", itemId: itemId! });
        await refresh();
      }
      if (calendarScopeRef.current === scope && calendarActionGeneration.current === action) setNotice(message);
    } finally {
      if (calendarScopeRef.current === scope && calendarActionGeneration.current === action) {
        setCalendarBusy(false);
        if (nextConfirmation) setCalendarConfirmation(nextConfirmation);
      }
    }
  }, [loadCalendar, messages, overview, refresh, setCalendarConfirmation, setCalendarConnectIntent, setNotice]);

  const openCalendarImport = (eventId: string) => {
    if (!overview?.permissions.canEditItinerary || !calendarScope || calendarScopeRef.current !== calendarScope || calendarImportSaving.current) return;
    setCalendarImportBusy(false);
    setCalendarImport({ scope: calendarScope, eventId });
  };

  const viewCalendarConfirmation = () => {
    if (!calendarConfirmation) return;
    beginCalendarSyncConfirmation(
      calendarConfirmation,
      () => setCalendarConfirmation(null),
      (url) => setCalendarOpeningUrl(url),
    );
  };

  useEffect(() => {
    if (calendarOAuthResult !== "connected" || !overview?.calendar.connected || calendarResumeStarted.current) return;
    calendarResumeStarted.current = true;
    const timer = window.setTimeout(() => {
      const intent = parsePendingCalendarSync(sessionStorage.getItem(pendingCalendarSyncStorageKey));
      sessionStorage.removeItem(pendingCalendarSyncStorageKey);
      setCalendarOAuthResult(null);
      if (!intent || intent.mode === "connect") {
        setNotice(messages.calendarConnectedReady);
        return;
      }
      void syncCalendar(intent.mode, intent.mode === "item" ? intent.itemId : undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [calendarOAuthResult, messages.calendarConnectedReady, overview?.calendar.connected, syncCalendar]);

  const requestCalendarSync = (mode: "all" | "item", itemId?: string) => {
    if (!overview?.permissions.canSyncCalendar) {
      setNotice(messages.calendarAccessDisabledNotice);
      return;
    }
    if (mode === "item" && !itemId) {
      setNotice(messages.calendarChooseEventNotice);
      return;
    }
    const intent: PendingCalendarSync = mode === "all"
      ? { mode: "all" }
      : { mode: "item", itemId: itemId! };
    if (!overview.calendar.connected) {
      setCalendarConnectIntent(intent);
      return;
    }
    void syncCalendar(intent.mode, intent.mode === "item" ? intent.itemId : undefined);
  };

  const beginCalendarAuthorization = () => {
    if (!overview || !calendarConnectIntent) return;
    sessionStorage.setItem(
      pendingCalendarSyncStorageKey,
      serializePendingCalendarSync(calendarConnectIntent),
    );
    window.location.assign(overview.calendar.connectionUrl);
  };

  const updatePermissions = async (memberId: string, permissions: Permissions) => {
    if (!overview) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members/${memberId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(permissions),
      });
      setNotice("Member permissions updated and logged.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update permissions.");
    } finally {
      setBusy(false);
    }
  };

  const unbindMemberIdentity = async (memberId: string) => {
    if (!overview || !window.confirm("Unbind this member's Google identity and revoke its active sessions?")) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members/${memberId}/identity`, {
        method: "DELETE",
      });
      setMemberClaimLinks((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      setNotice("Google identity unbound and member sessions revoked. You can now create a new invitation link.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to unbind the Google identity.");
    } finally {
      setBusy(false);
    }
  };

  const createMemberInvitation = async (memberId: string) => {
    if (!overview) return;
    setBusy(true);
    try {
      const result = await jsonRequest<{ claimUrl: string }>(`/api/trips/${overview.trip.id}/members/${memberId}/claim-links`, {
        method: "POST",
      });
      setMemberClaimLinks((current) => ({ ...current, [memberId]: result.claimUrl }));
      const copied = await navigator.clipboard.writeText(result.claimUrl)
        .then(() => true)
        .catch(() => false);
      setInviteToast(copied ? "Invite link copied" : "Invite created — copy it from the field below");
      setNotice("One-time invitation created and logged in the database.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create the invitation link.");
    } finally {
      setBusy(false);
    }
  };

  const createTripJoinLink = async () => {
    if (!overview || !overview.session.isOwner) return;
    setBusy(true);
    try {
      const result = await jsonRequest<{ joinUrl: string }>(`/api/trips/${overview.trip.id}/join-links`, {
        method: "POST",
        body: JSON.stringify(joinLinkShareKeys ? { shareAiKeys: true } : {}),
      });
      setTripJoinLink(result.joinUrl);
      const copied = await navigator.clipboard.writeText(result.joinUrl)
        .then(() => true)
        .catch(() => false);
      setInviteToast(copied ? "Trip invite link copied" : "Trip invite created — copy it below");
      setNotice("Reusable Google sign-in invitation created. It closes permanently when the trip reaches capacity.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create the trip invitation link.");
    } finally {
      setBusy(false);
    }
  };

  /** An owner turns one member's use of the owner's own AI keys on or off (JOB-063). */
  const updateAiKeyGrant = async (memberId: string, shared: boolean) => {
    if (!overview?.session.isOwner) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members/${memberId}/ai-key-grant`, {
        method: "PUT", body: JSON.stringify({ shared }),
      });
      setNotice(keysCopy.shareChanged);
      await refresh();
    } catch (error) {
      setNotice(error instanceof JsonRequestError && error.status === 400 ? keysCopy.shareNeedsKey : keysCopy.shareFailed);
    } finally {
      setBusy(false);
    }
  };

  /** Owners of an unsponsored trip pick the model shared keys run (JOB-063). */
  const updateSharedModel = async (model: string) => {
    if (!overview?.session.isOwner) return;
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/ai/settings`, {
        method: "PATCH", body: JSON.stringify({ ownerDefaultModel: model }),
      });
      setNotice(formatMessage(messages.aiModelChanged, { model }));
      await refresh();
    } catch { setNotice(messages.aiModelChangeFailed); }
  };

  const copyTripJoinLink = async () => {
    if (!tripJoinLink) return;
    const copied = await navigator.clipboard.writeText(tripJoinLink)
      .then(() => true)
      .catch(() => false);
    setInviteToast(copied ? "Trip invite link copied" : "Could not copy the link");
  };

  const revokeTripJoinLink = async () => {
    if (!overview || !overview.session.isOwner) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/join-links`, { method: "DELETE" });
      setTripJoinLink(null);
      setNotice("Reusable trip invitation disabled. Previously copied links no longer work.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to disable the trip invitation link.");
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview || newMemberName === null) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members`, {
        method: "POST",
        body: JSON.stringify({ displayName: newMemberName, ...(newMemberShareKeys ? { shareAiKeys: true } : {}) }),
      });
      setNewMemberName(null);
      setNewMemberShareKeys(false);
      setNotice("Member created as inactive. Use Invite to copy their one-time Google sign-in link.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to add the member.");
    } finally {
      setBusy(false);
    }
  };

  const updateMemberAccess = async (memberId: string, disabled: boolean) => {
    if (!overview?.session.isOwner) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled }),
      });
      if (disabled) {
        setMemberClaimLinks((current) => {
          const next = { ...current };
          delete next[memberId];
          return next;
        });
      }
      setNotice(disabled
        ? "Member disabled; active sessions and unused invitation links were revoked."
        : "Member access enabled.");
      if (disabled && memberId === overview.session.memberId) {
        router.replace(`/auth/sign-in?locale=${encodeURIComponent(locale)}`);
        router.refresh();
      } else await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to change member access.");
    } finally {
      setBusy(false);
    }
  };

  const requestMemberAccessChange = (member: Overview["members"][number]) => {
    if (member.status === "revoked") {
      void updateMemberAccess(member.id, false);
      return;
    }
    if (member.status === "active" && member.identityBound) {
      setMemberPendingDisable({ id: member.id, displayName: member.displayName });
      return;
    }
    void updateMemberAccess(member.id, true);
  };

  const confirmMemberDisable = async () => {
    if (!memberPendingDisable) return;
    const memberId = memberPendingDisable.id;
    setMemberPendingDisable(null);
    await updateMemberAccess(memberId, true);
  };

  const updateMemberRole = async (member: Overview["members"][number], role: MemberRole) => {
    if (!overview?.session.isOwner || !member.currentRevision) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members/${member.id}`, {
        method: "PATCH", body: JSON.stringify({ role, expectedRevision: member.currentRevision }),
      });
      setNotice(memberCopy.roleSaved);
      await refresh();
    } catch {
      setNotice(memberCopy.roleFailed);
    } finally {
      setBusy(false);
    }
  };

  const closeMemberRemoval = () => {
    if (busy) return;
    memberRemovalRequestId.current += 1;
    setMemberRemoval(null);
  };

  const previewMemberRemoval = async (member: Overview["members"][number]) => {
    if (!overview?.session.isOwner || !memberAdminScope) return;
    const scope = memberAdminScope;
    const requestId = ++memberRemovalRequestId.current;
    setMemberRemoval({ scope, member, preview: null, loading: true, error: null });
    try {
      const preview = await jsonRequest<MemberRemovalPreview>(`/api/trips/${overview.trip.id}/members/${member.id}`, { cache: "no-store" });
      if (requestId !== memberRemovalRequestId.current || scope !== memberAdminScopeRef.current) return;
      setMemberRemoval({ scope, member, preview, loading: false, error: null });
    } catch {
      if (requestId !== memberRemovalRequestId.current || scope !== memberAdminScopeRef.current) return;
      setMemberRemoval({ scope, member, preview: null, loading: false, error: memberCopy.previewFailed });
    }
  };

  const confirmMemberRemoval = async (input: MemberRemovalInput) => {
    if (!overview?.session.isOwner || !memberRemoval?.preview || memberRemoval.scope !== memberAdminScope || busy) return;
    const snapshot = memberRemoval;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members/${snapshot.member.id}`, {
        method: "DELETE", body: JSON.stringify(input),
      });
      if (snapshot.scope !== memberAdminScopeRef.current) return;
      memberRemovalRequestId.current += 1;
      setMemberRemoval(null);
      setNotice(memberCopy.removed);
      // Removing your own membership ends this trip session; let account routing
      // choose an accessible destination instead of retaining a stale owner UI.
      if (snapshot.member.id === overview.session.memberId) {
        router.replace(`/auth/sign-in?locale=${encodeURIComponent(locale)}`);
        router.refresh();
      }
      else await refresh();
    } catch (error) {
      if (snapshot.scope !== memberAdminScopeRef.current) return;
      // Discard every old choice after uncertainty/conflict. A new preview always
      // requires a fresh explicit confirmation; never replay a destructive action.
      setMemberRemoval({ ...snapshot, preview: null, loading: false,
        error: error instanceof JsonRequestError && error.status === 409 ? memberCopy.stale : memberCopy.removeFailed });
    } finally { setBusy(false); }
  };

  const closeTripDeletion = () => {
    if (busy) return;
    tripDeletionRequestId.current += 1;
    setTripDeletion(null);
  };

  const previewTripDeletion = async () => {
    if (!overview?.session.isOwner || !memberAdminScope) return;
    const scope = memberAdminScope;
    const requestId = ++tripDeletionRequestId.current;
    setTripDeletion({ scope, preview: null, loading: true, error: null });
    try {
      const preview = await jsonRequest<TripDeletionPreview>(`/api/trips/${overview.trip.id}/deletion`, { cache: "no-store" });
      if (requestId !== tripDeletionRequestId.current || scope !== memberAdminScopeRef.current) return;
      setTripDeletion({ scope, preview, loading: false, error: null });
    } catch {
      if (requestId !== tripDeletionRequestId.current || scope !== memberAdminScopeRef.current) return;
      setTripDeletion({ scope, preview: null, loading: false, error: tripDeletionCopy.previewFailed });
    }
  };

  const confirmTripDeletion = async (confirmationName: string) => {
    if (!overview?.session.isOwner || !tripDeletion?.preview || tripDeletion.scope !== memberAdminScope || busy) return;
    if (!confirmInstructionsLeave()) return;
    const snapshot = tripDeletion;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/deletion`, { method: "DELETE", body: JSON.stringify({ confirmationName }) });
    } catch (error) {
      if (snapshot.scope === memberAdminScopeRef.current) {
        // No response or a gateway/server failure may hide a committed deletion: offer a reload,
        // never a re-preview or an automatic replay. A clear refusal means the trip or access changed.
        const status = error instanceof JsonRequestError ? error.status : null;
        const refused = status !== null && [400, 401, 403, 409].includes(status);
        setTripDeletion({ ...snapshot, preview: null, loading: false, uncertain: !refused,
          error: refused ? tripDeletionCopy.stale : tripDeletionCopy.deleteFailed });
      }
      setBusy(false);
      return;
    }
    // The cookie now holds the next trip's session. Leave no copy of this trip on this device.
    clearOfflineItinerarySnapshot();
    clearAiImages();
    aiRecoveryClient.current?.dispose();
    try { window.sessionStorage.setItem(TRIP_DELETED_NOTICE_KEY, "1"); } catch { /* the notice is optional */ }
    window.location.reload();
  };

  const saveProfileName = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview) return;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/members/${overview.session.memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: profileName }),
      });
      setNotice("Your trip display name was updated and logged.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update your name.");
    } finally {
      setBusy(false);
    }
  };

  const saveMemberDailyLimit = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview) return;
    const limit = Number(memberDailyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      setNotice(messages.aiLimitInvalid);
      return;
    }
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/ai/settings`, {
        method: "PATCH",
        body: JSON.stringify({ memberDailyLimit: limit }),
      });
      setNotice(formatMessage(messages.aiLimitChanged, { limit }));
      await refresh();
    } catch {
      setNotice(messages.aiLimitChangeFailed);
    } finally {
      setBusy(false);
    }
  };

  const updateEventStart = (startsAt: string) => {
    if (!overview || !eventDraft) return;
    const tripDay = overview.days.find((day) => day.date === startsAt.slice(0, 10));
    const duration = Number(eventDraft.durationMinutes);
    const endsAt = startsAt && Number.isSafeInteger(duration) && duration > 0
      ? addMinutesToWallTime(startsAt, duration) : eventDraft.endsAt;
    const calculatedDuration = minutesBetweenWallTimes(startsAt, endsAt);
    setEventDraft({
      ...eventDraft,
      startsAt,
      tripDayId: tripDay?.id ?? eventDraft.tripDayId,
      endsAt,
      durationMinutes: eventDraft.durationMinutes || (calculatedDuration === null ? "" : String(calculatedDuration)),
    });
  };

  const updateEventEnd = (endsAt: string) => {
    if (!eventDraft) return;
    const duration = minutesBetweenWallTimes(eventDraft.startsAt, endsAt);
    setEventDraft({ ...eventDraft, endsAt, durationMinutes: duration === null ? "" : String(duration), durationWasEdited: false });
  };

  const updateEventDuration = (durationMinutes: string) => {
    if (!eventDraft) return;
    const duration = Number(durationMinutes);
    setEventDraft({
      ...eventDraft,
      durationMinutes,
      durationWasEdited: true,
      endsAt: !durationMinutes.trim() ? "" : eventDraft.startsAt && Number.isSafeInteger(duration) && duration > 0
        ? addMinutesToWallTime(eventDraft.startsAt, duration)
        : eventDraft.endsAt,
    });
  };

  const fillEventTimeNow = (field: "startsAt" | "endsAt") => {
    if (!overview || !eventDraft || eventSaveInFlight.current) return;
    const currentTime = inputDateTime(new Date().toISOString(), overview.trip.timeZone);
    if (field === "startsAt") updateEventStart(currentTime);
    else updateEventEnd(currentTime);
  };

  const updateEventType = (itemType: EventDraft["itemType"]) => {
    if (!eventDraft || itemType === eventDraft.itemType) return;
    if (itemType === "transport") {
      setEventDraft({
        ...eventDraft,
        itemType,
        destinationLocationName: eventDraft.destinationLocationName || eventDraft.locationName,
        destinationMapUrl: eventDraft.destinationMapUrl || eventDraft.mapUrl,
      });
      return;
    }
    const preferredLocationName = eventDraft.destinationLocationName || eventDraft.departureLocationName;
    const preferredMapUrl = eventDraft.destinationLocationName
      ? eventDraft.destinationMapUrl
      : eventDraft.departureMapUrl;
    setEventDraft({
      ...eventDraft,
      itemType,
      locationName: eventDraft.locationName || preferredLocationName,
      mapUrl: eventDraft.mapUrl || preferredMapUrl,
    });
  };

  const updateTransportLocation = (
    endpoint: "departure" | "destination",
    locationName: string,
  ) => {
    if (!eventDraft) return;
    if (endpoint === "departure") {
      setEventDraft({
        ...eventDraft,
        departureLocationName: locationName,
        departureMapUrl: locationName === eventDraft.departureLocationName
          ? eventDraft.departureMapUrl
          : "",
      });
      return;
    }
    setEventDraft({
      ...eventDraft,
      destinationLocationName: locationName,
      destinationMapUrl: locationName === eventDraft.destinationLocationName
        ? eventDraft.destinationMapUrl
        : "",
    });
  };

  const updateEventVisibility = (visibility: EventDraft["visibility"]) => {
    if (!overview || !eventDraft || !editingItem) return;
    const creatorId = editingItem === "new"
      ? overview.session.memberId
      : isPendingEventEditorTarget(editingItem)
        ? editingItem.detail.createdByMemberId
        : editingItem.createdByMemberId;
    const viewerMemberIds = visibility === "private"
      ? eventDraft.viewerMemberIds.filter((memberId) => memberId !== creatorId)
      : eventDraft.viewerMemberIds;
    const retainsSavedExpense = isPendingEventEditorTarget(editingItem) && editingItem.detail.patch.linkedExpense;
    setEventDraft({
      ...eventDraft,
      visibility,
      viewerMemberIds,
      linkedExpense: retainsSavedExpense ? eventDraft.linkedExpense : constrainNewEventExpense(
        eventDraft.linkedExpense, overview.members,
        { createdByMemberId: creatorId, visibility, viewerMemberIds },
      ),
    });
  };

  const updateEventViewer = (memberId: string, selected: boolean) => {
    if (!eventDraft || !overview) return;
    const viewerMemberIds = selected
      ? [...new Set([...eventDraft.viewerMemberIds, memberId])]
      : eventDraft.viewerMemberIds.filter((id) => id !== memberId);
    const creatorId = editingItem === "new" || !editingItem
      ? overview.session.memberId
      : isPendingEventEditorTarget(editingItem)
        ? editingItem.detail.createdByMemberId
        : editingItem.createdByMemberId;
    const retainsSavedExpense = isPendingEventEditorTarget(editingItem) && editingItem.detail.patch.linkedExpense;
    setEventDraft({
      ...eventDraft,
      viewerMemberIds,
      linkedExpense: retainsSavedExpense ? eventDraft.linkedExpense : constrainNewEventExpense(
        eventDraft.linkedExpense, overview.members,
        { createdByMemberId: creatorId, visibility: eventDraft.visibility, viewerMemberIds },
      ),
    });
  };

  const updateExpenseEvent = (itineraryItemId: string) => {
    if (!overview || !expenseDraft || expenseSavePending.current) return;
    const item = overview.itinerary.find((candidate) => candidate.id === itineraryItemId);
    if (itineraryItemId && (!item || item.status === "cancelled")) return;
    if (expenseDraft.id) {
      setExpenseDraft({ ...expenseDraft, itineraryItemId });
      return;
    }
    const allowedMembers = eligibleEventExpenseMembers(overview.members, item ?? {
      createdByMemberId: overview.session.memberId, visibility: "trip", viewerMemberIds: [],
    });
    const allowedIds = new Set(allowedMembers.map((member) => member.id));
    const splitMemberIds = expenseDraft.splitMemberIds.filter((memberId) => allowedIds.has(memberId));
    setExpenseDraft({
      ...expenseDraft,
      itineraryItemId,
      payerMemberId: allowedIds.has(expenseDraft.payerMemberId)
        ? expenseDraft.payerMemberId
        : allowedMembers[0]?.id ?? "",
      description: expenseDraft.description || item?.title || "",
      splitMemberIds,
    });
  };

  const saveEvent = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !eventDraft || !editingItem || eventSaveInFlight.current) return;
    eventSaveInFlight.current = true;
    setBusy(true);
    setNotice(null);
    setEventSaveError(null);
    const pendingTarget = isPendingEventEditorTarget(editingItem) ? editingItem : null;
    const canonicalTarget: ItineraryItem | null = editingItem !== "new" && !isPendingEventEditorTarget(editingItem)
      ? editingItem
      : null;
    let submitted = false;
    try {
      const isNew = editingItem === "new";
      const eventCreatorId = isNew
        ? overview.session.memberId
        : pendingTarget
          ? pendingTarget.detail.createdByMemberId
          : canonicalTarget!.createdByMemberId;
      const originalExpense = pendingTarget?.detail.patch.linkedExpense;
      const expenseIssue = validateEventExpense(eventDraft.linkedExpense, overview.members, {
        createdByMemberId: eventCreatorId, visibility: eventDraft.visibility, viewerMemberIds: eventDraft.viewerMemberIds,
      }, originalExpense);
      if (expenseIssue) throw new Error(eventEditorCopy[expenseIssue]);
      const tripDay = overview.days.find((day) => day.date === eventDraft.startsAt.slice(0, 10));
      if (!tripDay) throw new Error(messages.startDateOutsideTrip);
      const duration = Number(eventDraft.durationMinutes);
      if (eventDraft.durationMinutes.trim() && (!Number.isSafeInteger(duration) || duration <= 0)) {
        throw new Error(eventEditorCopy.durationWholeMinutes);
      }
      if (eventDraft.durationMinutes.trim() && !eventDraft.endsAt) {
        throw new Error(eventEditorCopy.endDateOutsideTrip);
      }
      if (eventDraft.itemType === "transport"
          && !eventDraft.departureLocationName.trim()
          && !eventDraft.destinationLocationName.trim()) {
        throw new Error(messages.transportEndpointRequired);
      }
      const originalTiming = pendingTarget?.detail.patch ?? canonicalTarget;
      // A minute-resolution editor must not rewrite unchanged timestamp precision.
      const startsAt = originalTiming?.startsAt && eventDraft.startsAt === inputDateTime(originalTiming.startsAt, overview.trip.timeZone)
        ? originalTiming.startsAt : zonedInputToIso(eventDraft.startsAt, overview.trip.timeZone);
      const endsAt = !eventDraft.endsAt ? null
        : eventDraft.durationWasEdited && eventDraft.durationMinutes.trim()
          ? new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString()
        : originalTiming?.endsAt && eventDraft.endsAt === inputDateTime(originalTiming.endsAt, overview.trip.timeZone)
          ? originalTiming.endsAt : zonedInputToIso(eventDraft.endsAt, overview.trip.timeZone);
      if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        throw new Error(eventEditorCopy.endAfterStart);
      }
      if (eventDraft.endsAt && (eventDraft.endsAt.slice(0, 10) < overview.trip.startsOn
          || eventDraft.endsAt.slice(0, 10) > overview.trip.endsOn)) {
        throw new Error(eventEditorCopy.endDateOutsideTrip);
      }
      const linkedAmountMinor = eventDraft.linkedExpense.enabled ? parseExpenseAmount(eventDraft.linkedExpense.amount, eventDraft.linkedExpense.currency) : null;
      if (eventDraft.linkedExpense.enabled && linkedAmountMinor === null) throw new Error(eventEditorCopy.amount);
      const splitPatch = linkedAmountMinor === null ? {} : expenseSplitPatch(eventDraft.linkedExpense, linkedAmountMinor, originalExpense);
      const expenseInput = eventDraft.linkedExpense.enabled ? {
        description: eventDraft.linkedExpense.description.trim() || eventDraft.title.trim(),
        amountMinor: linkedAmountMinor!,
        currency: eventDraft.linkedExpense.currency,
        payerMemberId: eventDraft.linkedExpense.payerMemberId,
        occurredAt: zonedInputToIso(eventDraft.linkedExpense.occurredAt, overview.trip.timeZone),
        status: eventDraft.linkedExpense.status,
        splitMemberIds: splitPatch.splitMemberIds ?? originalExpense?.splitMemberIds ?? eventDraft.linkedExpense.splitMemberIds,
        ...(Object.keys(splitPatch).length ? splitPatch : originalExpense?.splitAmounts ? { splitAmounts: originalExpense.splitAmounts } : {}),
      } : null;
      const linkedExpense = expenseInput ? preserveUnchangedLinkedExpense(
        originalExpense, expenseInput,
        originalExpense ? inputDateTime(originalExpense.occurredAt, overview.trip.timeZone) : "",
        eventDraft.linkedExpense.occurredAt,
        eventDraft.linkedExpense.amount,
      ) : null;
      const patch = {
        tripDayId: tripDay.id,
        title: eventDraft.title,
        itemType: eventDraft.itemType,
        startsAt,
        endsAt,
        ...(eventDraft.itemType === "transport" ? {
          locationName: null,
          mapUrl: null,
          departureLocationName: eventDraft.departureLocationName.trim() || null,
          departureMapUrl: eventDraft.departureMapUrl || null,
          destinationLocationName: eventDraft.destinationLocationName.trim() || null,
          destinationMapUrl: eventDraft.destinationMapUrl || null,
        } : {
          locationName: eventDraft.locationName.trim() || null,
          mapUrl: eventDraft.mapUrl || null,
          departureLocationName: null,
          departureMapUrl: null,
          destinationLocationName: null,
          destinationMapUrl: null,
        }),
        notes: eventDraft.notes || null,
        ...(
          isNew || eventCreatorId === overview.session.memberId
            ? { visibility: eventDraft.visibility, viewerMemberIds: eventDraft.visibility === "private" ? eventDraft.viewerMemberIds : [] }
            : {}
        ),
        ...(pendingTarget
          ? overview.permissions.canEditExpenses ? { linkedExpense } : {}
          : linkedExpense ? { linkedExpense } : {}),
        ...(overview.session.isOwner ? { isLocked: eventDraft.isLocked } : {}),
      };
      if (pendingTarget) {
        submitted = true;
        await jsonRequest<PendingItineraryEditDetail>(
          `/api/trips/${overview.trip.id}/change-requests/${pendingTarget.detail.requestId}`,
          {
            method: "PUT",
            body: JSON.stringify({
              proposalRevision: pendingTarget.detail.proposalRevision,
              patch,
            }),
          },
        );
        setNotice(messages.pendingEventUpdated);
        setEditingItem(null);
        setEventDraft(null);
        await refresh();
        return;
      }
      const canApplyNow = overview.session.isOwner || (
        !overview.permissions.itineraryRequiresApproval
        && (!linkedExpense || !overview.permissions.expenseRequiresApproval)
      );
      submitted = true;
      const result = await jsonRequest<{ status: string }>(`/api/trips/${overview.trip.id}/change-requests`, {
        method: "POST",
        body: JSON.stringify({
          entityType: "itinerary_item",
          entityId: isNew ? null : canonicalTarget!.id,
          operation: isNew ? "create" : "update",
          baseRevision: isNew ? null : canonicalTarget!.currentRevision,
          applyNow: canApplyNow,
          reason: isNew ? "Created from the itinerary editor" : "Updated from the itinerary editor",
          patch,
        }),
      });
      setNotice(result.status === "approved"
        ? linkedExpense
          ? messages.planAndExpenseSaved
          : messages.planSaved
        : messages.planChangeRequested);
      setEditingItem(null);
      setEventDraft(null);
      await refresh();
    } catch (error) {
      setEventSaveError(!submitted && error instanceof Error
        ? error.message : eventEditorFailureMessage(error, eventEditorCopy));
    } finally {
      eventSaveInFlight.current = false;
      setBusy(false);
    }
  };

  const cancelOrRestore = async (item: ItineraryItem) => {
    if (!overview) return;
    setBusy(true);
    try {
      const operation = item.status === "cancelled" ? "restore" : "cancel";
      const result = await jsonRequest<{ status: string }>(`/api/trips/${overview.trip.id}/change-requests`, {
        method: "POST",
        body: JSON.stringify({
          entityType: "itinerary_item", entityId: item.id, operation,
          baseRevision: item.currentRevision, patch: {},
          applyNow: overview.session.isOwner || !overview.permissions.itineraryRequiresApproval,
          reason: `${operation} requested from itinerary`,
        }),
      });
      const localizedAction = operation === "restore" ? messages.restoreEvent : messages.cancelEvent;
      setNotice(result.status === "approved"
        ? operation === "restore" ? messages.eventRestored : messages.eventCancelled
        : formatMessage(messages.eventActionRequested, { action: localizedAction }));
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : messages.planUpdateFailed); }
    finally { setBusy(false); }
  };

  const removeCancelledEvent = async (item: ItineraryItem) => {
    if (!overview?.session.isOwner || item.status !== "cancelled" || busy || cardMutationPending.current) return;
    if (!window.confirm(cardCopy.removeConfirm)) return;
    cardMutationPending.current = true;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/itinerary/${item.id}/remove`, {
        method: "POST", body: JSON.stringify({ expectedRevision: item.currentRevision, confirm: true }),
      });
      setNotice(cardCopy.removed);
      await refresh();
    } catch (error) {
      setNotice(error instanceof JsonRequestError && error.status === 409 ? cardCopy.stale : cardCopy.removalFailed);
    } finally { cardMutationPending.current = false; setBusy(false); }
  };

  const reviewExpenseDraft = async (expense: Overview["expenses"][number], decision: "approve" | "reject") => {
    if (!overview?.session.isOwner || expense.status !== "draft" || busy || cardMutationPending.current) return;
    cardMutationPending.current = true;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/change-requests`, {
        method: "POST", body: JSON.stringify({
          entityType: "expense", entityId: expense.id, baseRevision: expense.currentRevision,
          operation: decision === "approve" ? "update" : "void",
          patch: decision === "approve" ? { status: "posted" } : {},
          applyNow: true, reason: `Owner ${decision} of expense draft`,
        }),
      });
      setNotice(decision === "approve" ? cardCopy.draftApproved : cardCopy.draftRejected);
      await refresh();
    } catch (error) {
      setNotice(error instanceof JsonRequestError && error.status === 409 ? cardCopy.stale : messages.requestReviewFailed);
    } finally { cardMutationPending.current = false; setBusy(false); }
  };

  const saveExpense = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !expenseDraft || !overview.permissions.canEditExpenses || expenseSavePending.current) return;
    expenseSavePending.current = true;
    setExpenseFormError(null);
    setBusy(true);
    try {
      const isEdit = Boolean(expenseDraft.id);
      const original = expenseOriginal.current;
      if (isEdit && (!original || original.id !== expenseDraft.id)) {
        setExpenseFormError(expensePageCopy.stale); return;
      }
      const linkedItem = resolveExpenseEvent(overview, expenseDraft);
      if (expenseDraft.itineraryItemId && !linkedItem) {
        setExpenseFormError(eventEditorCopy.forbidden); return;
      }
      const audience = linkedItem ?? {
        createdByMemberId: overview.session.memberId, visibility: "trip" as const, viewerMemberIds: [],
      };
      const issue = validateEventExpense({ ...expenseDraft, enabled: true, status: "posted" }, overview.members, audience);
      if (issue) { setExpenseFormError(eventEditorCopy[issue]); return; }
      const unchangedAmount = original && original.currency === expenseDraft.currency
        && expenseAmountInput(original.amountMinor, original.currency) === expenseDraft.amount;
      const amountMinor = unchangedAmount ? original.amountMinor : parseExpenseAmount(expenseDraft.amount, expenseDraft.currency);
      if (amountMinor === null) { setExpenseFormError(expensePageCopy.precision); return; }
      const splitPatch = expenseSplitPatch(expenseDraft, amountMinor, original ? {
        amountMinor: original.amountMinor, currency: original.currency,
        splitMemberIds: original.splits.map((split) => split.memberId),
        splitAmounts: original.splits.map((split) => ({ memberId: split.memberId, amountMinor: split.shareMinor })),
      } : null);
      const occurredAt = original && inputDateTime(original.occurredAt, overview.trip.timeZone) === expenseDraft.occurredAt
        ? original.occurredAt : zonedInputToIso(expenseDraft.occurredAt, overview.trip.timeZone);
      const result = await jsonRequest<{ status: string }>(`/api/trips/${overview.trip.id}/change-requests`, {
        method: "POST",
        body: JSON.stringify({
          entityType: "expense",
          entityId: expenseDraft.id,
          operation: isEdit ? "update" : "create",
          baseRevision: expenseDraft.currentRevision,
          applyNow: overview.session.isOwner || !overview.permissions.expenseRequiresApproval,
          reason: isEdit ? "Expense corrected from the trip expenses screen" : "Expense added from the trip expenses screen",
          patch: {
            description: expenseDraft.description,
            ...(!unchangedAmount ? { amountMinor } : {}),
            currency: expenseDraft.currency,
            payerMemberId: expenseDraft.payerMemberId,
            itineraryItemId: expenseDraft.itineraryItemId || null,
            ...splitPatch,
            occurredAt,
            status: original?.status ?? "posted",
          },
        }),
      });
      setNotice(result.status === "approved" ? expensePageCopy.saved : expensePageCopy.pending);
      setExpenseDraft(null);
      expenseOriginal.current = null;
      await refresh();
    } catch (error) {
      setExpenseFormError(error instanceof JsonRequestError && error.status === 409
        ? expensePageCopy.stale : eventEditorFailureMessage(error, eventEditorCopy));
    }
    finally { expenseSavePending.current = false; setBusy(false); }
  };

  const review = async (id: string, decision: "approve" | "reject", proposalRevision: number) => {
    if (!overview?.session.isOwner || busy || cardMutationPending.current || !Number.isSafeInteger(proposalRevision) || proposalRevision < 1) return;
    cardMutationPending.current = true;
    setBusy(true);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/change-requests/${id}`, {
        method: "PATCH", body: JSON.stringify({ decision, proposalRevision }),
      });
      setNotice(decision === "approve" ? messages.requestApprovedNotice : messages.requestRejectedNotice);
      await Promise.all([refresh(), loadApprovalHistory("reset")]);
    } catch (error) {
      if (error instanceof JsonRequestError && error.status === 409) {
        setNotice(messages.requestReviewStale);
        await Promise.all([refresh({ syncDrafts: false }), loadApprovalHistory("reset")]);
      } else setNotice(error instanceof Error ? error.message : messages.requestReviewFailed);
    }
    finally { cardMutationPending.current = false; setBusy(false); }
  };

  const askAi = async (event: FormEvent, conversationId = aiState.activeConversationId, purpose: "trip" | "preferences" = "trip") => {
    event.preventDefault();
    if (!overview || !aiPrompt.trim() || busy || aiThinking || aiImages.preparing || conversationId === undefined || purpose === "preferences") return;
    const ownChoice = (ownKeyModels(overview.ai.ownKeyProviders ?? []) as string[]).includes(ownKeyChoice) ? ownKeyChoice : "";
    await aiRecoveryClient.current?.submit({
      prompt: aiPrompt, locale, conversationId,
      ...(overview.ai.canSelectModel === true ? { model: selectedModel } : ownChoice ? { model: ownChoice } : {}),
      ...(aiImages.images.length ? { images: aiImages.images.map((image) => image.input) } : {}),
    });
  };

  const switchAiConversation = async (conversationId?: string) => {
    if (!overview || aiThinking) return;
    if ((aiPrompt.trim() || aiImages.images.length) && !window.confirm(instructionsCopy.switchConfirm)) return false;
    const client = aiRecoveryClient.current;
    await jsonRequest<{ conversationId: string }>(`/api/trips/${overview.trip.id}/ai/conversation`, {
      method: "POST",
      body: JSON.stringify(conversationId ? { action: "resume", conversationId } : { action: "new" }),
    });
    // A late switch response from another trip must not reset its new controller.
    if (client !== aiRecoveryClient.current) return;
    client?.reset();
    setAiPrompt("");
    clearAiImages();
    await client?.check(true);
    return true;
  };

  const resetAiMemory = async () => {
    if (!overview || aiThinking) return;
    setBusy(true);
    try {
      if (await switchAiConversation() === false) return;
      setAiConversationResetOpen(false);
      setNotice(messages.aiConversationReset);
    } catch (error) {
      setNotice(error instanceof JsonRequestError && error.status === 409
        ? messages.aiConversationBusy : messages.aiConversationResetFailed);
      void aiRecoveryClient.current?.check(true);
    } finally {
      setBusy(false);
    }
  };

  // A quick question after ten idle minutes goes to a new conversation (D-082).
  const askQuickAi = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !aiQuickReplyGone) { await askAi(event); return; }
    if (!aiPrompt.trim() || busy || aiThinking || aiImages.preparing) return;
    const client = aiRecoveryClient.current;
    let conversationId: string | null = null;
    setBusy(true);
    try {
      const result = await jsonRequest<{ conversationId: string }>(`/api/trips/${overview.trip.id}/ai/conversation`, {
        method: "POST", body: JSON.stringify({ action: "new" }),
      });
      // A late response from another trip must not reset its new controller.
      if (client && client === aiRecoveryClient.current) { client.reset(); conversationId = result.conversationId; }
    } catch (error) {
      setNotice(error instanceof JsonRequestError && error.status === 409 ? messages.aiConversationBusy : messages.aiConversationResetFailed);
      void aiRecoveryClient.current?.check(true);
    } finally {
      setBusy(false);
    }
    if (conversationId) await askAi(event, conversationId);
  };

  const updateModel = async (model: string) => {
    if (!overview?.ai.canSelectModel) return;
    setSelectedModel(model);
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/ai/settings`, {
        method: "PATCH", body: JSON.stringify({ ownerDefaultModel: model }),
      });
      setNotice(formatMessage(messages.aiModelChanged, { model }));
      await refresh();
    } catch { setNotice(messages.aiModelChangeFailed); }
  };

  const saveTripSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !tripSettings || !overview.session.isOwner || tripSettingsSaving.current) return;
    const { scope, ...submittedSettings } = tripSettings;
    if (scope !== tripSettingsScope(overview) || scope !== tripSettingsScopeRef.current) return;
    const maxMembers = Number(tripSettings.maxMembers);
    if (!Number.isInteger(maxMembers) || maxMembers < overview.trip.memberCount || maxMembers > 20) {
      setNotice(formatMessage(messages.tripSettingsInvalidMembers, { count: overview.trip.memberCount }));
      return;
    }
    if (!validTripDateRange(tripSettings.startsOn, tripSettings.endsOn)) {
      setNotice(messages.tripSettingsInvalidDates);
      return;
    }
    if ((tripSettings.startsOn !== tripSettings.expectedStartsOn || tripSettings.endsOn !== tripSettings.expectedEndsOn) && !window.confirm(formatMessage(
      messages.confirmTripDateChange,
      {
        previousStart: formatTripDay(tripSettings.expectedStartsOn, locale),
        previousEnd: formatTripDay(tripSettings.expectedEndsOn, locale),
        nextStart: formatTripDay(tripSettings.startsOn, locale),
        nextEnd: formatTripDay(tripSettings.endsOn, locale),
      },
    ))) return;
    tripSettingsSaving.current = true;
    setBusy(true);
    let settingsSaved = false;
    try {
      await jsonRequest(`/api/trips/${overview.trip.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ ...submittedSettings, maxMembers }),
      });
      if (tripSettingsScopeRef.current === scope) {
        // The PATCH is known to have committed even if the following read fails.
        // Preserve this accepted date fence without replacing later identity drafts.
        setTripSettings((current) => current?.scope === scope ? { ...current,
          expectedStartsOn: submittedSettings.startsOn, expectedEndsOn: submittedSettings.endsOn } : current);
        setNotice(messages.tripSettingsSaved);
        settingsSaved = true;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (tripSettingsScopeRef.current === scope) setNotice(reason === tripDateErrors.occupied ? messages.tripSettingsDatesOccupied
        : reason === tripDateErrors.stale ? messages.tripSettingsDatesStale
        : reason === tripDateErrors.order || reason === tripDateErrors.length ? messages.tripSettingsInvalidDates
        : messages.tripSettingsSaveFailed);
    }
    if (settingsSaved) {
      try {
        const updated = await refresh();
        if (!updated && tripSettingsScopeRef.current === scope) setNotice(messages.refreshAfterChangeFailed);
      } catch {
        if (tripSettingsScopeRef.current === scope) setNotice(messages.refreshAfterChangeFailed);
      }
    }
    tripSettingsSaving.current = false;
    setBusy(false);
  };

  const switchTrip = async (tripId: string) => {
    if (!overview || tripId === overview.trip.id) return;
    if (!confirmInstructionsLeave()) return;
    setBusy(true);
    setNotice("Switching trip…");
    try {
      await jsonRequest("/api/auth/trip", {
        method: "POST",
        body: JSON.stringify({ tripId }),
      });
      window.location.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to switch trips.");
      setBusy(false);
    }
  };

  const openNewTrip = () => {
    router.push(`/trips/new?locale=${encodeURIComponent(locale)}`);
  };

  const signOut = async () => {
    if (!confirmInstructionsLeave()) return;
    clearFeedbackContext();
    setBusy(true);
    calendarScopeRef.current = null; calendarReadGeneration.current += 1; calendarActionGeneration.current += 1;
    setCalendarRead(null); setCalendarImport(null); setCalendarConfirmation(null);
    try {
      await jsonRequest("/api/auth/sign-out", { method: "POST", body: "{}" });
      memberRemovalRequestId.current += 1;
      memberAdminScopeRef.current = null;
      setMemberRemoval(null);
      clearAiImages();
      aiRecoveryClient.current?.dispose();
      setAiPrompt("");
      await purgePrivateOfflineDataOnSignOut();
      router.replace("/auth/sign-in");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to sign out.");
      setBusy(false);
    }
  };

  const enableDisruptionNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const moveOverviewDay = useCallback((offset: -1 | 1) => {
    if (!overview || !selectedOverviewDate) return;
    const nextDay = shiftTripDay(overview.days, selectedOverviewDate, offset);
    if (nextDay) setSelectedOverviewDate(nextDay.date);
  }, [overview, selectedOverviewDate]);

  const finishOverviewSwipe = (clientX: number, clientY: number) => {
    const start = overviewSwipeStart.current;
    overviewSwipeStart.current = null;
    if (!start) return;
    const horizontalDistance = clientX - start.x;
    const verticalDistance = clientY - start.y;
    if (Math.abs(horizontalDistance) < 54 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) return;
    moveOverviewDay(horizontalDistance < 0 ? 1 : -1);
  };

  const todayDate = overview ? tripLocalDateKey(new Date(nowMs), overview.trip.timeZone) : "";
  const dayGroupsScope = overview ? `${overview.trip.id}:${overview.session.memberId}:${todayDate}` : "";
  const revealItineraryItem = (itemId: string) => {
    setSection("itinerary");
    // Runs after the new section's layout effect; explicit item intent wins over the default today jump.
    window.setTimeout(() => itineraryGroupsRef.current?.revealItem(itemId), 0);
  };
  const openActivityTarget = async (entry: ActivityEntry) => {
    const scope = memberAdminScopeRef.current;
    if (!overview?.session.isOwner || !scope || activityOpeningId || busy) return;
    const generation = ++activityRequestGeneration.current;
    setActivityOpeningId(entry.id); setActivityDetail(null);
    const copy = activityMessages(locale);
    const isCurrent = () => memberAdminScopeRef.current === scope && activityRequestGeneration.current === generation;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 15_000);
    try {
      const result = await jsonRequest<{ entry: ActivityEntry; request: ApprovalRequest | null }>(
        `/api/trips/${overview.trip.id}/activity/${entry.id}`, { cache: "no-store", signal: abort.signal },
      );
      if (!isCurrent()) return;
      if (!result.entry.target) { setNotice(result.entry.targetState === "removed" ? copy.removed : copy.unavailable); return; }
      if (result.entry.target.kind === "request") {
        if (result.request) setActivityDetail({ scope, request: result.request });
        else setNotice(copy.unavailable);
        return;
      }
      const current = await refresh({ syncDrafts: false });
      if (!isCurrent()) return;
      if (!current?.session.isOwner) { setNotice(current ? copy.unavailable : copy.loadFailed); return; }
      const target = result.entry.target;
      const exists = target.kind === "itinerary"
        ? current.itinerary.some((item) => item.id === target.id) || current.pendingItinerary.some((item) => item.targetItemId === target.id)
        : current.expenses.some((expense) => expense.id === target.id);
      if (!exists) { setNotice(copy.unavailable); return; }
      setSection(target.kind === "itinerary" ? "itinerary" : "expenses");
      window.setTimeout(() => {
        if (!isCurrent()) return;
        if (target.kind === "itinerary") itineraryGroupsRef.current?.revealItem(target.id);
        else expenseGroupsRef.current?.revealExpense(target.id);
      }, 0);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof JsonRequestError && [401, 403].includes(error.status)) {
        setActivityAccessLost(true); setActivityDetail(null); void refresh({ syncDrafts: false });
      }
      setNotice(error instanceof JsonRequestError && [401, 403, 404].includes(error.status) ? copy.unavailable : copy.loadFailed);
    } finally { window.clearTimeout(timeout); if (isCurrent()) setActivityOpeningId(null); }
  };
  const expenseDayGroups = useMemo(() => overview ? groupExpenseDays({
    days: overview.days, expenses: overview.expenses, pendingExpenses: overview.pendingExpenses,
    memberPayments: overview.memberPayments, timeZone: overview.trip.timeZone,
  }) : [], [overview]);
  const pendingItinerary = useMemo(() => (overview?.pendingItinerary ?? [])
    .filter((request) => request.status === "pending")
    .sort((a, b) => {
      if (a.startsAt && b.startsAt) return a.startsAt.localeCompare(b.startsAt) || a.createdAt.localeCompare(b.createdAt);
      if (a.startsAt) return -1;
      if (b.startsAt) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    }), [overview]);
  const canonicalItineraryTimelinePoints = useMemo(() => overview
    ? projectCalendarAwareTimelinePoints(overview.itinerary, {
        tripDays: overview.days,
        timeZone: overview.trip.timeZone,
      })
    : [], [overview]);
  const pendingUpdateTargets = useMemo(
    () => pendingUpdateTargetIds(pendingItinerary),
    [pendingItinerary],
  );
  const itineraryTimelinePoints = useMemo(
    () => canonicalItineraryTimelinePoints.filter((point) => !pendingUpdateTargets.has(point.item.id)),
    [canonicalItineraryTimelinePoints, pendingUpdateTargets],
  );
  const pendingTimelinePoints = useMemo(() => overview
    ? projectCalendarAwareTimelinePoints(
        pendingItinerary.map((request) => ({ ...request, id: request.requestId })),
        { tripDays: overview.days, timeZone: overview.trip.timeZone },
      )
    : [], [overview, pendingItinerary]);
  const personalCalendarPoints = useMemo(() => overview && calendarState
    ? projectPersonalCalendarEvents(calendarState.events, overview.days.map((day) => day.date), overview.trip.timeZone)
    : [], [overview, calendarState]);
  const itineraryDayGroups = useMemo(() => {
    if (!overview) return [];
    return overview.days.map((day) => {
      const points = itineraryTimelinePoints.filter((point) => point.tripDayId === day.id);
      const pendingPoints = pendingTimelinePoints.filter((point) => point.tripDayId === day.id);
      return {
        ...day,
        points,
        itemCount: new Set(points.map((point) => point.item.id)).size,
        pendingPoints,
        pendingRequestCount: new Set(pendingPoints.map((point) => point.item.requestId)).size,
        calendarPoints: personalCalendarPoints.filter((point) => point.date === day.date),
      };
    });
  }, [itineraryTimelinePoints, overview, pendingTimelinePoints, personalCalendarPoints]);
  const usageTotals = useMemo(() => overview?.aiLogs.reduce((totals, log) => ({
    input: totals.input + (log.inputTokens ?? 0),
    output: totals.output + (log.outputTokens ?? 0),
    succeeded: totals.succeeded + (log.status === "succeeded" ? 1 : 0),
    failed: totals.failed + (log.status === "failed" ? 1 : 0),
    rejected: totals.rejected + (log.status === "rejected" ? 1 : 0),
  }), { input: 0, output: 0, succeeded: 0, failed: 0, rejected: 0 })
    ?? { input: 0, output: 0, succeeded: 0, failed: 0, rejected: 0 }, [overview]);
  const selectedOverviewDay = useMemo(() => {
    if (!overview) return null;
    return overview.days.find((day) => day.date === selectedOverviewDate)
      ?? pickCurrentTripDay(overview.days, overview.trip.timeZone);
  }, [overview, selectedOverviewDate]);
  const overviewTimelinePoints = useMemo(() => overview && selectedOverviewDay
    ? itineraryTimelinePoints.filter((point) => point.tripDayId === selectedOverviewDay.id)
    : [], [itineraryTimelinePoints, overview, selectedOverviewDay]);
  const canonicalOverviewTimelinePoints = useMemo(() => overview && selectedOverviewDay
    ? canonicalItineraryTimelinePoints.filter((point) => point.tripDayId === selectedOverviewDay.id)
    : [], [canonicalItineraryTimelinePoints, overview, selectedOverviewDay]);
  const overviewPendingPoints = useMemo(() => overview && selectedOverviewDay
    ? pendingTimelinePoints.filter((point) => point.tripDayId === selectedOverviewDay.id)
    : [], [overview, pendingTimelinePoints, selectedOverviewDay]);
  const overviewCalendarPoints = useMemo(() => selectedOverviewDay
    ? personalCalendarPoints.filter((point) => point.date === selectedOverviewDay.date) : [], [personalCalendarPoints, selectedOverviewDay]);
  const overviewPendingRequestCount = useMemo(
    () => new Set(overviewPendingPoints.map((point) => point.item.requestId)).size,
    [overviewPendingPoints],
  );
  const overviewLodgings = useMemo(() => {
    if (!overview || !selectedOverviewDay) return [];
    return overview.itinerary.filter((item) => {
      if (item.itemType !== "lodging" || item.status === "cancelled") return false;
      if (item.sourceCalendar?.allDay && item.sourceCalendar.startDate && item.sourceCalendar.endDateExclusive) {
        return item.sourceCalendar.startDate <= selectedOverviewDay.date && selectedOverviewDay.date < item.sourceCalendar.endDateExclusive;
      }
      if (item.tripDayId === selectedOverviewDay.id) return true;
      if (!item.startsAt || !item.endsAt) return false;
      const startsOn = tripLocalDateKey(item.startsAt, overview.trip.timeZone);
      const endsOn = tripLocalDateKey(item.endsAt, overview.trip.timeZone);
      return startsOn <= selectedOverviewDay.date && endsOn >= selectedOverviewDay.date;
    });
  }, [overview, selectedOverviewDay]);
  const nextPoint = useMemo(
    () => nextUpcomingTimelinePoint(canonicalOverviewTimelinePoints.filter((point) => !point.item.sourceCalendar?.allDay), nowMs),
    [canonicalOverviewTimelinePoints, nowMs],
  );
  const countdown = nextPoint?.at
    ? formatCountdown(new Date(nextPoint.at).getTime(), nowMs, locale)
    : null;
  const overviewItemCount = useMemo(
    () => new Set(overviewTimelinePoints.map((point) => point.item.id)).size + overviewCalendarPoints.length,
    [overviewTimelinePoints, overviewCalendarPoints],
  );
  const itineraryItemCount = useMemo(
    () => new Set(itineraryTimelinePoints.map((point) => point.item.id)).size + new Set(personalCalendarPoints.map((point) => point.event.id)).size,
    [itineraryTimelinePoints, personalCalendarPoints],
  );
  const selectedOverviewIndex = selectedOverviewDay
    ? overview?.days.findIndex((day) => day.id === selectedOverviewDay.id) ?? -1
    : -1;
  const actualTripDate = overview ? tripLocalDateKey(new Date(nowMs), overview.trip.timeZone) : null;

  if (!overview && offlineSnapshot) {
    return <OfflineItineraryPanel snapshot={offlineSnapshot} locale={locale} messages={messages} retry={() => void refresh()} />;
  }
  if (!overview) return <LoadingPanel error={loadError} retry={() => void refresh()} />;

  const eventCreatorId = editingItem === "new"
    ? overview.session.memberId
    : isPendingEventEditorTarget(editingItem)
      ? editingItem.detail.createdByMemberId
      : editingItem?.createdByMemberId ?? overview.session.memberId;
  const canonicalEditingItem = editingItem && editingItem !== "new" && !isPendingEventEditorTarget(editingItem)
    ? editingItem
    : null;
  const canManageEventAudience = editingItem === "new" || eventCreatorId === overview.session.memberId;
  const canManageEventLock = overview.session.isOwner;
  const activeMembers = overview.members.filter(
    (member) => member.status !== "revoked" && member.status !== "removed",
  );
  const eventExpenseMembers = eligibleEventExpenseMembers(overview.members, {
    createdByMemberId: eventCreatorId, visibility: eventDraft?.visibility ?? "trip",
    viewerMemberIds: eventDraft?.viewerMemberIds ?? [],
  });
  const expenseLinkedItem = expenseDraft ? resolveExpenseEvent(overview, expenseDraft) : null;
  const expenseAudienceMembers = eligibleEventExpenseMembers(overview.members, expenseLinkedItem ?? {
    createdByMemberId: overview.session.memberId, visibility: "trip", viewerMemberIds: [],
  });

  const quickAiCard = (inSheet: boolean) => <AiCard locale={locale} overview={overview} messages={messages} prompt={aiPrompt} setPrompt={setAiPrompt}
    reply={aiQuickReplyGone ? null : aiReply} sources={aiQuickReplyGone ? [] : aiSources} memory={aiQuickReplyGone ? null : aiMemory}
    busy={busy || aiThinking || aiState.activeConversationId === undefined} thinking={aiThinking} statusText={aiStatusText}
    selectedModel={selectedModel} setModel={updateModel} ownKeyChoice={ownKeyChoice} setOwnKeyChoice={setOwnKeyChoice} submit={askQuickAi}
    newConversation={() => setAiConversationResetOpen(true)} openHistory={() => { setQuickAiScope(null); setSection("ai"); }}
    historyLabel={aiHistoryCopy.viewHistory} imagePicker={overview.session.isGuest ? undefined : { ...aiImages, locale }}
    heading={!inSheet} autoFocus={inSheet && (aiQuickReplyGone || !aiReply)} />;

  return (
    <div className="app-shell">
      <DocumentLanguage locale={locale} />
      <aside className="sidebar">
        <div className="brand-lockup"><div className="stand-mark"><Image src="/stardust-mark.png" alt="" width={42} height={42} priority /></div><div><p className="brand-name">{messages.appName}</p><p className="brand-subtitle">STARDUST ITINERARY</p></div></div>
        <label className="trip-picker"><span>{messages.tripLabel}</span><select data-feedback-action="trip_switch" value={overview.trip.id} disabled={busy} onChange={(event) => void switchTrip(event.target.value)}>{overview.availableTrips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}</select><small>{overview.trip.startsOn} – {overview.trip.endsOn}</small><span className="trip-progress"><i style={{ width: "58%" }} /></span></label>
        <nav className="side-nav" aria-label="Primary navigation">
          {navItems.map(({ id, label, icon: Icon }) => <button data-feedback-action="navigate" className={section === id || (section === "activity" && id === "settings") ? "nav-item is-active" : "nav-item"} key={id} onClick={() => setSection(id)}><Icon size={19} /><span>{label}</span></button>)}
        </nav>
        <div className="party-mini"><span>{messages.members}</span><div className="avatar-stack">{overview.members.slice(0, 6).map((member) => <i key={member.id} title={`${member.displayName} · ${member.role}`}>{member.displayName.slice(0, 2).toUpperCase()}</i>)}</div></div>
      </aside>

      <main className="main-content">
        <header className={`topbar ${advancedStyles.feedbackSpace}`}><div><p className="eyebrow">{overview.trip.timeZone} · {overview.session.role}</p><h1>{section === "activity" ? activityMessages(locale).title : navItems.find((item) => item.id === section)?.label}</h1></div><div className="topbar-actions"><UiModeToggle locale={locale} /><LocaleSwitcher locale={locale} />{overview.session.isOwner ? <button data-feedback-action="navigate" className="icon-button" aria-label="Approval request notifications" onClick={() => setSection("requests")}><Bell size={19} />{overview.approvalPendingCount > 0 ? <span className="notification-dot" /> : null}</button> : null}<Link className="owner-avatar" href="/auth/sessions" title={overview.session.displayName}>{overview.session.displayName.slice(0, 2).toUpperCase()}</Link></div></header>
        {overview.session.isGuest && overview.session.guestExpiresAt ? <GuestBanner locale={locale} expiresAt={overview.session.guestExpiresAt} timeZone={overview.trip.timeZone} /> : null}
        {notice ? <div className="notice-banner" role="status"><span>{notice}{notice.includes("Google Calendar API is disabled") ? <> <a href={overview.calendar.setupUrl} target="_blank" rel="noreferrer">Enable the API</a></> : null}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={15} /></button></div> : null}
        {section === "today" ? <TripAdjacentNav trips={overview.availableTrips} currentTripId={overview.trip.id} locale={locale} disabled={busy} select={(tripId) => void switchTrip(tripId)} /> : null}
        {section === "today" || section === "itinerary" ? <TripOverviewBar trip={overview.trip} members={overview.members} today={todayDate} locale={locale} /> : null}

        {(section === "today" || section === "itinerary") && (
          <div className="dashboard-grid">
            <section
              className={`primary-column ${section === "today" ? "overview-swipe-surface" : ""}`}
              onTouchStart={section === "today" ? (event) => {
                const touch = event.touches[0];
                overviewSwipeStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
              } : undefined}
              onTouchEnd={section === "today" ? (event) => {
                const touch = event.changedTouches[0];
                if (touch) finishOverviewSwipe(touch.clientX, touch.clientY);
              } : undefined}
            >
              {section === "today" && selectedOverviewDay ? <>
                <OverviewDayStrip days={overview.days} selectedDate={selectedOverviewDay.date} todayDate={todayDate} locale={locale} select={setSelectedOverviewDate} />
                <div className="overview-day-header" aria-live="polite">
                  <div>
                    <p className="eyebrow">{selectedOverviewDay.date === actualTripDate ? messages.currentDay : formatMessage(messages.dayNumber, { number: selectedOverviewIndex + 1 })}</p>
                    <h2>{formatTripDay(selectedOverviewDay.date, locale)}</h2>
                    <small>{countLabelWithPending(overviewItemCount, overviewPendingRequestCount, messages.eventCountOne, messages.eventCountMany, messages)}</small>
                  </div>
                  <label className="offline-day-picker overview-date-picker"><span className="sr-only">{messages.offlineChooseDay}</span><select data-feedback-action="navigate" value={selectedOverviewDay.date} onChange={(event) => setSelectedOverviewDate(event.target.value)} aria-label={messages.offlineChooseDay}>{overview.days.map((day) => <option value={day.date} key={day.id}>{formatTripDay(day.date, locale)}</option>)}</select></label>
                  <p className="overview-swipe-hint"><ChevronLeft size={14} /> {messages.swipeDay} <ChevronRight size={14} /></p>
                </div>
                <section className="stay-card" aria-label={messages.stayForDay}>
                  <div><p className="eyebrow">{messages.stayForDay}</p><h2>{overviewLodgings.length ? countLabel(overviewLodgings.length, messages.hotelCountOne, messages.hotelCountMany) : messages.noHotelListed}</h2></div>
                  <div className="stay-links">{overviewLodgings.length ? overviewLodgings.map((item) => <a href={itineraryMapUrl(item)} target="_blank" rel="noreferrer" key={item.id} aria-label={formatMessage(messages.openEventInGoogleMaps, { title: item.title })}><MapPin size={17} /><span><strong>{item.title}</strong><small>{item.locationName || messages.openGoogleMaps}</small></span><ChevronRight size={17} /></a>) : <p>{messages.addLodgingHint}</p>}</div>
                </section>
                <article className="departure-card">
                  <NextEventHeader item={nextPoint?.item} weather={nextPoint?.weather ?? null} locale={locale} messages={messages} timeZone={overview.trip.timeZone} showDisruption={() => nextPoint && setDisruptionDetailItem(nextPoint.item)} />
                  {nextPoint ? <div className="departure-main"><div><p className="departure-time-label">{messages.startsIn}</p><p className="departure-time">{countdown}</p><p className="planned-time-copy"><Clock3 size={16} /> {messages.plannedFor} <strong>{nextPoint.at ? formatTime(nextPoint.at, locale, overview.trip.timeZone) : messages.timeNotSet}</strong></p></div><EventDestination point={nextPoint} locale={locale} messages={messages} timeZone={overview.trip.timeZone} /></div> : <div className="no-next-event"><Clock3 size={26} /><div><h2>{messages.noUpcomingEvent}</h2><p>{formatTripDay(selectedOverviewDay.date, locale)}</p></div></div>}
                </article>
              </> : null}
              <div className="section-heading day-section-heading"><div><p className="eyebrow">{section === "today" ? countLabelWithPending(overviewItemCount, overviewPendingRequestCount, messages.eventCountOne, messages.eventCountMany, messages) : countLabelWithPending(itineraryItemCount, pendingItinerary.length, messages.liveItemCountOne, messages.liveItemCountMany, messages)}</p><h2>{messages.itinerary}</h2></div>{overview.permissions.canEditItinerary ? <button data-feedback-action="event_open" className="primary-button fit-button" onClick={() => openEvent("new", section === "today" ? selectedOverviewDay?.date : undefined)}><Plus size={16} /> {messages.addPlanItem}</button> : null}</div>
              {section === "itinerary" ? <ItineraryDayJump days={overview.days} todayDate={todayDate} locale={locale} /> : null}
              {section === "today" ? <>
                {selectedOverviewDay ? <ItineraryDayMap overview={overview} day={selectedOverviewDay} locale={locale} /> : null}
                <TripTimeline overview={overview} locale={locale} messages={messages} points={overviewTimelinePoints} allowActionFallback busy={busy} calendarBusy={calendarBusy} openEvent={openEvent} cancelOrRestore={cancelOrRestore} removeCancelledEvent={removeCancelledEvent} syncCalendar={requestCalendarSync} showDisruption={setDisruptionDetailItem} emptyMessage={messages.noEventsForDay}
                    calendarPoints={overviewCalendarPoints} openCalendarImport={openCalendarImport} calendarImportBusy={calendarImportBusy}
                    pending={{ points: overviewPendingPoints, edit: (request) => void openPendingEvent(request),
                      canEdit: (request) => canEditPendingEvent(request, overview.session, overview.permissions),
                      editingRequestId: pendingEventLoadingId,
                      approve: overview.session.isOwner ? (requestId, revision) => void review(requestId, "approve", revision) : undefined,
                      reject: overview.session.isOwner ? (requestId, revision) => void review(requestId, "reject", revision) : undefined }}
                  />
                <button data-feedback-action="navigate" className="full-day-button standalone-day-button" onClick={() => setSection("itinerary")}>{messages.allPlans} <ChevronRight size={17} /></button>
              </> : <CurrentDayGroups className="itinerary-days" today={todayDate} key={`itinerary:${dayGroupsScope}`} ref={itineraryGroupsRef}>
                {itineraryDayGroups.map((group) => {
                  const displayCount = group.itemCount + group.pendingRequestCount + group.calendarPoints.length;
                  const displayLabel = countLabelWithPending(group.itemCount + group.calendarPoints.length, group.pendingRequestCount, messages.eventCountOne, messages.eventCountMany, messages);
                  return <DayAccordion className="itinerary-day" date={group.date} today={todayDate} key={group.date}>
                    <summary><span className="expense-day-toggle"><ChevronRight size={18} /><span><strong>{group.label || new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }).format(new Date(`${group.date}T00:00:00Z`))}</strong><small>{formatTripDay(group.date, locale)}{group.date === todayDate ? ` · ${expensePageCopy.currentDay}` : ""} · {displayLabel}</small></span></span><strong className="expense-day-total" data-zero={displayCount === 0}>{displayCount ? displayLabel : messages.noEvents}</strong></summary>
                    <div className="expense-day-body">
                      <ItineraryDayMap overview={overview} day={group} locale={locale} />
                      <TripTimeline overview={overview} locale={locale} messages={messages} points={group.points} busy={busy} calendarBusy={calendarBusy} openEvent={openEvent} cancelOrRestore={cancelOrRestore} removeCancelledEvent={removeCancelledEvent} syncCalendar={requestCalendarSync} showDisruption={setDisruptionDetailItem} emptyMessage={messages.noEventsForDay}
                        calendarPoints={group.calendarPoints} openCalendarImport={openCalendarImport} calendarImportBusy={calendarImportBusy}
                    pending={{ points: group.pendingPoints, edit: (request) => void openPendingEvent(request),
                      canEdit: (request) => canEditPendingEvent(request, overview.session, overview.permissions),
                      editingRequestId: pendingEventLoadingId,
                      approve: overview.session.isOwner ? (requestId, revision) => void review(requestId, "approve", revision) : undefined,
                      reject: overview.session.isOwner ? (requestId, revision) => void review(requestId, "reject", revision) : undefined }}
                  />
                    </div>
                  </DayAccordion>;
                })}
                <button data-feedback-action="navigate" className="full-day-button standalone-day-button" onClick={() => setSection("today")}>{messages.today} <ChevronRight size={17} /></button>
              </CurrentDayGroups>}
              {(section === "today" ? overviewTimelinePoints : itineraryTimelinePoints).some((point) => point.weather) ? <p className="weather-attribution"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">{messages.weatherAttribution}</a></p> : null}
              {section === "itinerary" ? <GoogleCalendarPanel overview={overview} locale={locale} messages={messages} state={calendarState} busy={calendarBusy} refresh={() => void loadCalendar()} syncAll={() => requestCalendarSync("all")} openItineraryItem={revealItineraryItem} /> : null}
            </section>
            <aside className="utility-column">{quickAiCard(false)}<PersonalExpenseWidget overview={overview} locale={locale} openExpenses={() => setSection("expenses")} addExpense={overview.permissions.canEditExpenses ? () => openExpense() : undefined} />{section === "today" && !overview.session.isGuest ? <GoogleCalendarPanel compact dateFilter={selectedOverviewDay?.date} overview={overview} locale={locale} messages={messages} state={calendarState} busy={calendarBusy} refresh={() => void loadCalendar()} syncAll={() => requestCalendarSync("all")} openItineraryItem={revealItineraryItem} /> : null}</aside>
          </div>
        )}

        {section === "ai" && <AiConversationPage
          key={aiScope} tripId={overview.trip.id} locale={locale} messages={aiHistoryCopy}
          timeZone={overview.trip.timeZone} isOwner={overview.session.isOwner} recovery={aiState} request={jsonRequest}
          refreshToken={`${aiState.request?.requestId ?? aiState.result?.requestId ?? ""}:${aiState.phase}:${aiState.request?.status ?? ""}:${aiState.activeConversationId ?? ""}`}
          newConversation={() => switchAiConversation()}
          resumeConversation={(id) => switchAiConversation(id)}
          onAuthorizationLost={() => {
            setAiPrompt("");
            clearAiImages();
            aiRecoveryClient.current?.reset();
            void aiRecoveryClient.current?.check(true);
          }}
          renderComposer={(conversationId, purpose) => <AiCard overview={overview} messages={messages}
            readOnly={purpose === "preferences"}
            locale={locale}
            prompt={aiPrompt} setPrompt={setAiPrompt} reply={aiState.error ? aiReply : null}
            sources={[]} memory={null} busy={busy || aiThinking} thinking={aiThinking}
            statusText={aiStatusText} selectedModel={selectedModel} setModel={updateModel} ownKeyChoice={ownKeyChoice} setOwnKeyChoice={setOwnKeyChoice}
            imagePicker={overview.session.isGuest ? undefined : { ...aiImages, locale }}
            submit={(event) => askAi(event, conversationId, purpose)} />}
        />}

        {section === "expenses" && <section className="page-panel">
          <div className="section-heading day-section-heading">
            <div><p className="eyebrow">{expensePageCopy.subtitle}</p><h2>{expensePageCopy.title}</h2></div>
            {overview.permissions.canEditExpenses ? <button data-feedback-action="expense_open" className="primary-button fit-button" disabled={busy} onClick={() => openExpense()}><Plus size={16} /> {expensePageCopy.add}</button> : null}
          </div>
          <TripExpenseSummary overview={overview} locale={locale} busy={busy} recordRepayment={overview.permissions.canEditExpenses ? openMemberPayment : undefined} />
          {paymentLocked && paymentDialog?.scope === paymentScope && !paymentDialogOpen && <button type="button" className="ghost-button" disabled={busy} onClick={() => setPaymentDialogOpen(true)}>{paymentCopy.resume}</button>}
          <div className="section-heading"><h3>{expensePageCopy.history}</h3></div>
          <CurrentDayGroups ref={expenseGroupsRef} className="expense-days" today={todayDate} key={`expenses:${dayGroupsScope}`}>{expenseDayGroups.map((group) => <DayAccordion date={group.date} today={todayDate} key={group.date}>
            <summary className="expense-day-summary"><span className="expense-day-toggle"><ChevronRight size={18} /><span>
              <strong>{group.label || new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }).format(new Date(`${group.date}T00:00:00Z`))}</strong>
              <small>{group.date}{group.date === todayDate ? ` · ${expensePageCopy.currentDay}` : ""} · {formatMessage(expensePageCopy.count, { count: group.expenses.length })}
                {group.pendingExpenses.length ? ` · ${group.pendingExpenses.length} ${messages.pendingExpenses}` : ""}
                {group.payments.length ? ` · ${formatMessage(paymentCopy.dayCount, { count: group.payments.length })}` : ""}</small>
            </span></span><span className="expense-day-total"><small>{expensePageCopy.myDayTotal}</small><strong data-zero={!group.totals.some(([, total]) => total > 0)}>{group.totals.length
              ? group.totals.map(([currency, total]) => formatMoney(total, currency, locale)).join(" · ")
              : formatMoney(0, overview.trip.defaultCurrency, locale)}</strong></span></summary>
            <div className="expense-day-body"><div className="data-list expense-list">{[
              ...group.expenses.map((expense) => ({ key: `expense:${expense.id}`, at: expense.occurredAt, node: <ExpenseDisplayCard recordId={expense.id} key={`expense:${expense.id}`} expense={expense} memberId={overview.session.memberId} locale={locale} timeZone={overview.trip.timeZone}>
                {overview.permissions.canEditExpenses && expense.status !== "void" ? <button data-feedback-action="expense_edit" className="mini-button" disabled={busy} onClick={() => openExpense(expense)}><PencilLine size={14} /> {expensePageCopy.edit}</button> : null}
                {expense.status === "draft" && overview.session.isOwner ? <>
                  <button data-feedback-action="expense_approve" className="mini-button" disabled={busy} onClick={() => void reviewExpenseDraft(expense, "approve")}><Check size={14} /> {messages.approveRequest}</button>
                  <button data-feedback-action="expense_reject" className="mini-button danger-button" disabled={busy} onClick={() => void reviewExpenseDraft(expense, "reject")}><X size={14} /> {messages.rejectRequest}</button>
                </> : null}
              </ExpenseDisplayCard> })),
              ...group.pendingExpenses.map((expense) => ({ key: `pending:${expense.requestId}`, at: expense.occurredAt, node: <PendingExpenseList key={`pending:${expense.requestId}`} expenses={[expense]} locale={locale} messages={messages} timeZone={overview.trip.timeZone} memberId={overview.session.memberId} busy={busy} isOwner={overview.session.isOwner} embedded
                review={(requestId, decision, proposalRevision) => void review(requestId, decision, proposalRevision)} /> })),
              ...group.payments.map((payment) => ({ key: `payment:${payment.id}`, at: payment.occurredAt, node: <MemberPaymentCard key={`payment:${payment.id}`} payment={payment} locale={locale} timeZone={overview.trip.timeZone} busy={busy} isOwner={overview.session.isOwner} act={openPaymentAction} /> })),
            ].sort(compareExpenseDayEntries).map((entry) => entry.node)}
            {!group.expenses.length && !group.pendingExpenses.length && !group.payments.length ? <p className="empty-state">{expensePageCopy.noExpenses}</p> : null}</div></div>
          </DayAccordion>)}</CurrentDayGroups>
        </section>}

        {section === "requests" && overview.session.isOwner && <section className="page-panel"><div className="section-heading"><div><p className="eyebrow">{messages.approvalQueueLabel}</p><h2>{messages.approvalQueueTitle}</h2></div><button className="ghost-button" disabled={busy || approvalHistoryLoading} onClick={() => void loadApprovalHistory("reset")}><RefreshCw size={15} /> {messages.refreshApprovalHistory}</button></div><ApprovalReviewContent requests={approvalHistoryTripId === overview.trip.id ? approvalHistory : []} locale={locale} messages={messages} timeZone={overview.trip.timeZone} busy={busy} loading={approvalHistoryLoading} error={approvalHistoryError} hasMore={approvalHistoryTripId === overview.trip.id && Boolean(approvalHistoryNextCursor)} retry={() => void loadApprovalHistory("reset")} loadMore={() => void loadApprovalHistory("more")} review={(requestId, decision, proposalRevision) => void review(requestId, decision, proposalRevision)} payments={overview.memberPayments ?? []} paymentAction={openPaymentAction} />
          {paymentLocked && paymentDialog?.scope === paymentScope && !paymentDialogOpen && <button type="button" className="ghost-button" disabled={busy} onClick={() => setPaymentDialogOpen(true)}>{paymentCopy.resume}</button>}
        </section>}


        {section === "activity" && overview.session.isOwner && <ActivityPanel entries={activityAccessLost ? [] : overview.activity} locale={locale} timeZone={overview.trip.timeZone} isOwner={overview.session.isOwner} busy={busy} openingId={activityOpeningId}
          open={(entry) => void openActivityTarget(entry)} back={() => { activityRequestGeneration.current += 1; setActivityOpeningId(null); setActivityDetail(null); setSection("settings"); }} refresh={() => void refresh({ syncDrafts: false })} />}


        {section === "settings" && <section className="page-panel settings-grid">
          <UiModeSettingsCard locale={locale} />
          {!activityAccessLost ? <AiInstructionsSettings tripId={overview.trip.id} scope={`${overview.trip.id}:${overview.session.memberId}:${overview.session.userId ?? ""}`} locale={locale} request={jsonRequest} onDirtyChange={instructionsDirtyChanged} /> : null}
          {!activityAccessLost ? <AiKeysSettings tripId={overview.trip.id} scope={`${overview.trip.id}:${overview.session.memberId}:${overview.session.userId ?? ""}`} locale={locale} request={jsonRequest} changed={() => void refresh()} /> : null}
          <article className="settings-card"><h2>{messages.switchTripTitle}</h2><p>{messages.switchTripDescription}</p><label>{messages.currentTripField}<select data-feedback-action="trip_switch" value={overview.trip.id} disabled={busy} onChange={(event) => void switchTrip(event.target.value)}>{overview.availableTrips.map((trip) => <option value={trip.id} key={trip.id}>{trip.name} · {trip.role}</option>)}</select></label><small>{overview.trip.destinationName} · {overview.trip.startsOn} – {overview.trip.endsOn}</small>{overview.session.isGuest ? null : <button className="primary-button fit-button" disabled={busy} onClick={openNewTrip}><Plus size={16} /> {messages.createNewTrip}</button>}</article>
          {overview.session.isOwner && tripSettings?.scope === tripSettingsScope(overview) ? <TripSettingsCard settings={tripSettings} setSettings={setTripSettings} busy={busy} memberCount={overview.trip.memberCount} messages={messages} submit={saveTripSettings} /> : null}
          {overview.session.isOwner && !activityAccessLost ? <TripDeletionCard locale={locale} busy={busy} open={() => void previewTripDeletion()} /> : null}
          <article className="settings-card"><h2>{messages.disruptionNotificationsTitle}</h2><p>{messages.disruptionNotificationsDescription}</p>{notificationPermission === "granted" ? <strong>{messages.disruptionNotificationsEnabled}</strong> : notificationPermission === "denied" ? <strong>{messages.disruptionNotificationsDenied}</strong> : notificationPermission === "unsupported" ? <small>{messages.disruptionNotificationsDenied}</small> : <button className="primary-button fit-button" disabled={busy} onClick={() => void enableDisruptionNotifications()}><Bell size={15} /> {messages.enableDisruptionNotifications}</button>}</article>
          {overview.session.isGuest ? null : <article className="settings-card"><h2>{messages.googleCalendar}</h2><strong>{overview.calendar.connected ? messages.calendarConnectedStatus : messages.calendarNotConnectedStatus}</strong><p>{formatMessage(messages.calendarConnectionPersonal, { name: overview.session.displayName })}</p>{overview.permissions.canSyncCalendar ? (!overview.calendar.connected ? <button data-feedback-action="calendar_connect" className="primary-button fit-button" disabled={busy} onClick={() => setCalendarConnectIntent({ mode: "connect" })}><CalendarRange size={15} /> {messages.linkGoogleCalendar}</button> : null) : <small>{messages.calendarAccessDisabledDescription}</small>}</article>}
          <article className="settings-card"><h2>Identity & devices</h2><p>Signed in as {overview.session.displayName}. Change your trip display name here; signing out revokes this device session.</p><form data-feedback-action="settings_save" className="inline-settings-form" onSubmit={saveProfileName}><label>Display name<input required maxLength={120} value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><button className="primary-button fit-button" disabled={busy || profileName.trim() === overview.session.displayName}>Save name</button></form><div className="dialog-actions"><Link className="auth-primary" href="/auth/sessions">Manage devices</Link><button data-feedback-action="logout" className="ghost-button" disabled={busy} onClick={() => void signOut()}><LogOut size={15} /> Sign out</button></div></article>
          <article className="settings-card members-settings-card">
            <div className="settings-card-heading"><div><h2>Members</h2><p>{overview.session.isOwner ? "Add a named member, or share one reusable Google sign-in link until capacity is reached." : "People currently listed on this trip."}</p><small>{overview.trip.memberCount} of {overview.trip.maxMembers} member places reserved, including the owner</small></div>{overview.session.isOwner && !overview.session.isGuest ? <button data-feedback-action="member_change" className="primary-button fit-button" disabled={busy || overview.trip.memberCount >= overview.trip.maxMembers} onClick={() => setNewMemberName("")}><UserPlus size={16} /> Add member</button> : null}</div>
            {overview.session.isOwner && !overview.session.isGuest ? <div className="group-invite-panel">
              <div><strong>Open trip invitation</strong><p>Anyone eligible for this app&apos;s basic Google sign-in can join as a new member with this link. Calendar access is separate, and each member can choose to connect it later. The link closes permanently when the trip reaches {overview.trip.maxMembers} members.</p></div>
              <label className="check-field"><input type="checkbox" checked={joinLinkShareKeys && ownKeysToShare} disabled={busy || !ownKeysToShare} onChange={(event) => setJoinLinkShareKeys(event.target.checked)} />{keysCopy.shareLinkCheckbox}</label>
              {!ownKeysToShare ? <small>{keysCopy.shareNeedsKey}</small> : null}
              <div className="member-actions">
                {tripJoinLink ? <button data-feedback-action="member_invite" className="mini-button" disabled={busy} onClick={() => void copyTripJoinLink()}><Copy size={14} /> Copy link</button> : null}
                <button data-feedback-action="member_invite" className="primary-button fit-button" disabled={busy || overview.trip.memberCount >= overview.trip.maxMembers} onClick={() => void createTripJoinLink()}>{overview.trip.joinLinkActive ? "Replace invite link" : "Generate invite link"}</button>
                {overview.trip.joinLinkActive ? <button data-feedback-action="member_change" className="mini-button danger-button" disabled={busy} onClick={() => void revokeTripJoinLink()}>Disable link</button> : null}
              </div>
              {tripJoinLink ? <label className="member-invite-link">Reusable trip invitation link<input readOnly value={tripJoinLink} onFocus={(event) => event.currentTarget.select()} /></label> : overview.trip.joinLinkActive ? <small>An invitation is active. Its secret is shown only when generated; replace it to receive a new copyable link.</small> : null}
            </div> : null}
            <div className="member-admin-list">{overview.members.map((member) => {
              const canInvite = member.status === "invited" && !member.identityBound;
              return <div className="member-admin-row" key={member.id}>
                <div><strong>{member.displayName}{member.id === overview.session.memberId ? " · you" : ""}</strong><small>{member.role} · {member.status} · Google sign-in {member.identityBound ? "linked" : "not linked"}</small>{overview.session.isOwner && member.googleEmail ? <small>{formatMessage(messages.memberGoogleEmail, { email: member.googleEmail })}</small> : null}{member.aiKeyGrant ? <small>{formatMessage(keysCopy.sharedBy, { owner: member.aiKeyGrant.sponsorName })}</small> : null}
                  {overview.session.isOwner ? <MemberRoleControl key={`${member.id}:${member.currentRevision}:${member.role}:${member.status}:${member.identityBound}`} member={member} locale={locale} busy={busy} save={(role) => updateMemberRole(member, role)} /> : null}
                </div>
                {overview.session.isOwner ? <div className="member-actions">
                  {canInvite ? <button data-feedback-action="member_invite" className="mini-button" disabled={busy} onClick={() => void createMemberInvitation(member.id)}><Copy size={14} /> Invite</button> : null}
                  {member.id !== overview.session.memberId ? <button data-feedback-action="member_change" className="mini-button" aria-pressed={Boolean(member.aiKeyGrant)} disabled={busy || (!member.aiKeyGrant && !ownKeysToShare)} title={!member.aiKeyGrant && !ownKeysToShare ? keysCopy.shareNeedsKey : undefined} onClick={() => void updateAiKeyGrant(member.id, !member.aiKeyGrant)}>{member.aiKeyGrant ? keysCopy.shareStop : keysCopy.shareStart}</button> : null}
                  <button data-feedback-action="member_change" className="mini-button" disabled={busy} onClick={() => requestMemberAccessChange(member)}>{member.status === "revoked" ? messages.enableMemberAccess : messages.disableMemberAccess}</button>
                  <button data-feedback-action="member_change" className="mini-button danger-button" disabled={busy || !member.canRemove} title={member.canRemove ? memberCopy.remove : memberCopy.lastOwner} onClick={() => void previewMemberRemoval(member)}><Trash2 size={14} /> {memberCopy.remove}</button>
                </div> : null}
                {canInvite && memberClaimLinks[member.id] ? <label className="member-invite-link">Invitation link<input readOnly value={memberClaimLinks[member.id]} onFocus={(event) => event.currentTarget.select()} /></label> : null}
              </div>;
            })}</div>
            {overview.session.isOwner ? <p className="muted-copy">{memberCopy.ownerEligibility}</p> : null}
          </article>
          <details className={advancedStyles.advanced} key={`advanced:${overview.trip.id}:${overview.session.memberId}:${overview.session.isOwner}`}>
            <summary data-feedback-action="navigate"><ChevronRight size={20} aria-hidden="true" /><span><strong>{advancedCopy.advanced}</strong><small>{overview.session.isOwner ? advancedCopy.description : advancedCopy.memberDescription}</small></span></summary>
            <div className={advancedStyles.body}>
          <article className="settings-card"><h2>{messages.aiAccess}</h2>
            <p>{aiFundingNote(overview.ai, messages, keysCopy) ?? (overview.ai.canSelectModel ? messages.aiOwnerAccessDescription : formatMessage(messages.aiMemberAccessDescription, { limit: overview.ai.memberDailyLimit }))}</p>
            {overview.ai.canSelectModel ? <label>{messages.aiOwnerDefaultModel}<select data-feedback-action="settings_save" value={selectedModel} disabled={busy} onChange={(event) => void updateModel(event.target.value)}>{selectableOwnerModels.map((model) => <option value={model} key={model}>{model}</option>)}</select></label> : null}
            {!overview.ai.canSelectModel && overview.session.isOwner && overview.ai.hostSubscriptionEnabled === false && ownKeysToShare ? <label>{keysCopy.sharedModelLabel}<select data-feedback-action="settings_save" value={overview.ai.ownerDefaultModel} disabled={busy} onChange={(event) => void updateSharedModel(event.target.value)}>{[...new Set([overview.ai.ownerDefaultModel, ...ownKeyModels(overview.ai.ownKeyProviders ?? [])])].map((model) => <option value={model} key={model}>{model}</option>)}</select></label> : null}
            {overview.session.isOwner ? <form className="inline-settings-form" data-feedback-action="settings_save" onSubmit={saveMemberDailyLimit}><label>{messages.aiMemberPromptsPerDay}<input type="number" min="1" max="1000" step="1" required value={memberDailyLimit} onChange={(event) => setMemberDailyLimit(event.target.value)} /></label><button data-feedback-action="settings_save" className="primary-button fit-button" disabled={busy}>{messages.saveAiLimit}</button></form> : overview.ai.enabled && !ownKeyAccess(overview.ai).ownKeyOnly ? <div className="quota-meter"><span style={{ width: `${Math.min(100, (overview.ai.usedToday / overview.ai.memberDailyLimit) * 100)}%` }} /></div> : null}
            {overview.ai.enabled && !ownKeyAccess(overview.ai).ownKeyOnly ? <strong>{overview.ai.canSelectModel ? formatMessage(messages.aiOwnerSummary, { limit: overview.ai.memberDailyLimit }) : formatMessage(messages.aiMemberRemaining, { remaining: overview.ai.remainingToday ?? 0 })}</strong> : null}
          </article>
              {overview.session.isOwner && overview.liveOperations ? <LiveOperationsCard status={overview.liveOperations} locale={locale} timeZone={overview.trip.timeZone} messages={messages} /> : null}
              <ActivitySettingsEntry locale={locale} isOwner={overview.session.isOwner} open={() => setSection("activity")} />
              <AdminEntry locale={locale} />
              <FeedbackOperations locale={locale} />
              {overview.session.isOwner ? <>
                <details className={advancedStyles.group}>
                  <summary data-feedback-action="navigate"><ChevronRight size={18} aria-hidden="true" />{advancedCopy.permissions}</summary>
                  <div className={advancedStyles.groupBody}>
                    <p className="muted-copy">{advancedCopy.permissionsDescription}</p>
                    <div className="request-grid">{overview.members.filter((member) => member.role !== "owner" && member.status !== "revoked" && member.status !== "removed").map((member) => <article className="settings-card permission-card" key={member.id}>
                      <div><h3>{member.displayName}</h3><small>{member.role} · {member.status} · {advancedCopy.googleIdentity}: {member.identityBound ? advancedCopy.linked : advancedCopy.unlinked}</small></div>
                      <div className="dialog-actions">{member.identityBound
                        ? <button data-feedback-action="member_change" className="ghost-button" disabled={busy} onClick={() => void unbindMemberIdentity(member.id)}>{advancedCopy.unbind}</button>
                        : member.status === "invited" ? <button data-feedback-action="member_invite" className="primary-button fit-button" disabled={busy} onClick={() => void createMemberInvitation(member.id)}>{advancedCopy.invite}</button> : null}</div>
                      {member.status === "invited" && !member.identityBound && memberClaimLinks[member.id] ? <label>{advancedCopy.invitation}<input readOnly value={memberClaimLinks[member.id]} onFocus={(event) => event.currentTarget.select()} /></label> : null}
                      <PermissionToggle label={advancedCopy.editItinerary} checked={member.permissions.canEditItinerary} disabled={busy} change={(checked) => void updatePermissions(member.id, { ...member.permissions, canEditItinerary: checked, itineraryRequiresApproval: checked ? member.permissions.itineraryRequiresApproval : false })} />
                      <PermissionToggle label={advancedCopy.itineraryApproval} checked={member.permissions.itineraryRequiresApproval} disabled={busy || !member.permissions.canEditItinerary} change={(checked) => void updatePermissions(member.id, { ...member.permissions, itineraryRequiresApproval: checked })} />
                      <PermissionToggle label={advancedCopy.editExpenses} checked={member.permissions.canEditExpenses} disabled={busy} change={(checked) => void updatePermissions(member.id, { ...member.permissions, canEditExpenses: checked, expenseRequiresApproval: checked ? member.permissions.expenseRequiresApproval : false })} />
                      <PermissionToggle label={advancedCopy.expenseApproval} checked={member.permissions.expenseRequiresApproval} disabled={busy || !member.permissions.canEditExpenses} change={(checked) => void updatePermissions(member.id, { ...member.permissions, expenseRequiresApproval: checked })} />
                      <PermissionToggle label={advancedCopy.syncCalendar} checked={member.permissions.canSyncCalendar} disabled={busy} change={(checked) => void updatePermissions(member.id, { ...member.permissions, canSyncCalendar: checked })} />
                    </article>)}</div>
                    {!overview.members.some((member) => member.role !== "owner" && member.status !== "revoked" && member.status !== "removed") ? <p className="empty-state">{advancedCopy.noMembers}</p> : null}
                  </div>
                </details>
                <details className={advancedStyles.group}>
                  <summary data-feedback-action="navigate"><ChevronRight size={18} aria-hidden="true" />{advancedCopy.usage}</summary>
                  <div className={advancedStyles.groupBody}>
                    <div className="section-heading"><p className="muted-copy">{advancedCopy.usageDescription}</p><button data-feedback-action="navigate" className="ghost-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />{advancedCopy.refresh}</button></div>
                    <div className="metric-grid">
                      <article className="metric-card"><span>{advancedCopy.requestsToday}</span><strong>{overview.ai.usedToday}</strong><small>{aiFundingNote(overview.ai, messages, keysCopy) ?? (overview.ai.canSelectModel ? messages.aiOwnerPolicy : formatMessage(messages.aiMemberQuota, { remaining: overview.ai.remainingToday ?? 0, limit: overview.ai.memberDailyLimit }))}</small></article>
                      <article className="metric-card"><span>{advancedCopy.inputTokens}</span><strong>{usageTotals.input.toLocaleString(locale)}</strong><small>{formatMessage(advancedCopy.outputTokens, { count: usageTotals.output.toLocaleString(locale) })}</small></article>
                      <article className="metric-card"><span>{advancedCopy.outcomes}</span><strong>{formatMessage(advancedCopy.succeededCount, { count: usageTotals.succeeded })}</strong><small>{formatMessage(advancedCopy.otherOutcomes, { failed: usageTotals.failed, rejected: usageTotals.rejected })}</small></article>
                      <article className="metric-card"><span>{advancedCopy.effectiveModel}</span><strong>{overview.ai.effectiveModel}</strong><small>{formatMessage(advancedCopy.recentEntries, { count: overview.aiLogs.length })}</small></article>
                    </div>
                    <div className="section-heading"><div><h2>{advancedCopy.requestLog}</h2><p className="muted-copy">{advancedCopy.requestLogDescription}</p></div></div>
                    <div className="request-grid">{overview.aiLogs.map((log) => <article className="request-card" key={log.id}>
                      <div className="request-title"><span className={`status-tag status-${log.status}`}>{advancedRequestStatus(log.status, locale)}</span><strong>{aiLogExecutionLabel(log)}</strong></div>
                      {log.prompt ? <p><b>{advancedCopy.prompt}:</b> {log.prompt}</p> : null}
                      {log.result ? <p><b>{advancedCopy.result}:</b> {log.result}</p> : null}
                      {log.error ? <p>{log.error}</p> : null}
                      <small>{log.actorName} · {advancedCopy.provider}: {log.provider ?? advancedCopy.unknown} / {advancedCopy.transport}: {log.transport ?? advancedCopy.unknown} / {advancedCopy.billing}: {log.billingBasis ?? advancedCopy.unknown} · {formatMessage(advancedCopy.tokensAndLatency, { input: log.inputTokens ?? "?", output: log.outputTokens ?? "?", latency: log.latencyMs ?? "?" })} · {new Date(log.createdAt).toLocaleString(locale, { timeZone: overview.trip.timeZone })}</small>
                    </article>)}</div>
                    {!overview.aiLogs.length ? <p className="empty-state">{advancedCopy.noLogs}</p> : null}
                  </div>
                </details>
              </> : null}
            </div>
          </details>
        </section>}
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">{navItems.map(({ id, label, icon: Icon }) => <button data-feedback-action="navigate" className={section === id || (section === "activity" && id === "settings") ? "bottom-item is-active" : "bottom-item"} key={id} onClick={() => setSection(id)}><Icon size={20} /><span>{label.replace(/ \(.*/, "")}</span></button>)}</nav>
      <NewBottomNav items={navItems} section={section} navigate={setSection} pendingCount={overview.approvalPendingCount} locale={locale} />
      {/* `enabled` stays false until the viewer has a key; `keyRequired` means the owners allow AI and the sheet explains the key. */}
      <QuickAiButton section={section} available={overview.ai.enabled || overview.ai.keyRequired === true} label={messages.askAi} open={() => setQuickAiScope(aiScope)} />
      {quickAiOpen && section !== "ai" ? <Modal title={messages.askAi} closeLabel={messages.cancelButton} close={() => setQuickAiScope(null)}>
        <div className="quick-ai-sheet">{quickAiCard(true)}</div>
      </Modal> : null}

      {overview.session.isOwner && !activityAccessLost && activityDetail?.scope === memberAdminScope && <Modal title={activityMessages(locale).requestDetail} closeLabel={messages.cancelButton} close={() => setActivityDetail(null)}>
        <ApprovalRequestCards requests={[activityDetail.request]} locale={locale} messages={messages} timeZone={overview.trip.timeZone} busy={busy} readOnly review={() => undefined} />
      </Modal>}

      {newMemberName !== null ? <Modal title="Add trip member" close={() => setNewMemberName(null)}><form data-feedback-action="member_change" className="form-grid" onSubmit={addMember}><label className="full-field">Member name<input autoFocus required maxLength={120} value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} /></label><label className="check-field full-field"><input type="checkbox" checked={newMemberShareKeys && ownKeysToShare} disabled={busy || !ownKeysToShare} onChange={(event) => setNewMemberShareKeys(event.target.checked)} />{keysCopy.shareCheckbox}</label>{!ownKeysToShare ? <small className="full-field">{keysCopy.shareNeedsKey}</small> : null}<p className="full-field muted-copy">This creates an inactive member. Afterward, click Invite to copy a one-time link. The first Google account that completes that link becomes this member’s identity.</p><div className="dialog-actions full-field"><button className="primary-button fit-button" disabled={busy || !newMemberName.trim()}><UserPlus size={16} /> Create member</button><button data-feedback-action="dialog_close" type="button" className="ghost-button" onClick={() => setNewMemberName(null)}>Cancel</button></div></form></Modal> : null}

      {memberPendingDisable ? <Modal title={messages.disableMemberTitle} closeLabel={messages.disableMemberCloseLabel} close={() => setMemberPendingDisable(null)}><div className="calendar-consent"><div><p>{formatMessage(messages.disableMemberWarning, { name: memberPendingDisable.displayName })}</p><p>{messages.disableMemberIdentityLinked}</p></div><div className="dialog-actions"><button type="button" className="ghost-button" autoFocus onClick={() => setMemberPendingDisable(null)}>{messages.cancelButton}</button><button type="button" className="primary-button fit-button danger-button" onClick={() => void confirmMemberDisable()}>{messages.disableMemberConfirm}</button></div></div></Modal> : null}

      {memberRemoval && memberRemoval.scope === memberAdminScope ? <Modal title={memberCopy.removalTitle} closeLabel={memberCopy.cancel} close={closeMemberRemoval}>
        {memberRemoval.loading ? <p role="status">{memberCopy.loading}</p> : memberRemoval.preview ? <MemberRemovalReview key={memberRemoval.preview.previewDigest} preview={memberRemoval.preview} locale={locale} busy={busy} submit={confirmMemberRemoval} cancel={closeMemberRemoval} /> : <div className="member-removal-review"><p role="alert">{memberRemoval.error}</p><div className="dialog-actions"><button type="button" className="ghost-button" onClick={closeMemberRemoval}>{memberCopy.cancel}</button><button data-feedback-action="member_change" type="button" className="primary-button fit-button" disabled={busy} onClick={() => void previewMemberRemoval(memberRemoval.member)}>{memberCopy.retry}</button></div></div>}
      </Modal> : null}

      {tripDeletion && tripDeletion.scope === memberAdminScope ? <Modal title={tripDeletionCopy.dialogTitle} closeLabel={tripDeletionCopy.close} close={closeTripDeletion}>
        {tripDeletion.loading ? <p role="status">{tripDeletionCopy.loading}</p> : tripDeletion.preview ? <TripDeletionReview preview={tripDeletion.preview} locale={locale} busy={busy} submit={(name) => void confirmTripDeletion(name)} cancel={closeTripDeletion} createTrip={openNewTrip} /> : <div className="member-removal-review"><p role="alert">{tripDeletion.error}</p><div className="dialog-actions"><button type="button" className="ghost-button" onClick={closeTripDeletion}>{tripDeletionCopy.close}</button>{tripDeletion.uncertain ? <button type="button" className="primary-button fit-button" onClick={() => window.location.reload()}>{tripDeletionCopy.reload}</button> : <button type="button" className="primary-button fit-button" onClick={() => void previewTripDeletion()}>{tripDeletionCopy.retry}</button>}</div></div>}
      </Modal> : null}

      {aiConversationResetOpen ? <Modal title={messages.newAiConversationTitle} closeLabel={messages.cancelButton} close={() => { if (!busy) setAiConversationResetOpen(false); }}><div className="ai-conversation-confirm"><p>{messages.newAiConversationDescription}</p><div className="dialog-actions"><button data-feedback-action="dialog_close" type="button" className="ghost-button" autoFocus disabled={busy} onClick={() => setAiConversationResetOpen(false)}>{messages.cancelButton}</button><button data-feedback-action="ai_new" type="button" className="primary-button fit-button" disabled={busy || aiThinking} onClick={() => void resetAiMemory()}><Plus size={16} /> {messages.confirmNewAiConversation}</button></div></div></Modal> : null}

      {eventDraft && editingItem ? (
        <Modal title={editingItem === "new" ? messages.addPlanItem : isPendingEventEditorTarget(editingItem) ? messages.editPendingEvent : messages.editPlanItem} closeLabel={messages.cancelButton} close={() => { if (!eventSaveInFlight.current) { setEditingItem(null); setEventDraft(null); } }}>
          <form data-feedback-action="event_save" className="form-grid" onSubmit={saveEvent} onInvalidCapture={(event) => {
            const details = (event.target as HTMLElement).closest("details");
            if (details) details.open = true;
            setEventSaveError(eventEditorCopy.formInvalid);
          }}>
            <label>{messages.eventTitleField}<input required value={eventDraft.title} onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} /></label>
            <label>{messages.eventTypeField}<select value={eventDraft.itemType} onChange={(event) => updateEventType(event.target.value as EventDraft["itemType"])}>{["activity", "meal", "transport", "lodging", "note"].map((type) => <option value={type} key={type}>{eventTypeLabel(type, messages)}</option>)}</select></label>
            <EventTimeFields
              startsLabel={formatMessage(eventDraft.itemType === "transport" ? messages.transportDepartureTimeField : messages.eventStartsField, { timeZone: overview.trip.timeZone })}
              endsLabel={formatMessage(eventDraft.itemType === "transport" ? messages.transportArrivalTimeField : messages.eventEndsField, { timeZone: overview.trip.timeZone })}
              durationLabel={messages.eventDurationMinutesField} copy={eventEditorCopy}
              startsAt={eventDraft.startsAt} endsAt={eventDraft.endsAt} durationMinutes={eventDraft.durationMinutes}
              min={`${overview.trip.startsOn}T00:00`} max={`${overview.trip.endsOn}T23:59`} busy={busy}
              changeStart={updateEventStart} changeEnd={updateEventEnd} changeDuration={updateEventDuration} fillNow={fillEventTimeNow} />
            {eventDraft.itemType === "transport" ? <fieldset className="transport-endpoint-fields full-field">
              <legend>{messages.transportRouteFields}</legend>
              <p className="muted-copy full-field">{messages.transportEndpointHint}</p>
              <label>{messages.departureLocationField}<input value={eventDraft.departureLocationName} onChange={(event) => updateTransportLocation("departure", event.target.value)} /></label>
              <label>{messages.departureMapUrlField}<input type="url" disabled={!eventDraft.departureLocationName.trim()} placeholder="https://www.google.com/maps/place/..." value={eventDraft.departureMapUrl} onChange={(event) => setEventDraft({ ...eventDraft, departureMapUrl: event.target.value })} /></label>
              <label>{messages.destinationLocationField}<input value={eventDraft.destinationLocationName} onChange={(event) => updateTransportLocation("destination", event.target.value)} /></label>
              <label>{messages.destinationMapUrlField}<input type="url" disabled={!eventDraft.destinationLocationName.trim()} placeholder="https://www.google.com/maps/place/..." value={eventDraft.destinationMapUrl} onChange={(event) => setEventDraft({ ...eventDraft, destinationMapUrl: event.target.value })} /></label>
            </fieldset> : <label className="full-field">{messages.eventMapUrlField}<input type="url" placeholder="https://www.google.com/maps/place/..." value={eventDraft.mapUrl} onChange={(event) => setEventDraft({ ...eventDraft, mapUrl: event.target.value })} /><small>{messages.eventMapUrlHint}</small></label>}
            <label className="full-field">{messages.eventNotesField}<textarea value={eventDraft.notes} onChange={(event) => setEventDraft({ ...eventDraft, notes: event.target.value })} /></label>
            <fieldset className="split-field full-field privacy-field">
              <legend>{messages.eventAudienceField}</legend>
              {canManageEventAudience ? <>
                <label className="check-field"><input type="checkbox" checked={eventDraft.visibility === "private"} onChange={(event) => updateEventVisibility(event.target.checked ? "private" : "trip")} />{eventDraft.visibility === "private" ? <Lock size={15} /> : <Users size={15} />} {messages.privateEvent}</label>
                <p className="muted-copy">{messages.privateEventDescription}</p>
                {eventDraft.visibility === "private" ? <div className="split-options private-viewer-options">{activeMembers.filter((member) => member.id !== eventCreatorId).map((member) => <label className="check-field" key={member.id}><input type="checkbox" checked={eventDraft.viewerMemberIds.includes(member.id)} onChange={(event) => updateEventViewer(member.id, event.target.checked)} />{member.displayName}</label>)}</div> : null}
              </> : <p className="muted-copy"><Lock size={14} /> {formatMessage(messages.privateEventCreatorOnly, { name: isPendingEventEditorTarget(editingItem) ? editingItem.detail.requestedByName : editingItem.creatorName })}</p>}
            </fieldset>
            {canManageEventLock ? <label className="check-field owner-lock-field"><input type="checkbox" checked={eventDraft.isLocked} onChange={(event) => setEventDraft({ ...eventDraft, isLocked: event.target.checked })} />{eventDraft.isLocked ? <Lock size={15} /> : <Unlock size={15} />} <span><strong>{messages.ownerLock}</strong><small>{messages.ownerLockDescription}</small></span></label> : null}

            <details className="event-expense-details full-field">
              <summary><span>{messages.eventExpense}</span><small>{messages.optionalCollapsed}</small></summary>
              <div className="event-expense-fields">
                {canonicalEditingItem && overview.expenses.some((expense) => expense.itineraryItemId === canonicalEditingItem.id && expense.status !== "void") ? (
                  <div className="linked-expense-list full-field">
                    <strong>{messages.alreadyLinked}</strong>
                    {overview.expenses.filter((expense) => expense.itineraryItemId === canonicalEditingItem.id && expense.status !== "void").map((expense) => (
                      <button data-feedback-action="expense_edit" type="button" className="mini-button" key={expense.id} disabled={busy} onClick={() => { if (!eventSaveInFlight.current) { setEditingItem(null); setEventDraft(null); openExpense(expense); } }}>
                        {expense.description} · {formatMoney(expense.amountMinor, expense.currency, locale)}
                      </button>
                    ))}
                  </div>
                ) : null}
                <label className="check-field full-field"><input type="checkbox" disabled={!overview.permissions.canEditExpenses} checked={eventDraft.linkedExpense.enabled} onChange={(event) => setEventDraft({
                  ...eventDraft,
                  linkedExpense: {
                    ...eventDraft.linkedExpense,
                    enabled: event.target.checked,
                    description: eventDraft.linkedExpense.description || eventDraft.title,
                    occurredAt: eventDraft.linkedExpense.occurredAt || eventDraft.startsAt,
                  },
                })} /> {messages.addLinkedExpense}</label>
                {!overview.permissions.canEditExpenses ? <p className="muted-copy full-field">{messages.expenseChangesUnavailable}</p> : null}
                {eventDraft.linkedExpense.enabled ? <>
                  <label className="full-field">{messages.expenseDescriptionField}<input required maxLength={240} disabled={!overview.permissions.canEditExpenses} value={eventDraft.linkedExpense.description} onChange={(event) => setEventDraft({ ...eventDraft, linkedExpense: { ...eventDraft.linkedExpense, description: event.target.value } })} /></label>
                  <label>{messages.expenseAmountField}<input required disabled={!overview.permissions.canEditExpenses} type="number" inputMode="decimal" min={1 / currencyFactor(eventDraft.linkedExpense.currency)} step={1 / currencyFactor(eventDraft.linkedExpense.currency)} value={eventDraft.linkedExpense.amount} onChange={(event) => setEventDraft({ ...eventDraft, linkedExpense: { ...eventDraft.linkedExpense, amount: event.target.value } })} /></label>
                  <label>{messages.expenseCurrencyField}<input required disabled={!overview.permissions.canEditExpenses} maxLength={3} pattern="[A-Z]{3}" value={eventDraft.linkedExpense.currency} onChange={(event) => setEventDraft({ ...eventDraft, linkedExpense: { ...eventDraft.linkedExpense, currency: event.target.value.toUpperCase() } })} /></label>
                  <label>{formatMessage(messages.expenseWhenField, { timeZone: overview.trip.timeZone })}<input required disabled={!overview.permissions.canEditExpenses} type="datetime-local" value={eventDraft.linkedExpense.occurredAt} onChange={(event) => setEventDraft({ ...eventDraft, linkedExpense: { ...eventDraft.linkedExpense, occurredAt: event.target.value } })} /></label>
                  <EventExpenseParticipants members={eventExpenseMembers} allMembers={overview.members}
                    payerMemberId={eventDraft.linkedExpense.payerMemberId} splitMemberIds={eventDraft.linkedExpense.splitMemberIds}
                    disabled={!overview.permissions.canEditExpenses} payerLabel={messages.expensePaidByField}
                    splitsLabel={messages.expenseSharedByField} copy={eventEditorCopy}
                    changePayer={(payerMemberId) => setEventDraft({ ...eventDraft, linkedExpense: { ...eventDraft.linkedExpense, payerMemberId } })}
                    changeSplits={(splitMemberIds) => setEventDraft({ ...eventDraft, linkedExpense: { ...eventDraft.linkedExpense, splitMemberIds } })} />
                  <ExpenseSplitEditor draft={eventDraft.linkedExpense} members={overview.members} locale={locale}
                    disabled={busy || !overview.permissions.canEditExpenses}
                    change={(linkedExpense) => { if (!eventSaveInFlight.current) setEventDraft({ ...eventDraft, linkedExpense }); }} />
                  <p className="muted-copy full-field">{messages.eventExpenseAtomicNotice}</p>
                </> : null}
              </div>
            </details>

            <EventEditorFeedback error={eventSaveError} />
            <div className="dialog-actions full-field"><button className="primary-button fit-button" disabled={busy || (eventDraft.linkedExpense.enabled && eventDraft.linkedExpense.splitMode === "custom" && !expenseSplitPreview(eventDraft.linkedExpense).valid)}>{isPendingEventEditorTarget(editingItem) ? messages.savePendingChanges : overview.session.isOwner || (!overview.permissions.itineraryRequiresApproval && (!eventDraft.linkedExpense.enabled || !overview.permissions.expenseRequiresApproval)) ? eventDraft.linkedExpense.enabled ? messages.saveEventAndExpense : messages.saveEventNow : messages.requestOwnerApproval}</button><button type="button" className="ghost-button" disabled={busy} onClick={() => { if (!eventSaveInFlight.current) { setEditingItem(null); setEventDraft(null); } }}>{messages.cancelButton}</button></div>
          </form>
        </Modal>
      ) : null}

      {paymentDialogOpen && paymentDialog?.scope === paymentScope ? <Modal title={paymentDialog.kind === "create" ? paymentCopy.record : paymentCopy[paymentDialog.decision.action]} close={closeMemberPayment} closeLabel={paymentCopy.cancel}>
        {paymentDialog.kind === "create" ? <MemberPaymentForm draft={paymentDialog.draft} members={overview.members} isOwner={overview.session.isOwner} locale={locale} timeZone={overview.trip.timeZone} busy={busy} locked={paymentLocked} error={paymentError}
          change={(draft) => { if (!paymentInFlight.current && !paymentAttempt.current) setPaymentDialog({ ...paymentDialog, draft }); }} submit={submitMemberPayment} close={closeMemberPayment} />
          : <MemberPaymentDecisionForm decision={paymentDialog.decision} locale={locale} timeZone={overview.trip.timeZone} busy={busy} locked={paymentLocked} error={paymentError}
            change={(decision) => { if (!paymentInFlight.current && !paymentAttempt.current) setPaymentDialog({ ...paymentDialog, decision }); }} submit={submitMemberPayment} close={closeMemberPayment} />}
      </Modal> : null}

      {expenseDraft ? <Modal title={expenseDraft.id ? expensePageCopy.edit : expensePageCopy.add} close={closeExpense}>
        <form data-feedback-action="expense_save" className="form-grid" onSubmit={saveExpense} onInvalid={() => setExpenseFormError(eventEditorCopy.formInvalid)}>
          <EventEditorFeedback error={expenseFormError} />
          <fieldset className="form-grid full-field expense-editor-fields" disabled={busy}>
            <div className="full-field expense-payment-presets">
              <button type="button" className="mini-button" disabled={!expenseAudienceMembers.some((member) => member.id === overview.session.memberId)}
                aria-pressed={expenseDraft.payerMemberId === overview.session.memberId && expenseDraft.splitMemberIds.length === 1 && expenseDraft.splitMemberIds[0] === overview.session.memberId}
                onClick={() => chooseExpenseParticipants(true)}>{expensePageCopy.individual}</button>
              <button type="button" className="mini-button" onClick={() => chooseExpenseParticipants(false)}>{expensePageCopy.shared}</button>
            </div>
            <p className="full-field muted-copy">{expenseDraft.payerMemberId === overview.session.memberId && expenseDraft.splitMemberIds.length === 1 && expenseDraft.splitMemberIds[0] === overview.session.memberId
              ? expensePageCopy.individualHelp : expensePageCopy.splitHelp}</p>
            <label className="full-field">{messages.expenseDescriptionField}<input required maxLength={240} value={expenseDraft.description} onChange={(event) => setExpenseDraft({ ...expenseDraft, description: event.target.value })} /></label>
            <label>{messages.expenseAmountField}<input required type="number" min={1 / currencyFactor(expenseDraft.currency)} step={1 / currencyFactor(expenseDraft.currency)} inputMode="decimal" value={expenseDraft.amount} onChange={(event) => setExpenseDraft({ ...expenseDraft, amount: event.target.value })} /></label>
            <label>{messages.expenseCurrencyField}<input required pattern="[A-Z]{3}" maxLength={3} value={expenseDraft.currency} onChange={(event) => setExpenseDraft({ ...expenseDraft, currency: event.target.value.toUpperCase() })} /></label>
            <label className="full-field">{formatMessage(messages.expenseWhenField, { timeZone: overview.trip.timeZone })}<input required type="datetime-local" value={expenseDraft.occurredAt} onChange={(event) => setExpenseDraft({ ...expenseDraft, occurredAt: event.target.value })} /></label>
            <label className="full-field">{expensePageCopy.linkedField}<select disabled={Boolean(expenseDraft.id && expenseLinkedItem?.visibility === "private")} value={expenseDraft.itineraryItemId} onChange={(event) => updateExpenseEvent(event.target.value)}>
              {expenseDraft.itineraryItemId && expenseLinkedItem && !overview.itinerary.some((item) => item.id === expenseDraft.itineraryItemId)
                ? <option value={expenseDraft.itineraryItemId}>{expenseLinkedItem.title} · {cardCopy.removedLink}</option> : null}
              <option value="">{expensePageCopy.unlinked}</option>{overview.itinerary.filter((item) => item.status !== "cancelled" || item.id === expenseDraft.itineraryItemId).map((item) =>
                <option key={item.id} value={item.id}>{item.visibility === "private" ? `${expensePageCopy.private} · ` : ""}{item.title}{item.startsAt ? ` · ${formatDateTime(item.startsAt, locale, overview.trip.timeZone)}` : ""}</option>)}
            </select></label>
            <p className="full-field muted-copy">{expensePageCopy.linkedHelp}</p>
            {expenseLinkedItem?.visibility === "private" ? <p className="full-field private-expense-note"><Lock size={14} /> {expensePageCopy.privateHelp}</p> : null}
            <EventExpenseParticipants members={expenseAudienceMembers} allMembers={overview.members} payerMemberId={expenseDraft.payerMemberId} splitMemberIds={expenseDraft.splitMemberIds}
              disabled={busy} payerLabel={messages.expensePaidByField} splitsLabel={messages.expenseSharedByField} copy={eventEditorCopy}
              changePayer={(payerMemberId) => setExpenseDraft({ ...expenseDraft, payerMemberId })}
              changeSplits={(splitMemberIds) => setExpenseDraft({ ...expenseDraft, splitMemberIds })} />
            <ExpenseSplitEditor draft={expenseDraft} members={overview.members} locale={locale} disabled={busy}
              change={(draft) => { if (!expenseSavePending.current) setExpenseDraft(draft); }} />
            <div className="dialog-actions full-field"><button className="primary-button fit-button" disabled={busy || expenseDraft.splitMemberIds.length === 0 || (expenseDraft.splitMode === "custom" && !expenseSplitPreview(expenseDraft).valid)}>{overview.session.isOwner || !overview.permissions.expenseRequiresApproval ? expensePageCopy.save : expensePageCopy.approval}</button>
              <button type="button" className="ghost-button" onClick={closeExpense}>{expensePageCopy.cancel}</button></div>
          </fieldset>
        </form>
      </Modal> : null}

      {calendarImport && calendarImport.scope === calendarScope && overview.permissions.canEditItinerary ? <Modal title={calendarImportMessages(locale).title}
        closeLabel={calendarImportMessages(locale).cancel} close={() => { if (!calendarImportSaving.current) setCalendarImport(null); }}>
        <CalendarImportDialog key={`${calendarImport.scope}:${calendarImport.eventId}`} tripId={overview.trip.id} eventId={calendarImport.eventId}
          memberId={overview.session.memberId} members={overview.members} locale={locale} timeZone={overview.trip.timeZone} request={jsonRequest}
          onBusyChange={(value) => { if (calendarScopeRef.current === calendarImport.scope) { calendarImportSaving.current = value; setCalendarImportBusy(value); } }}
          close={() => { if (!calendarImportSaving.current) setCalendarImport(null); }}
          complete={(result) => {
            if (calendarScopeRef.current !== calendarImport.scope) return;
            calendarReadGeneration.current += 1;
            setCalendarRead((current) => current?.scope === calendarImport.scope ? { ...current, state: { ...current.state,
              events: current.state.events.map((event) => event.id === calendarImport.eventId ? { ...event, importState: result,
                linkedItineraryItemId: result.status === "approved" ? result.itemId : null } : event),
            } } : current);
            calendarImportSaving.current = false; setCalendarImportBusy(false); setCalendarImport(null);
            setNotice(result.status === "approved" ? calendarImportMessages(locale).saved : result.status === "pending" ? calendarImportMessages(locale).requested
              : result.status === "rejected" ? calendarImportMessages(locale).rejected : calendarImportMessages(locale).invalidated);
            void Promise.all([refresh(), loadCalendar(false)]).catch(() => undefined);
          }} />
      </Modal> : null}

      {inviteToast ? <aside className="invite-copy-toast" role="status"><Check size={16} /> {inviteToast}</aside> : null}

      {calendarConfirmation ? <aside className="calendar-confirmation" role="dialog" aria-live="polite" aria-label={messages.calendarLinkReady}><div><CalendarRange size={21} /><p><strong>{calendarConfirmation.message}</strong><span>{messages.calendarLinkReady}</span></p></div><div className="calendar-confirmation-actions"><button type="button" className="primary-button fit-button" onClick={viewCalendarConfirmation}>{calendarConfirmation.viewLabel}</button><button type="button" className="ghost-button" onClick={() => setCalendarConfirmation(null)}>{messages.dismiss}</button></div></aside> : null}

      {calendarOpeningUrl ? <aside className="calendar-navigation-loading" role="status" aria-live="polite" aria-busy="true"><div className="calendar-navigation-loading-card"><RefreshCw size={30} aria-hidden="true" /><strong>{messages.calendarOpeningEvent}</strong><span>{messages.calendarOpeningHint}</span></div></aside> : null}

      {calendarConnectIntent ? <Modal title={messages.allowCalendarAccess} closeLabel={messages.cancelButton} close={() => setCalendarConnectIntent(null)}><div className="calendar-consent"><div className="card-icon violet"><CalendarRange size={24} /></div><div><p>{messages.calendarConsentIntro}</p><ul><li>{calendarConnectIntent.mode === "item" ? messages.calendarConsentSingle : calendarConnectIntent.mode === "all" ? messages.calendarConsentAll : messages.calendarConsentConnect}</li><li>{messages.calendarConsentConflicts}</li><li>{messages.calendarConsentCancel}</li></ul><p className="policy-note">{messages.calendarTestingNotice}</p></div><div className="dialog-actions"><button data-feedback-action="dialog_close" className="ghost-button" onClick={() => setCalendarConnectIntent(null)}>{messages.notNow}</button><button data-feedback-action="calendar_connect" className="primary-button fit-button" onClick={beginCalendarAuthorization}>{messages.continueWithGoogle}</button></div></div></Modal> : null}

      {disruptionDetailItem?.disruption ? <Modal title={messages.disruptionDetailTitle} closeLabel={messages.cancelButton} close={() => setDisruptionDetailItem(null)}><DisruptionDetailBody disruption={disruptionDetailItem.disruption} locale={locale} messages={messages} timeZone={overview.trip.timeZone} /></Modal> : null}
    </div>
  );
}

function weatherConditionLabel(condition: string, messages: Messages): string {
  if (condition === "clear" || condition === "mainly_clear") return messages.weatherClear;
  if (condition === "partly_cloudy") return messages.weatherPartlyCloudy;
  if (condition === "overcast") return messages.weatherCloudy;
  if (condition === "fog") return messages.weatherFog;
  if (condition.includes("drizzle")) return messages.weatherDrizzle;
  if (condition.includes("rain") || condition === "rain_showers") return messages.weatherRain;
  if (condition.includes("snow")) return messages.weatherSnow;
  if (condition === "thunderstorm") return messages.weatherThunderstorm;
  return messages.weatherUnknown;
}

function WeatherGlyph({ icon }: { icon: string }) {
  const props = { size: 18, "aria-hidden": true } as const;
  if (icon === "sunny") return <Sun {...props} />;
  if (icon === "clear-night") return <CloudMoon {...props} />;
  if (icon === "partly-cloudy-day") return <CloudSun {...props} />;
  if (icon === "partly-cloudy-night") return <CloudMoon {...props} />;
  if (icon === "fog") return <CloudFog {...props} />;
  if (icon === "drizzle" || icon === "rain" || icon === "freezing-rain" || icon === "showers") {
    return <CloudRain {...props} />;
  }
  if (icon === "snow") return <CloudSnow {...props} />;
  if (icon === "thunderstorm") return <CloudLightning {...props} />;
  return <Cloud {...props} />;
}

function WeatherBadge({ weather, locale, messages, timeZone }: {
  weather: EventWeatherForecast;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}) {
  const stale = weather.stale;
  const temperature = weather.temperatureCelsius === null
    ? null
    : `${Math.round(weather.temperatureCelsius)}°`;
  const precipitationProbability = weather.precipitationProbabilityPercent === null
    ? null
    : Math.round(weather.precipitationProbabilityPercent);
  const detail = [
    weatherConditionLabel(weather.condition, messages),
    temperature,
    precipitationProbability === null
      ? null
      : formatMessage(messages.weatherRainChance, { percent: precipitationProbability }),
    weather.locationPrecision === "trip_destination" ? messages.weatherApproximate : null,
    stale ? messages.weatherStale : null,
    formatMessage(messages.weatherForecastFor, {
      date: formatDateTime(weather.forecastAt, locale, timeZone),
    }),
  ].filter(Boolean).join(" · ");
  return <span className={`weather-forecast-badge ${stale ? "is-stale" : ""}`} title={detail} role="img" aria-label={detail}>
    <span className="weather-forecast-condition" aria-hidden="true">
      <span className="weather-forecast-glyph"><WeatherGlyph icon={weather.icon} /></span>
      {precipitationProbability === null ? null : <small className="weather-forecast-probability"><Droplets size={10} />{precipitationProbability}%</small>}
    </span>
    <span className="weather-forecast-copy" aria-hidden="true">
      {temperature ? <small>{temperature}</small> : null}
      {weather.locationPrecision === "trip_destination" ? <small>{messages.weatherApproximate}</small> : null}
      {stale ? <small>{messages.weatherStale}</small> : null}
    </span>
  </span>;
}

function disruptionSourceHost(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || fallback;
  } catch {
    return fallback;
  }
}

export function disruptionReasonLabel(reason: DisruptionReasonCode, messages: Messages): string {
  const labels: Record<DisruptionReasonCode, string> = {
    cancellation: messages.disruptionCancellation,
    closure: messages.disruptionClosure,
    delay: messages.disruptionDelay,
    transit_disruption: messages.disruptionTransit,
    road_disruption: messages.disruptionRoad,
    weather: messages.disruptionWeather,
    hours_change: messages.disruptionHours,
    strike: messages.disruptionStrike,
    access_change: messages.disruptionAccess,
    other: messages.disruptionOther,
  };
  return labels[reason];
}

export function DisruptionDetailBody({ disruption, locale, messages, timeZone }: {
  disruption: EventDisruption;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}) {
  const localizedDetail = selectLocalizedDisruptionDetail(disruption.localizedDetails, locale);
  return <div className="disruption-detail">
    <span className={`disruption-detail-icon severity-${disruption.severity}`}><AlertTriangle size={24} aria-hidden="true" /></span>
    <div>
      <h3>{disruptionReasonLabel(disruption.reasonCode, messages)}</h3>
      {localizedDetail ? <p lang={disruptionDetailLocale(locale)}>{localizedDetail}</p>
        : locale === "en" ? <><small>{messages.disruptionOriginalText}</small><p>{disruption.detail}</p></>
          : <><p>{messages.disruptionTranslationUnavailable}</p><details><summary>{messages.disruptionOriginalText}</summary><p>{disruption.detail}</p></details></>}
      <small>{formatMessage(messages.disruptionCheckedAt, { date: formatDateTime(disruption.checkedAt, locale, timeZone) })}</small>
    </div>
    {disruption.sourceUrls.length ? <div className="disruption-sources"><strong>{messages.disruptionSources}</strong>{disruption.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">{disruptionSourceHost(url, formatMessage(messages.disruptionSourceNumber, { number: index + 1 }))}</a>)}</div> : null}
    <p className="policy-note">{messages.disruptionPossibleNotice}</p>
  </div>;
}

function DisruptionBadge({ item, messages, showDisruption }: {
  item: ItineraryItem;
  messages: Messages;
  showDisruption: () => void;
}) {
  if (!item.disruption) return null;
  return <button type="button" className={`disruption-badge severity-${item.disruption.severity}`} onClick={showDisruption} aria-label={formatMessage(messages.openDisruptionDetail, { event: item.title })}><AlertTriangle size={18} aria-hidden="true" /><small>{disruptionReasonLabel(item.disruption.reasonCode, messages)}</small></button>;
}

export function NextEventHeader({ item, weather, locale, messages, timeZone, showDisruption }: {
  item?: ItineraryItem | null;
  weather?: EventWeatherForecast | null;
  locale: Locale;
  messages: Messages;
  timeZone: string;
  showDisruption: () => void;
}) {
  return <div className="departure-topline">
    {weather ? <WeatherBadge weather={weather} locale={locale} messages={messages} timeZone={timeZone} /> : null}
    <div className="departure-topline-actions">
      <span className="status-pill"><Clock3 size={14} /> {messages.nextUp}</span>
      {item?.disruption ? <DisruptionBadge item={item} messages={messages} showDisruption={showDisruption} /> : null}
    </div>
  </div>;
}

function EventDestination({ point, locale, messages, timeZone }: { point: TimelinePoint<ItineraryItem>; locale: Locale; messages: Messages; timeZone: string }) {
  const item = point.item;
  if (point.kind !== "event") {
    const content = <><span>{point.kind === "departure" ? messages.departureLabel : messages.destinationLabel}</span><h2>{item.title}</h2><p>{point.locationName}</p><small><MapPin size={15} /> {messages.openGoogleMaps}</small></>;
    return <a className="departure-destination event-map-destination transport-next-event" href={endpointMapUrl(point.locationName ?? item.title, point.mapUrl)} target="_blank" rel="noreferrer" aria-label={formatMessage(messages.openLocationInGoogleMaps, { location: point.locationName ?? item.title })}>{content}<span className="sr-only">{formatDateTime(point.at, locale, timeZone)}</span></a>;
  }
  const content = <><span>{eventStatusLabel(item.status, messages)}</span><h2>{item.title}</h2><p>{item.locationName || eventTypeLabel(item.itemType, messages)}</p><small><MapPin size={15} /> {messages.openGoogleMaps}</small></>;
  return <a className="departure-destination event-map-destination" href={itineraryMapUrl(item)} target="_blank" rel="noreferrer" aria-label={formatMessage(messages.openEventInGoogleMaps, { title: item.title })}>{content}<span className="sr-only">{formatDateTime(item.startsAt, locale, timeZone)}</span></a>;
}

function ownsVisibleTimelineActions<TItem extends TimelineSource>(
  point: TimelinePoint<TItem>,
  points: readonly TimelinePoint<TItem>[],
  allowFallback = false,
): boolean {
  if (point.ownsActions) return true;
  if (!allowFallback || points.some((candidate) => (
    candidate.item.id === point.item.id && candidate.ownsActions
  ))) return false;
  return points.find((candidate) => candidate.item.id === point.item.id)?.key === point.key;
}

export function PendingItineraryList({ points, locale, messages, timeZone, busy, allowActionFallback = false, edit, canEdit, editingRequestId = null, approve, reject, embedded = false }: {
  points: TimelinePoint<PendingTimelineItem>[];
  locale: Locale;
  messages: Messages;
  timeZone: string;
  busy: boolean;
  allowActionFallback?: boolean;
  edit?: (request: PendingItineraryProjection) => void;
  canEdit?: (request: PendingItineraryProjection) => boolean;
  editingRequestId?: string | null;
  embedded?: boolean;
  approve?: (requestId: string, proposalRevision: number) => void;
  reject?: (requestId: string, proposalRevision: number) => void;
}) {
  if (!points.length) return null;
  const rows = points.map((point) => {
      const request = point.item;
      const requestId = request.requestId;
      const proposalRevision = request.proposalRevision;
      const hasRevision = Number.isSafeInteger(proposalRevision) && proposalRevision > 0;
      const ownsActions = ownsVisibleTimelineActions(point, points, allowActionFallback);
      const canEditRequest = Boolean(edit && (canEdit?.(request) ?? true));
      const pointLabel = point.kind === "departure" ? messages.departureLabel : point.kind === "arrival" ? messages.destinationLabel : null;
      return <article className="timeline-row pending-timeline-row" data-pending-timeline-point={point.kind} data-pending-target-item-id={request.targetItemId ?? undefined} data-owns-actions={ownsActions} key={point.key}>
      <div className="timeline-time"><time>{request.sourceCalendar?.allDay ? calendarImportMessages(locale).allDay : request.sourceCalendar && point.tripDayId !== request.tripDayId ? calendarImportMessages(locale).continues : point.at ? formatTime(point.at, locale, timeZone) : messages.timeNotSet}</time></div>
      <div className="timeline-marker"><span><Clock3 size={14} aria-hidden="true" /></span></div>
      <div className="timeline-content">
      <div className="pending-itinerary-status"><span className="status-tag status-pending"><Clock3 size={14} aria-hidden="true" />{request.operation === "create" ? messages.pendingOwnerApproval : request.operation === "cancel" ? `${messages.cancelEvent} · ${messages.pendingOwnerApproval}` : request.operation === "restore" ? `${messages.restoreEvent} · ${messages.pendingOwnerApproval}` : messages.pendingEventUpdate}</span>{request.visibility === "private" ? <span className="status-tag"><Lock size={11} aria-hidden="true" /> {messages.privateEvent}</span> : null}</div>
      <h3>{request.title}</h3>
      {pointLabel
        ? point.locationName
          ? <a className="transport-endpoint" href={endpointMapUrl(point.locationName, point.mapUrl)} target="_blank" rel="noreferrer" aria-label={formatMessage(messages.openLocationInGoogleMaps, { location: point.locationName })}><span className="transport-endpoint-label">{pointLabel}</span><strong>{point.locationName}</strong><time><Clock3 size={12} aria-hidden="true" /> {point.at ? formatDateTime(point.at, locale, timeZone) : messages.timeNotSet}</time><small><MapPin size={12} aria-hidden="true" /> {messages.openGoogleMaps}</small></a>
          : null
        : <><p>{point.locationName ? <><MapPin size={14} aria-hidden="true" /> {point.locationName}</> : eventTypeLabel(request.itemType, messages)}</p><small>{request.sourceCalendar?.allDay ? calendarImportMessages(locale).allDay : <>{point.at ? formatDateTime(point.at, locale, timeZone) : messages.timeNotSet}{request.endsAt ? ` – ${formatTime(request.endsAt, locale, timeZone)}` : ""}</>}</small></>}
      {request.notes ? <p className="pending-itinerary-notes">{request.notes}</p> : null}
      <small>{formatMessage(messages.pendingEventRequestedBy, { name: request.requestedByName })} · {formatDateTime(request.createdAt, locale, timeZone)}</small>
      <p className="pending-itinerary-warning"><Clock3 size={14} aria-hidden="true" /> {request.operation !== "create" ? messages.pendingEventUpdateNotApplied : messages.pendingEventNotConfirmed}</p>
      </div>
      {ownsActions && (canEditRequest || (approve && reject)) ? <div className="card-actions pending-review-actions">
        {canEditRequest ? <button data-feedback-action="event_edit" type="button" className="ghost-button" disabled={busy || Boolean(editingRequestId)} aria-busy={editingRequestId === request.requestId} onClick={() => edit?.(request)}>{mobileCardsMessages(locale).editShort}</button> : null}
        {approve && reject ? <><button data-feedback-action="event_approve" type="button" className="primary-button fit-button" disabled={busy || Boolean(editingRequestId) || !hasRevision} onClick={() => { if (hasRevision) approve(requestId, proposalRevision); }}>{mobileCardsMessages(locale).approveShort}</button><button data-feedback-action="event_reject" type="button" className="ghost-button danger-button" disabled={busy || Boolean(editingRequestId) || !hasRevision} onClick={() => { if (hasRevision) reject(requestId, proposalRevision); }}>{mobileCardsMessages(locale).rejectShort}</button></> : null}
      </div> : null}
    </article>;
    });
  return embedded ? <>{rows}</> : <section className="timeline-card" aria-label={messages.pendingEvents}>{rows}</section>;
}

export function PendingExpenseList({ expenses, locale, messages, timeZone, busy, isOwner, review, memberId, embedded = false }: {
  expenses: PendingExpenseProjection[];
  locale: Locale;
  messages: Messages;
  timeZone: string;
  busy: boolean;
  isOwner: boolean;
  memberId?: string;
  embedded?: boolean;
  review: (requestId: string, decision: "approve" | "reject", proposalRevision: number) => void;
}) {
  if (!expenses.length) return null;
  const cards = expenses.map((expense) => {
    const requestId = expense.requestId;
    const proposalRevision = expense.proposalRevision;
    const hasRevision = Number.isSafeInteger(proposalRevision) && proposalRevision > 0;
    return <ExpenseDisplayCard key={requestId} expense={expense} memberId={memberId} locale={locale} timeZone={timeZone} pendingNote={messages.pendingExpenseNotIncluded}>
      {isOwner ? <>
        <button data-feedback-action="expense_approve" type="button" className="mini-button" disabled={busy || !hasRevision} onClick={() => { if (hasRevision) review(requestId, "approve", proposalRevision); }}><Check size={14} aria-hidden="true" /> {messages.approveRequest}</button>
        <button data-feedback-action="expense_reject" type="button" className="mini-button danger-button" disabled={busy || !hasRevision} onClick={() => { if (hasRevision) review(requestId, "reject", proposalRevision); }}><X size={14} aria-hidden="true" /> {messages.rejectRequest}</button>
      </> : null}
    </ExpenseDisplayCard>;
  });
  return embedded ? <>{cards}</> : <section className="data-list expense-list" aria-label={messages.pendingExpenses}>{cards}</section>;
}

export function ApprovalRequestList({ requests, locale, messages, timeZone, busy, review }: {
  requests: ApprovalRequest[];
  locale: Locale;
  messages: Messages;
  timeZone?: string;
  busy: boolean;
  review: (requestId: string, decision: "approve" | "reject", proposalRevision: number) => void;
}) {
  return <ApprovalRequestCards requests={requests} locale={locale} messages={messages} timeZone={timeZone} busy={busy} review={review} />;
}

export function ApprovalReviewContent({ payments, paymentAction, ...history }: Parameters<typeof ApprovalHistoryPanel>[0] & {
  payments: MemberPayment[];
  paymentAction: (payment: MemberPayment, action: PaymentAction) => void;
}) {
  const pendingPayments = payments.filter((payment) => payment.status === "pending" && payment.canReview);
  const remainingPayments = payments.filter((payment) => payment.status === "rejected"
    || (payment.status === "pending" && !payment.canReview));
  const paymentProps = { locale: history.locale, timeZone: history.timeZone ?? "UTC", busy: history.busy,
    isOwner: true, reviewOnly: true, act: paymentAction };
  return <>
    {pendingPayments.length > 0 ? <MemberPaymentHistory payments={pendingPayments} {...paymentProps} /> : null}
    <ApprovalHistoryPanel {...history} />
    {remainingPayments.length > 0 ? <MemberPaymentHistory payments={remainingPayments} {...paymentProps} /> : null}
  </>;
}

export function ApprovalHistoryPanel({
  requests,
  locale,
  messages,
  timeZone,
  busy,
  loading,
  error,
  hasMore,
  retry,
  loadMore,
  review,
}: {
  requests: ApprovalRequest[];
  locale: Locale;
  messages: Messages;
  timeZone?: string;
  busy: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  retry: () => void;
  loadMore: () => void;
  review: (requestId: string, decision: "approve" | "reject", proposalRevision: number) => void;
}) {
  if (loading && requests.length === 0) {
    return <p className="empty-state" role="status">{messages.approvalHistoryLoading}</p>;
  }
  if (error && requests.length === 0) {
    return <div className="empty-state" role="alert"><p>{error}</p><button type="button" className="ghost-button" onClick={retry}><RefreshCw size={15} aria-hidden="true" /> {messages.retryApprovalHistory}</button></div>;
  }
  return <>
    <ApprovalRequestList requests={mergeApprovalHistory([], requests)} locale={locale} messages={messages} timeZone={timeZone} busy={busy} review={review} />
    {error ? <div className="empty-state" role="alert"><p>{error}</p><button type="button" className="ghost-button" onClick={retry}><RefreshCw size={15} aria-hidden="true" /> {messages.retryApprovalHistory}</button></div> : null}
    {hasMore ? <button type="button" className="ghost-button" disabled={busy || loading} onClick={loadMore}>{loading ? messages.approvalHistoryLoadingMore : messages.loadMoreApprovalHistory}</button> : null}
  </>;
}

/** Only the already-authorized app projection enters maps; personal Calendar rows do not. */
export function ItineraryDayMap({ overview, day, locale }: {
  overview: Pick<Overview, "trip" | "session" | "days" | "itinerary" | "pendingItinerary">;
  day: Pick<Overview["days"][number], "id" | "date">;
  locale: Locale;
}) {
  const stops = useMemo(() => projectDayMapStops({
    itinerary: overview.itinerary,
    pendingItinerary: overview.pendingItinerary,
    days: overview.days,
    timeZone: overview.trip.timeZone,
    tripDayId: day.id,
    includePrivate: true,
  }), [overview.itinerary, overview.pendingItinerary, overview.days, overview.trip.timeZone, day.id]);
  // An edit, audience change or identity/date switch discards loaded imagery and
  // pending fetches. Unrelated weather/expense refreshes keep an open map stable.
  const scope = JSON.stringify([overview.trip.id, overview.session.memberId, overview.trip.timeZone, day.id, day.date, locale, stops]);
  return <DayEventMap key={scope} tripId={overview.trip.id} memberId={overview.session.memberId}
    tripDayId={day.id} date={day.date} timeZone={overview.trip.timeZone} locale={locale} stops={stops} />;
}

export function TripTimeline({ pending, calendarPoints = [], openCalendarImport, calendarImportBusy = false, ...timeline }: Parameters<typeof TimelineList>[0] & {
  pending: Omit<Parameters<typeof PendingItineraryList>[0], "locale" | "messages" | "timeZone" | "busy">;
  calendarPoints?: PersonalCalendarPoint[];
  openCalendarImport?: (eventId: string) => void;
  calendarImportBusy?: boolean;
}) {
  const entries = [
    ...timeline.points.map((point) => ({ kind: "event" as const, point })),
    ...pending.points.map((point) => ({ kind: "pending" as const, point })),
    ...calendarPoints.map((point) => ({ kind: "calendar" as const, point })),
  ].sort((a, b) => {
    const allDay = (entry: typeof a) => entry.kind === "calendar" ? entry.point.allDay : Boolean(entry.point.item.sourceCalendar?.allDay);
    if (allDay(a) !== allDay(b)) return Number(allDay(b)) - Number(allDay(a));
    const timestamp = (value: string | null) => { const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER; };
    return timestamp(a.point.at) - timestamp(b.point.at)
      || a.point.key.localeCompare(b.point.key);
  });
  return <div className="timeline-card trip-timeline">{entries.length ? entries.map((entry) => {
    if (entry.kind === "calendar") return <CalendarTimelineCard key={entry.point.key} point={entry.point} locale={timeline.locale}
      timeZone={timeline.overview.trip.timeZone} canImport={Boolean(timeline.overview.permissions.canEditItinerary && openCalendarImport)}
      busy={calendarImportBusy || timeline.busy} allowActionFallback={timeline.allowActionFallback} openImport={(id) => openCalendarImport?.(id)} />;
    if (entry.kind === "pending") {
      const point = { ...entry.point, ownsActions: ownsVisibleTimelineActions(entry.point, pending.points, timeline.allowActionFallback ?? false) };
      return <PendingItineraryList {...pending} key={`pending-${point.key}`} points={[point]} embedded allowActionFallback={false}
        locale={timeline.locale} messages={timeline.messages} timeZone={timeline.overview.trip.timeZone} busy={timeline.busy} />;
    }
    const point = { ...entry.point, ownsActions: ownsVisibleTimelineActions(entry.point, timeline.points, timeline.allowActionFallback ?? false) };
    return <TimelineList {...timeline} key={`event-${point.key}`} points={[point]} embedded allowActionFallback={false} />;
  }) : <p className="empty-state">{timeline.emptyMessage}</p>}</div>;
}

export function TimelineList({ overview, locale, messages, points, allowActionFallback = false, busy, calendarBusy, openEvent, cancelOrRestore, removeCancelledEvent, syncCalendar, showDisruption, emptyMessage, embedded = false }: {
  overview: Overview;
  locale: Locale;
  messages: Messages;
  points: TimelinePoint<ItineraryItem>[];
  allowActionFallback?: boolean;
  busy: boolean;
  calendarBusy: boolean;
  openEvent: (item: ItineraryItem) => void;
  cancelOrRestore: (item: ItineraryItem) => Promise<void>;
  removeCancelledEvent?: (item: ItineraryItem) => Promise<void>;
  embedded?: boolean;
  syncCalendar: (mode: "item", itemId: string) => void;
  showDisruption: (item: ItineraryItem) => void;
  emptyMessage: string;
}) {
  const rows = points.map((point) => {
    const item = point.item;
    const ownsActions = ownsVisibleTimelineActions(point, points, allowActionFallback);
    const pointLabel = point.kind === "departure" ? messages.departureLabel : point.kind === "arrival" ? messages.destinationLabel : null;
    const pointHref = point.kind === "event"
      ? itineraryMapUrl(item)
      : endpointMapUrl(point.locationName ?? item.title, point.mapUrl);
    const pointAriaLabel = point.kind === "event"
      ? formatMessage(messages.openEventInGoogleMaps, { title: item.title })
      : formatMessage(messages.openLocationInGoogleMaps, { location: point.locationName ?? item.title });
    return <article id={ownsActions ? `item-${item.id}` : `item-${item.id}-${point.key}`} data-timeline-point={point.kind} className={`timeline-row ${item.status === "cancelled" ? "state-complete" : ""}`} key={point.key}>
      <div className={`timeline-time ${point.weather ? "has-weather" : ""}`}>
        {point.weather ? <WeatherBadge weather={point.weather} locale={locale} messages={messages} timeZone={overview.trip.timeZone} /> : null}
        <time>{item.sourceCalendar?.allDay ? calendarImportMessages(locale).allDay : item.sourceCalendar && point.tripDayId !== item.tripDayId ? calendarImportMessages(locale).continues : point.at ? formatTime(point.at, locale, overview.trip.timeZone) : messages.timeNotSet}</time>
      </div>
      <div className="timeline-marker"><span>{item.isLocked || item.visibility === "private" ? <Lock size={12} /> : point.kind === "arrival" ? <MapPin size={12} aria-hidden="true" /> : point.kind === "departure" ? <Route size={12} aria-hidden="true" /> : eventTypeLabel(item.itemType, messages).slice(0, 1).toUpperCase()}</span></div>
      <div className="timeline-content">
        <div className="timeline-event-main">
          <a className={`timeline-event-link ${point.kind === "event" ? "" : "transport-timeline-point"}`} href={pointHref} target="_blank" rel="noreferrer" aria-label={pointAriaLabel}>
            {pointLabel ? <span className="transport-endpoint-label">{pointLabel}</span> : null}
            {item.status === "cancelled" ? <span className="cancelled-event-label"><X size={14} aria-hidden="true" /> {messages.eventStatusCancelled}</span> : null}
            <h3>{item.title}{item.visibility === "private" ? <span className="private-event-tag"><Lock size={11} /> {messages.privateEvent}</span> : null}</h3>
            <p>{point.locationName ? <><MapPin size={14} />{point.locationName}</> : eventTypeLabel(item.itemType, messages)}</p>
            <small>{item.sourceCalendar?.allDay ? calendarImportMessages(locale).allDay : formatDateTime(point.at, locale, overview.trip.timeZone)}{item.visibility === "private" ? ` · ${formatMessage(messages.sharedByCreator, { name: item.creatorName })}` : ""}</small>
          </a>
        </div>
        {ownsActions && item.disruption ? <div className="event-live-signals"><DisruptionBadge item={item} messages={messages} showDisruption={() => showDisruption(item)} /></div> : null}
      </div>
        {ownsActions ? <div className="row-actions card-actions">{overview.permissions.canEditItinerary ? <><button data-feedback-action="event_edit" className="mini-button" disabled={busy} onClick={() => openEvent(item)}><PencilLine size={14} /> {messages.editEvent}</button><button data-feedback-action="event_cancel" className="mini-button" disabled={busy} onClick={() => void cancelOrRestore(item)}>{item.status === "cancelled" ? messages.restoreEvent : messages.cancelEvent}</button></> : null}{overview.session?.isOwner && item.status === "cancelled" && removeCancelledEvent ? <button data-feedback-action="event_remove" className="mini-button danger-button" disabled={busy} onClick={() => void removeCancelledEvent(item)}><Trash2 size={14} /> {mobileCardsMessages(locale).remove}</button> : null}{overview.permissions.canSyncCalendar && item.status !== "cancelled" && item.startsAt ? <button data-feedback-action="calendar_sync" className="mini-button" disabled={calendarBusy} onClick={() => syncCalendar("item", item.id)}><CalendarRange size={14} /> {calendarBusy ? messages.calendarSyncing : item.calendarLink ? messages.updateCalendar : messages.addToCalendar}</button> : null}</div> : null}
    </article>;
  });
  return embedded ? <>{rows}</> : <div className="timeline-card">{rows.length ? rows : <p className="empty-state">{emptyMessage}</p>}</div>;
}

export function GoogleCalendarPanel({ overview, messages, state, busy, compact = false, dateFilter, refresh, syncAll, openItineraryItem }: {
  overview: Overview;
  locale: Locale;
  messages: Messages;
  state: CalendarState | null;
  busy: boolean;
  compact?: boolean;
  dateFilter?: string;
  refresh: () => void;
  syncAll: () => void;
  openItineraryItem: (itemId: string) => void;
}) {
  if (!overview.calendar.connected) {
    return <section className={`calendar-inline ${compact ? "calendar-summary" : ""}`}><p className="eyebrow">{messages.calendarOptional}</p><h2>{overview.permissions.canSyncCalendar ? messages.calendarConnectWhenNeeded : messages.calendarAccessUnavailable}</h2><p className="muted-copy">{overview.permissions.canSyncCalendar ? messages.calendarConnectDescription : messages.calendarAccessDisabledDescription}</p>{overview.permissions.canSyncCalendar ? <button data-feedback-action="calendar_sync" className="mini-button" disabled={busy} onClick={syncAll}><CalendarRange size={14} /> {messages.addAllToCalendar}</button> : null}</section>;
  }
  const selectedDayId = dateFilter ? overview.days.find((day) => day.date === dateFilter)?.id : null;
  const selectedItemIds = selectedDayId
    ? new Set(overview.itinerary.filter((item) => item.tripDayId === selectedDayId).map((item) => item.id))
    : null;
  const scopedEvents = state ? projectPersonalCalendarEvents(state.events, dateFilter ? [dateFilter] : overview.days.map((day) => day.date), overview.trip.timeZone) : [];
  const scopedConflicts = selectedItemIds
    ? state?.conflicts.filter((conflict) => selectedItemIds.has(conflict.itineraryItemId))
    : state?.conflicts;
  const conflicts = compact ? scopedConflicts?.slice(0, 2) : scopedConflicts;
  const eventCount = new Set(scopedEvents.map((point) => point.event.id)).size;
  const conflictCount = scopedConflicts?.length ?? 0;
  return (
    <section className={`calendar-inline ${compact ? "calendar-summary" : ""}`}>
      <div className="calendar-inline-heading">
        <div><p className="eyebrow">{messages.googleCalendar} · {dateFilter ? messages.calendarSelectedDay : messages.calendarTripDates}</p><h2>{state ? countLabel(eventCount, messages.calendarEventCountOne, messages.calendarEventCountMany) : messages.googleCalendar}</h2></div>
        <div className="dialog-actions">{overview.permissions.canSyncCalendar ? <button data-feedback-action="calendar_sync" className="mini-button" disabled={busy} onClick={syncAll}><CalendarRange size={14} /> {messages.addOrUpdateAllCalendar}</button> : null}<button data-feedback-action="calendar_refresh" className="mini-button" disabled={busy} onClick={refresh}><RefreshCw size={14} /> {messages.refreshCalendar}</button></div>
      </div>
      {busy ? <p className="calendar-clear" role="status" aria-live="polite"><RefreshCw size={14} /> {messages.calendarSyncing}</p> : conflictCount ? <div className="calendar-conflicts"><strong>{countLabel(conflictCount, messages.possibleCalendarConflictOne, messages.possibleCalendarConflictMany)}</strong>{conflicts?.map((conflict) => <button className="calendar-conflict" key={`${conflict.itineraryItemId}-${conflict.calendarEventId}`} onClick={() => openItineraryItem(conflict.itineraryItemId)}><span>{conflict.itineraryTitle}</span><small>{formatMessage(messages.calendarOverlaps, { title: conflict.calendarTitle })}</small></button>)}</div> : state ? <p className="calendar-clear">{messages.noCalendarConflicts}</p> : null}
    </section>
  );
}

/** A guest's reminder that the demo trip is temporary and how to keep trips (JOB-064). */
export function GuestBanner({ locale, expiresAt }: { locale: Locale; expiresAt: string; timeZone?: string }) {
  const copy = guestMessages(locale);
  const time = new Date(expiresAt).toLocaleString(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { dateStyle: "medium", timeStyle: "short" });
  return <div className="notice-banner guest-banner" role="note">
    <span>{formatMessage(copy.banner, { time })} {copy.aiHint} <Link href="/auth/sign-in">{copy.signIn}</Link></span>
  </div>;
}

/**
 * What the signed-in user's own API keys allow in this trip (JOB-061): the models they can choose,
 * whether every request runs on their own key (a trip the operator does not sponsor), and the
 * model the server picks when they leave the choice to it.
 */
export function ownKeyAccess(ai: Overview["ai"]) {
  const providers = ai.ownKeyProviders ?? [];
  const sponsored = ai.hostSubscriptionEnabled !== false;
  return {
    models: ownKeyModels(providers),
    ownKeyOnly: !sponsored && providers.length > 0,
    automatic: ownKeyModel(undefined, ai.ownerDefaultModel as OwnerModel, new Set(providers), sponsored),
  };
}

/**
 * How AI is paid for this viewer when it is not the operator's usual sponsorship: their own key, a
 * trip owner's shared key (JOB-063), the operator's own use of the server's keys (JOB-072), or
 * neither. Null means the sponsored-trip copy applies.
 */
export function aiFundingNote(ai: Overview["ai"], messages: Messages, keysCopy: AiKeysCopy): string | null {
  if (ai.keyRequired) return keysCopy.keyRequired;
  if (ai.enabled && ai.freeAi) {
    return formatMessage(keysCopy.freeAccess, { model: ai.freeAi.model, remaining: ai.freeAi.remainingToday, limit: ai.freeAi.limit });
  }
  if (ai.enabled && ownKeyAccess(ai).ownKeyOnly) return keysCopy.ownKeyAccess;
  if (ai.enabled && ai.sharedKey) {
    return formatMessage(keysCopy.sharedAccess, { owner: ai.sharedKey.sponsorName, model: ai.sharedKey.model, limit: ai.memberDailyLimit });
  }
  if (ai.enabled && ai.operatorOwnAi) return keysCopy.operatorAccess;
  return ai.hostSubscriptionEnabled === false ? messages.aiUnavailable : null;
}

export function AiCard({ overview, messages, prompt, setPrompt, reply, sources, memory, busy, thinking, statusText, selectedModel, setModel, ownKeyChoice = "", setOwnKeyChoice, submit, newConversation, openHistory, historyLabel, imagePicker, readOnly = false, locale, heading = true, autoFocus = false }: {
  overview: Overview;
  messages: Messages;
  prompt: string;
  setPrompt: (value: string) => void;
  reply: string | null;
  sources: string[];
  memory: AiMemoryUsage | null;
  busy: boolean;
  thinking: boolean;
  statusText?: string | null;
  selectedModel: string;
  setModel: (model: string) => Promise<void>;
  ownKeyChoice?: string;
  setOwnKeyChoice?: (model: string) => void;
  submit: (event: FormEvent) => Promise<void>;
  newConversation?: () => void;
  openHistory?: () => void;
  historyLabel?: string;
  imagePicker?: Omit<AiImagePickerProps, "disabled">;
  readOnly?: boolean;
  locale?: Locale;
  /** False inside a dialog that already shows the title. */
  heading?: boolean;
  autoFocus?: boolean;
}) {
  const keysCopy = aiKeysMessages(locale ?? imagePicker?.locale ?? "en");
  const access = ownKeyAccess(overview.ai);
  const ownChoice = (access.models as string[]).includes(ownKeyChoice) ? ownKeyChoice : "";
  const idleMessage = aiFundingNote(overview.ai, messages, keysCopy)
    ?? (!overview.ai.enabled ? messages.aiUnavailable : overview.ai.canSelectModel ? messages.aiOwnerPolicy : messages.aiMemberPolicy);
  // With no choice the server uses the user's own key in an unsponsored trip, else a shared key, else sponsorship.
  const defaultOption = access.ownKeyOnly ? formatMessage(keysCopy.autoOption, { model: access.automatic ?? "" })
    : overview.ai.sharedKey ? formatMessage(keysCopy.sharedOption, { model: overview.ai.sharedKey.model, owner: overview.ai.sharedKey.sponsorName })
    : formatMessage(keysCopy.sponsoredOption, { model: overview.ai.effectiveModel });
  // Choosing one of the user's own-key models is per request; it never changes the trip's settings.
  const ownKeySelect = !overview.ai.canSelectModel && overview.ai.enabled && access.models.length > 0
    ? <select className="model-select" aria-label={keysCopy.modelLabel} value={ownChoice} disabled={busy} onChange={(event) => setOwnKeyChoice?.(event.target.value)}>
      <option value="">{defaultOption}</option>
      {access.models.map((model) => <option key={model} value={model}>{formatMessage(keysCopy.ownModelOption, { model })}</option>)}
    </select>
    : null;
  const quotaNote = !overview.ai.canSelectModel && overview.ai.enabled && !access.ownKeyOnly && !ownChoice
    ? <p className="policy-note">{formatMessage(messages.aiMemberQuota, { remaining: overview.ai.remainingToday ?? 0, limit: overview.ai.memberDailyLimit })}</p>
    : null;
  if (readOnly) return <section className="ai-card"><h2>{aiInstructionsMessages(locale ?? "en").archived}</h2>
    <p className="ai-memory-notice">{aiInstructionsMessages(locale ?? "en").archivedNotice}</p>
    {newConversation ? <button data-feedback-action="ai_new" type="button" className="ghost-button" disabled={busy} onClick={newConversation}>{messages.newAiConversation}</button> : null}
    {openHistory ? <button data-feedback-action="navigate" type="button" className="ghost-button" onClick={openHistory}>{historyLabel}</button> : null}
  </section>;
  return (
    <section className="ai-card">
      <div className="ai-card-heading">
        {heading ? <div className="ai-card-title"><div className="card-icon violet"><Bot size={21} /></div><div><p className="eyebrow">{messages.aiPlannerLabel}</p><h2>{messages.askAi}</h2></div></div> : null}
        {newConversation ? <button data-feedback-action="ai_new" type="button" className="ai-conversation-button" disabled={busy} onClick={newConversation}><Plus size={14} /> {messages.newAiConversation}</button> : null}
      </div>
      {overview.ai.canSelectModel ? <select data-feedback-action="settings_save" className="model-select" value={selectedModel} disabled={busy} onChange={(event) => void setModel(event.target.value)}>{selectableOwnerModels.map((model) => <option key={model}>{model}</option>)}</select> : null}
      {ownKeySelect}
      {quotaNote}
      <p className="ai-memory-notice">{messages.aiMemoryNotice}</p>
      {openHistory ? <button data-feedback-action="navigate" type="button" className="ghost-button" onClick={openHistory}>{historyLabel}<ChevronRight size={16} /></button> : null}
      <form data-feedback-action="ai_submit" onSubmit={submit}><label className="ai-input"><span className="sr-only">{messages.askAi}</span><textarea required autoFocus={autoFocus} maxLength={AI_PROMPT_MAX_CHARACTERS} disabled={busy || !overview.ai.enabled} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={messages.aiPlaceholder} rows={4} /><button disabled={busy || !overview.ai.enabled || !prompt.trim() || imagePicker?.preparing} aria-label={messages.sendAiPrompt}><Sparkles size={17} /></button></label>
        {imagePicker ? <AiImagePicker {...imagePicker} disabled={busy || !overview.ai.enabled} /> : null}
      </form>
      {thinking ? <p className="ai-thinking" role="status" aria-live="polite"><Sparkles size={16} /> {statusText ?? messages.aiThinking}</p> : reply ? <div className="ai-reply"><AiReadableText text={reply} />{sources.length ? <div className="ai-source-list"><strong>{messages.aiResearchSources}</strong>{sources.map((source, index) => <a href={source} target="_blank" rel="noreferrer" key={source}>{index + 1}. {sourceHost(source)}</a>)}</div> : null}{memory ? <p className="ai-memory-usage" role="status">{formatMessage(messages.aiMemoryUsage, { count: memory.previousTurnsUsed, tokens: memory.tokenEstimate, budget: memory.tokenBudget })}{memory.truncated ? <span>{messages.aiMemoryTruncated}</span> : null}</p> : null}</div> : <p className="disabled-note">{idleMessage}</p>}
    </section>
  );
}

function sourceHost(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

function operationStatusLabel(
  status: "succeeded" | "partial" | "failed" | "running" | "skipped" | null,
  messages: Messages,
): string {
  if (status === "succeeded") return messages.monitorStatusSucceeded;
  if (status === "partial") return messages.monitorStatusPartial;
  if (status === "failed") return messages.monitorStatusFailed;
  if (status === "running") return messages.monitorStatusRunning;
  if (status === "skipped") return messages.monitorStatusSkipped;
  return messages.monitorNeverSucceeded;
}

function LiveOperationsCard({ status, locale, timeZone, messages }: {
  status: NonNullable<Overview["liveOperations"]>;
  locale: Locale;
  timeZone: string;
  messages: Messages;
}) {
  const weather = status.weather;
  const disruption = status.disruption;
  return <article className="settings-card live-operations-card">
    <h2>{messages.liveOperationsTitle}</h2>
    <p>{messages.liveOperationsDescription}</p>
    <div className="live-operations-grid">
      <div>
        <strong>{messages.weatherMonitorLabel}</strong>
        <span className={`operations-state ${weather?.status === "failed" ? "is-error" : ""}`}>
          {operationStatusLabel(weather?.status ?? null, messages)}
        </span>
        <small>{weather?.lastSuccessAt
          ? formatMessage(messages.monitorLastSuccess, { date: formatDateTime(weather.lastSuccessAt, locale, timeZone) })
          : messages.monitorNeverSucceeded}</small>
        {weather ? <small>{formatMessage(messages.monitorLastAttempt, {
          date: formatDateTime(weather.completedAt, locale, timeZone),
        })}</small> : null}
        <small>{weather?.errorCode
          ? formatMessage(messages.monitorLastError, { error: weather.errorCode })
          : messages.monitorNoError}</small>
      </div>
      <div>
        <strong>{messages.disruptionMonitorLabel}</strong>
        <span className={`operations-state ${disruption?.lastErrorCode ? "is-error" : ""}`}>
          {disruption && !disruption.enabled
            ? messages.monitorStatusDisabled
            : operationStatusLabel(disruption?.latestRunStatus ?? null, messages)}
        </span>
        <small>{disruption?.lastSuccessAt
          ? formatMessage(messages.monitorLastSuccess, { date: formatDateTime(disruption.lastSuccessAt, locale, timeZone) })
          : messages.monitorNeverSucceeded}</small>
        {disruption?.lastAttemptAt ? <small>{formatMessage(messages.monitorLastAttempt, {
          date: formatDateTime(disruption.lastAttemptAt, locale, timeZone),
        })}</small> : null}
        {disruption ? <small>{formatMessage(messages.monitorNextDue, {
          date: formatDateTime(disruption.nextDueAt, locale, timeZone),
        })}</small> : null}
        <small>{disruption?.lastErrorCode
          ? formatMessage(messages.monitorLastError, { error: disruption.lastErrorCode })
          : messages.monitorNoError}</small>
      </div>
    </div>
  </article>;
}

export function TripSettingsCard({ settings, setSettings, busy, memberCount, messages, submit }: {
  settings: TripSettingsDraft;
  setSettings: (settings: TripSettingsDraft) => void;
  busy: boolean;
  memberCount: number;
  messages: Messages;
  submit: (event: FormEvent) => Promise<void>;
}) {
  const maximumEndsOn = tripEndDateIsWithinBounds(settings.startsOn, "0001-01-01", "9998-12-31")
    ? maximumTripEndDate(settings.startsOn) : undefined;
  return <article className="settings-card trip-date-settings">
    <p className="eyebrow">{messages.ownerTripContextLabel}</p>
    <h2>{messages.ownerTripContextTitle}</h2><p>{messages.ownerTripContextDescription}</p>
    <form data-feedback-action="settings_save" className="settings-form" onSubmit={submit}>
      <fieldset disabled={busy} className="trip-date-settings-fields">
        <div className="trip-date-settings-range">
          <label>{messages.startDateField}<input aria-label={messages.startDateField} name="startsOn" required type="date" max={settings.endsOn || undefined} value={settings.startsOn} onChange={(event) => setSettings({ ...settings, startsOn: event.target.value })} /></label>
          <label>{messages.endDateField}<input aria-label={messages.endDateField} name="endsOn" required type="date" min={settings.startsOn || undefined} max={maximumEndsOn} value={settings.endsOn} onChange={(event) => setSettings({ ...settings, endsOn: event.target.value })} /></label>
        </div>
        <small>{messages.tripDatesHint}</small>
        <label>{messages.travelDestinationField}<input required maxLength={160} value={settings.destinationName} onChange={(event) => setSettings({ ...settings, destinationName: event.target.value })} /></label>
        <label>{messages.timeZoneField}<input required list="stardust-time-zones" maxLength={80} value={settings.timeZone} onChange={(event) => setSettings({ ...settings, timeZone: event.target.value })} /><datalist id="stardust-time-zones"><option value="Asia/Tokyo">Japan · Asia/Tokyo</option><option value="America/Chicago">US Central · America/Chicago</option><option value="Europe/London">UK · Europe/London</option><option value="Asia/Hong_Kong">Hong Kong · Asia/Hong_Kong</option></datalist></label>
        <label>{messages.maximumMembersField}<input required type="number" min={memberCount} max="20" step="1" value={settings.maxMembers} onChange={(event) => setSettings({ ...settings, maxMembers: event.target.value })} /><small>{formatMessage(messages.tripCapacityHint, { count: memberCount })}</small></label>
        <button className="primary-button fit-button" disabled={busy}>{busy ? messages.tripSettingsSaving : messages.saveTripSettings}</button>
      </fieldset>
    </form>
  </article>;
}

function PermissionToggle({ label, checked, disabled, change }: { label: string; checked: boolean; disabled: boolean; change: (checked: boolean) => void }) {
  return <label className="permission-toggle"><span>{label}</span><input data-feedback-action="member_change" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => change(event.target.checked)} /></label>;
}
