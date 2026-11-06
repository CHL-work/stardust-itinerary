import type { EventWeatherTargetRole } from "@/lib/weather/domain";
import type { LocalizedDisruptionDetails } from "@/lib/disruptions/localization";

export type { EventWeatherTargetRole } from "@/lib/weather/domain";

export const DEFAULT_OWNER_MODEL = "gpt-6.1-sol" as const;
export const MEMBER_MODEL = "gpt-6.1-sol" as const;

/** Models a person can choose: owners in a sponsored trip, and anyone on their own key. */
export const selectableOwnerModels = [
  DEFAULT_OWNER_MODEL,
  "gpt-6-astra",
  "gpt-6.1-terra",
  "gpt-6-luna",
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-fable-5-1",
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
] as const;

/**
 * Free guest AI (JOB-071): a slot, never chosen by anyone, that the funding policy gives guests
 * without a key. It runs on keyless free models through Kilo's AI Gateway (`src/lib/ai/free-model.ts`).
 */
export const GUEST_FREE_MODEL = "guest-free" as const;

/** Every model the planner can run, including the guest slot. Never offer this list for selection. */
export const ownerModels = [...selectableOwnerModels, GUEST_FREE_MODEL] as const;

export type OwnerModel = (typeof ownerModels)[number];
export type SelectableOwnerModel = (typeof selectableOwnerModels)[number];

type OpenAiOwnerModelProfile = Readonly<{
  provider: "openai";
  transport: "codex_sdk";
  authenticationMode: "api_key";
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
}>;

type AnthropicOwnerModelProfile = Readonly<{
  provider: "anthropic";
  transport: "claude_agent_sdk";
  authenticationMode: "api_key";
  effort: "low";
}>;

type GoogleOwnerModelProfile = Readonly<{
  provider: "google";
  transport: "gemini_api";
  authenticationMode: "api_key";
}>;

type FreeGuestModelProfile = Readonly<{
  provider: "kilo";
  transport: "kilo_gateway";
  authenticationMode: "anonymous";
}>;

export type OwnerModelProfile = OpenAiOwnerModelProfile | AnthropicOwnerModelProfile | GoogleOwnerModelProfile | FreeGuestModelProfile;
/** Providers that users and the operator hold keys for. */
export type KeyedModelProvider = Exclude<OwnerModelProfile["provider"], "kilo">;

export const ownerModelRegistry = {
  "gpt-6.1-sol": {
    provider: "openai",
    transport: "codex_sdk",
    authenticationMode: "api_key",
    reasoningEffort: "low",
  },
  "gpt-6-astra": {
    provider: "openai",
    transport: "codex_sdk",
    authenticationMode: "api_key",
    reasoningEffort: "medium",
  },
  "gpt-6.1-terra": {
    provider: "openai",
    transport: "codex_sdk",
    authenticationMode: "api_key",
    reasoningEffort: "medium",
  },
  "gpt-6-luna": {
    provider: "openai",
    transport: "codex_sdk",
    authenticationMode: "api_key",
    reasoningEffort: "medium",
  },
  "claude-haiku-5-5": {
    provider: "anthropic",
    transport: "claude_agent_sdk",
    authenticationMode: "api_key",
    effort: "low",
  },
  "claude-sonnet-5-5": {
    provider: "anthropic",
    transport: "claude_agent_sdk",
    authenticationMode: "api_key",
    effort: "low",
  },
  "claude-opus-5-5": {
    provider: "anthropic",
    transport: "claude_agent_sdk",
    authenticationMode: "api_key",
    effort: "low",
  },
  "claude-fable-5-1": {
    provider: "anthropic",
    transport: "claude_agent_sdk",
    authenticationMode: "api_key",
    effort: "low",
  },
  "gemini-4-argon": {
    provider: "google",
    transport: "gemini_api",
    authenticationMode: "api_key",
  },
  "gemini-3.8-flash": {
    provider: "google",
    transport: "gemini_api",
    authenticationMode: "api_key",
  },
  "gemini-3.5-flash-lite": {
    provider: "google",
    transport: "gemini_api",
    authenticationMode: "api_key",
  },
  [GUEST_FREE_MODEL]: {
    provider: "kilo",
    transport: "kilo_gateway",
    authenticationMode: "anonymous",
  },
} as const satisfies Record<OwnerModel, OwnerModelProfile>;

/** The model used with a user's own key when they have not chosen one: a capable, moderately priced tier. */
export const providerDefaultModels = {
  openai: "gpt-6.1-sol",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-3.8-flash",
} as const satisfies Record<KeyedModelProvider, OwnerModel>;

/** The legacy marker is retained only to fence read-only archived chats. */
export type AiConversationPurpose = "trip" | "preferences";

export type ExpenseSplitAmount = import("@/lib/domain/expenses").ExpenseSplitAmount;

export type LinkedExpenseInput = {
  description: string;
  amountMinor: number;
  currency: string;
  payerMemberId: string;
  occurredAt: string;
  status?: "draft" | "posted";
  splitMemberIds: string[];
  splitAmounts?: ExpenseSplitAmount[];
};

export type ItineraryPatch = {
  tripDayId?: string;
  title?: string;
  itemType?: "activity" | "meal" | "transport" | "lodging" | "note";
  startsAt?: string | null;
  endsAt?: string | null;
  locationName?: string | null;
  mapUrl?: string | null;
  departureLocationName?: string | null;
  departureMapUrl?: string | null;
  destinationLocationName?: string | null;
  destinationMapUrl?: string | null;
  notes?: string | null;
  visibility?: "trip" | "private";
  viewerMemberIds?: string[];
  status?: "draft" | "planned" | "cancelled" | "completed";
  isLocked?: boolean;
  linkedExpense?: LinkedExpenseInput;
};

export type PendingItineraryEditPatch = Omit<ItineraryPatch, "linkedExpense"> & {
  /** null explicitly removes an expense already attached to the pending proposal. */
  linkedExpense?: LinkedExpenseInput | null;
};

export type PendingItineraryEditInput = {
  proposalRevision: number;
  patch: PendingItineraryEditPatch;
  reason?: string;
};

export type PendingItineraryDraft = {
  tripDayId: string;
  title: string;
  itemType: NonNullable<ItineraryPatch["itemType"]>;
  startsAt: string | null;
  endsAt: string | null;
  locationName: string | null;
  mapUrl: string | null;
  departureLocationName: string | null;
  departureMapUrl: string | null;
  destinationLocationName: string | null;
  destinationMapUrl: string | null;
  notes: string | null;
  visibility: NonNullable<ItineraryPatch["visibility"]>;
  viewerMemberIds: string[];
  status: NonNullable<ItineraryPatch["status"]>;
  isLocked: boolean;
  linkedExpense: LinkedExpenseInput | null;
};

export type PendingItineraryProjection = {
  sourceCalendar?: import("@/lib/calendar/import-contracts").CalendarSourceMetadata;
  requestId: string;
  status: "pending";
  operation: "create" | "update" | "cancel" | "restore";
  targetItemId: string | null;
  createdByMemberId: string;
  requestedByMemberId: string;
  requestedByName: string;
  createdAt: string;
  updatedAt: string;
  proposalRevision: number;
  tripDayId: string;
  title: string;
  itemType: "activity" | "meal" | "transport" | "lodging" | "note";
  startsAt: string | null;
  endsAt: string | null;
  locationName: string | null;
  mapUrl: string | null;
  departureLocationName: string | null;
  departureMapUrl: string | null;
  destinationLocationName: string | null;
  destinationMapUrl: string | null;
  notes: string | null;
  visibility: "trip" | "private";
  viewerMemberIds: string[];
};

export type PendingItineraryEditDetail = {
  requestId: string;
  status: "pending";
  operation: "create" | "update";
  targetItemId: string | null;
  createdByMemberId: string;
  requestedByMemberId: string;
  requestedByName: string;
  source: "member" | "owner" | "ai" | "import";
  reason: string;
  proposalRevision: number;
  createdAt: string;
  updatedAt: string;
  patch: PendingItineraryDraft;
};

export type PendingExpenseProjection = {
  requestId: string;
  proposalRevision: number;
  status: "pending";
  requestedByMemberId: string;
  requestedByName: string;
  createdAt: string;
  description: string;
  amountMinor: number;
  currency: string;
  payerMemberId: string;
  payerName: string;
  itineraryItemId: string | null;
  itineraryItemTitle: string | null;
  occurredAt: string;
  splits: Array<{ memberId: string; memberName: string; shareMinor: number }>;
};

export type EventWeatherForecast = {
  targetRole: EventWeatherTargetRole;
  forecastAt: string;
  sampledAt: string;
  fetchedAt: string;
  staleAfter: string;
  stale: boolean;
  locationLabel: string;
  locationPrecision: "event" | "trip_destination";
  provider: "open-meteo";
  weatherCode: number;
  condition: string;
  icon: string;
  temperatureCelsius: number | null;
  apparentTemperatureCelsius: number | null;
  precipitationProbabilityPercent: number | null;
};

export const disruptionReasonCodes = [
  "cancellation",
  "closure",
  "delay",
  "transit_disruption",
  "road_disruption",
  "weather",
  "hours_change",
  "strike",
  "access_change",
  "other",
] as const;

export type DisruptionReasonCode = (typeof disruptionReasonCodes)[number];

export type EventDisruption = {
  observationId: string;
  evidenceFingerprint: string;
  state: "possible" | "confirmed";
  reasonCode: DisruptionReasonCode;
  severity: "info" | "warning" | "critical";
  detail: string;
  localizedDetails?: LocalizedDisruptionDetails | null;
  sourceUrls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  checkedAt: string;
  staleAfter: string;
};

export type ApprovalRequest = {
  id: string;
  requestedByName: string;
  source: string;
  entityType: string;
  entityId: string | null;
  operation: string;
  baseRevision: number | null;
  patch: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  proposalRevision?: number;
  updatedAt?: string;
  reviewBlockedReason?: "member_removed";
  display?: import("@/lib/app/approval-presentation-types").ApprovalDisplay;
};

export type ApprovalHistoryPage = {
  requests: ApprovalRequest[];
  nextCursor: string | null;
};

export type ExpensePatch = {
  description?: string;
  amountMinor?: number;
  currency?: string;
  payerMemberId?: string;
  itineraryItemId?: string | null;
  occurredAt?: string;
  status?: "draft" | "posted" | "void";
  splitMemberIds?: string[];
  splitAmounts?: ExpenseSplitAmount[];
};

export type ChangeOperation = "create" | "update" | "cancel" | "restore" | "void";

export type ChangeRequestInput = {
  entityType: "itinerary_item" | "expense";
  entityId?: string | null;
  operation: ChangeOperation;
  baseRevision?: number | null;
  patch: ItineraryPatch | ExpensePatch;
  reason: string;
  source?: "member" | "owner" | "ai" | "import";
};

export type TripSettingsInput = {
  destinationName?: string;
  timeZone?: string;
  maxMembers?: number;
  startsOn?: string;
  endsOn?: string;
  expectedStartsOn?: string;
  expectedEndsOn?: string;
};

export type CreateTripInput = {
  name: string;
  destinationName: string;
  timeZone: string;
  destinationLookupId?: string;
  defaultLocale: "en" | "zh-HK" | "zh-HK-lihkg" | "ja-JP";
  defaultCurrency: string;
  startsOn: string;
  endsOn: string;
  maxMembers: number;
};
