import type { Pool } from "pg";

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
export type DisruptionState = "possible" | "confirmed" | "resolved";
export type DisruptionSeverity = "info" | "warning" | "critical";

// Source-grounded facts used by the application gate, not a calibrated probability.
export type DisruptionImpactAssessment = {
  confidence: "high" | "medium" | "low";
  sourceAuthority: "official" | "corroborated" | "unknown";
  match: "exact_venue" | "explicit_transport" | "nearby" | "unknown";
  effect: "cancelled" | "unavailable" | "access_blocked" | "delay" | "schedule_change" | "minor" | "unknown";
  minimumDelayMinutes: number | null;
  affectedEntity: string | null;
  evidenceSummary: string;
  ongoing: boolean;
};

export type CurrentDisruptionWarning = {
  state: "possible" | "confirmed";
  reasonCode: DisruptionReasonCode;
  severity: DisruptionSeverity;
  detail: string;
  sourceUrls: string[];
  evidenceFingerprint: string;
};

export type DisruptionCandidate = {
  tripId: string;
  itemId: string;
  revision: number;
  title: string;
  itemType: string;
  startsAt: Date | null;
  endsAt: Date | null;
  locationName: string | null;
  departureLocationName: string | null;
  destinationLocationName: string | null;
  checkScope: "current_day" | "future_day";
  currentWarning: CurrentDisruptionWarning | null;
};

export type PublicDisruptionCandidate = {
  key: string;
  title: string;
  itemType: string;
  startsAt: string | null;
  endsAt: string | null;
  locations: string[];
  currentWarning: Omit<CurrentDisruptionWarning, "evidenceFingerprint"> | null;
};

export type DisruptionAlert = {
  eventKey: string;
  state: DisruptionState;
  reasonCode: DisruptionReasonCode;
  severity: DisruptionSeverity;
  detail: string;
  localizedDetails?: { en: string; "zh-HK": string; "ja-JP": string };
  sourceUrls: string[];
  affectedFrom: string | null;
  affectedUntil: string | null;
  validForMinutes: number;
  // Legacy output can be read/audited, but cannot qualify without an assessment.
  impactAssessment?: DisruptionImpactAssessment;
};

export type DisruptionProviderResult = {
  rawOutput: string;
  effectiveModel: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  webSearchCount: number;
  webSearchQueries: string[];
};

export type DisruptionProviderInput = {
  prompt: string;
  outputSchema: unknown;
  signal: AbortSignal;
};

export type DisruptionProvider = {
  check(input: DisruptionProviderInput): Promise<DisruptionProviderResult>;
};

export type RunDisruptionMonitorOptions = {
  provider?: DisruptionProvider;
  /** "member": unsponsored trips on a member's own key, run by the web server (JOB-094). Default "operator". */
  funding?: "operator" | "member";
  /** Tests replace a member's provider; production builds one from the member's model and effort. */
  memberProvider?: (payer: import("@/lib/routine-checks/funding").RoutinePayer) => DisruptionProvider;
  now?: Date;
  maxTrips?: number;
  maxCandidatesPerBatch?: number;
  maxCandidatesPerRun?: number;
  maxRunDurationMs?: number;
};

export type DisruptionMonitorSummary = {
  claimedTrips: number;
  succeededTrips: number;
  failedTrips: number;
  skippedTrips: number;
  observationsWritten: number;
};

export type DisruptionPool = Pick<Pool, "connect">;
