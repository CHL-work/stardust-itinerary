import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { Pool, PoolClient } from "pg";
import { ZodError } from "zod";
import { query as claudeQuery, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { codexSearchQueries } from "@/lib/ai/codex-web-search";
import { lockedDownCodexConfig, usedForbiddenCodexItem } from "@/lib/ai/codex-lockdown";
import { generateWithGemini } from "@/lib/ai/gemini";
import { providerEnvironment } from "@/lib/ai/provider-environment";
import { AiProviderFailureError, aiProviderFailureDetails, createClaudeProviderFailureTracker } from "@/lib/ai/provider-failure";
import { aiRequestWorkBudgetMs } from "@/lib/ai/request-budget";
import { consumeClaudeQuery } from "@/lib/ai/claude-query-lifecycle";
import { researchCompletionNotice, type ResearchCompletionFailure } from "@/lib/ai/research-completion";
import { expenseSplitsForPatch } from "@/lib/app/expense-split-patch";

import {
  AiPolicyDeniedError,
  AppConflictError,
  createAiCreateRequestsWithClient,
  createChangeRequestWithClient,
  getAiPendingItineraryContext,
  updatePendingItineraryRequestWithClient,
  reviewChangeRequestWithClient,
  getAiPolicy,
  inTransaction,
} from "@/lib/app/repository";
import {
  ownerModelRegistry,
  type ChangeRequestInput,
  type ExpensePatch,
  type ItineraryPatch,
  type OwnerModel,
} from "@/lib/app/types";
import { aiExpensePatchSchema, aiItineraryPatchSchema, aiPendingItineraryPatchSchema } from "@/lib/ai/proposal-contract";
import { normalizeAiIsoDateTime } from "@/lib/ai/timestamp";
import {
  timestampRepairFeedback,
  timestampRepairInstructions,
  timestampRepairPreservesProposalIntent,
  type TimestampRepairFeedback,
} from "@/lib/ai/proposal-repair";
import {
  containsReservationSecret,
  containsKnownReservationSecret,
  inspectReservationSecrets,
  redactReservationSecrets,
  type ReservationSecretContext,
} from "@/lib/ai/reservation-secrets";
import {
  assessReservationExpense,
  reservationExpenseClarification,
  reservationExpenseReviewNotice,
  type ReservationExpenseAssumptionReason,
} from "@/lib/ai/reservation-assumptions";
import { isTrustedGoogleMapsUrl } from "@/lib/app/transport";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import {
  AiConversationBusyError,
  lockBoundUserAi,
  assertBoundUserAiIdle,
  selectAiConversationForSubmission,
  createConversationCheckpoint,
  prepareAiConversation,
  readAiConversationPurpose,
  RECENT_CONVERSATION_TOKEN_BUDGET,
  type AiConversationCheckpoint,
  type AiConversationTurn,
} from "@/lib/ai/conversation";
import { readAiInstructions } from "@/lib/ai/custom-instructions";
import { classifyOffTopicPrompt, offTopicReply } from "@/lib/ai/off-topic";
import { getLiveSearchIntent, isSearchOnlyFollowup } from "@/lib/ai/search-policy";
import {
  loadPlanningDraft, assertPlanningDraftCurrent, recordPlanningDraft,
  isDraftCreateRequest, isDraftClarificationReply, isDraftCancellation, isDraftContinuationCandidate,
  type PlanningDraft,
} from "@/lib/ai/planning-draft";
import {
  anchorPlanningDraft, planningDraftEvidence, hasPayerClarification, detachedPlanningClarification,
  previousDraftRelativeDate,
} from "@/lib/ai/planning-draft-context";
export { requiresLivePlaceSearch } from "@/lib/ai/search-policy";
import {
  plannerPrompt,
  type LiveWebSearchPrivacyBlockReason,
  type PlannerResearchContext,
} from "@/lib/ai/prompt";
import { instantDateInTimeZone, requestedRelativeDate } from "@/lib/ai/relative-date";
import type { Locale } from "@/lib/i18n";
import {
  aiRequestPayloadHash, findAiRequestReplay, assertAiRequestWritable,
} from "@/lib/ai/request-recovery";
import type { AiPlannerResult, AiRequestRecoveryResponse } from "@/lib/ai/request-recovery-types";
import { extractAiImageFacts } from "@/lib/ai/image-extraction";
import { saveAiRequestImages, saveAiImageFacts } from "@/lib/ai/image-store";
import { withAiImageFacts } from "@/lib/ai/image-context";
import { AI_IMAGE_EXTRACTION_BUDGET_MS } from "@/lib/ai/image-types";
import { runVenueHoursResearch } from "@/lib/ai/venue-hours-provider";
import {
  assessVenueHours, safeVenueHoursTarget, venueHoursCandidates, venueHoursNotice,
  VENUE_HOURS_BUDGET_MS, VENUE_HOURS_MIN_BUDGET_MS, VENUE_HOURS_MAX_TARGETS,
  type VenueHoursUnverifiedReason,
} from "@/lib/ai/venue-hours";
import type { ReusableVenueHours } from "@/lib/ai/venue-hours-evidence";
import type { PreparedAiImage } from "@/lib/ai/image-server-types";
import { runPublicResearch } from "@/lib/ai/public-research-provider";
import {
  parsePublicResearchRequests, publicResearchRequestJsonSchema, selectPublicResearchTargets,
  selectPublicResearchHoursTargets,
  PUBLIC_RESEARCH_BUDGET_MS, PUBLIC_RESEARCH_MIN_BUDGET_MS, PUBLIC_RESEARCH_FINALIZATION_RESERVE_MS,
  type PublicResearchRequest,
} from "@/lib/ai/public-research";
export type { AiPlannerResult } from "@/lib/ai/request-recovery-types";

const MAX_PROPOSALS_PER_REQUEST = 20;
const MAX_PROPOSAL_REASON_CHARACTERS = 1_000;
const MAX_PATCH_JSON_CHARACTERS = 20_000;
const MAX_PROVIDER_MESSAGE_CHARACTERS = 16_000;
const MAX_DATABASE_REVISION = 2_147_483_647;
const WORKSPACE_CLEANUP_MAX_RETRIES = 5;
const WORKSPACE_CLEANUP_RETRY_DELAY_MS = 100;
const MIN_REPAIR_BUDGET_MS = 15_000;

class AiPlannerTimeoutError extends Error {
  constructor() {
    super("The AI planning time budget was exhausted.");
    this.name = "AI_REQUEST_TIMEOUT";
  }
}

class ReservationClarificationNeeded extends Error {
  constructor(readonly reason: ReservationExpenseAssumptionReason) {
    super("Reservation expense needs clarification.");
  }
}

const EMAIL_PATTERN = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu;
const LONG_NUMBER_PATTERN = /\d{8,}/gu;

const proposalOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    entityType: { type: "string", enum: ["itinerary_item", "expense"] },
    action: { type: "string", enum: ["create", "update", "update_pending", "cancel", "restore"] },
    entityId: { type: ["string", "null"] },
    baseRevision: { type: ["integer", "null"] },
    patchJson: { type: "string", maxLength: MAX_PATCH_JSON_CHARACTERS },
    reason: { type: "string", minLength: 1, maxLength: MAX_PROPOSAL_REASON_CHARACTERS },
  },
  required: ["entityType", "action", "entityId", "baseRevision", "patchJson", "reason"],
} as const;

const memoryCheckpointOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summaryText: { type: "string", maxLength: 8_000 },
    goals: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 12 },
    decisions: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 12 },
    openQuestions: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 12 },
  },
  required: ["summaryText", "goals", "decisions", "openQuestions"],
} as const;

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string", maxLength: MAX_PROVIDER_MESSAGE_CHARACTERS },
    continuesDraft: { type: "boolean" },
    researchRequests: publicResearchRequestJsonSchema,
    proposals: {
      type: "array",
      items: proposalOutputSchema,
      maxItems: MAX_PROPOSALS_PER_REQUEST,
    },
    sources: {
      type: "array",
      items: { type: "string", maxLength: 2_000 },
      maxItems: 10,
    },
    memoryCheckpoint: memoryCheckpointOutputSchema,
  },
  required: ["message", "continuesDraft", "researchRequests", "proposals", "sources", "memoryCheckpoint"],
} as const;

type PlannerProposal = {
  entityType: "itinerary_item" | "expense";
  action: "create" | "update" | "update_pending" | "cancel" | "restore";
  entityId: string | null;
  baseRevision: number | null;
  patchJson: string;
  reason: string;
};

type PlannerOutput = {
  message: string;
  continuesDraft?: boolean;
  researchRequests?: PublicResearchRequest[];
  proposals: PlannerProposal[];
  sources: string[];
  memoryCheckpoint: {
    summaryText: string;
    goals: string[];
    decisions: string[];
    openQuestions: string[];
  } | null;
};

type ProviderTurn = {
  output: PlannerOutput;
  effectiveModel: string;
  provider: "anthropic" | "openai" | "google";
  transport: "claude_agent_sdk" | "codex_sdk" | "gemini_api";
  authenticationMode: "api_key";
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  webSearchQueries: string[];
  sourceUrls: string[];
  sdkCleanupFailed?: boolean;
};

type AiSetupFailureStage =
  | "off_topic_recording"
  | "conversation_memory"
  | "ai_instructions"
  | "request_recording";

function plainRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], message: string): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error(message);
  }
}

function parseProposal(value: unknown): PlannerProposal {
  const message = "The AI proposal did not match the planning schema.";
  const record = plainRecord(value, message);
  const legacyKeys = ["action", "entityId", "baseRevision", "patchJson", "reason"];
  const currentKeys = ["entityType", ...legacyKeys];
  if (Object.hasOwn(record, "entityType")) {
    assertExactKeys(record, currentKeys, message);
  } else {
    // Accept a response already in flight from the previous itinerary-only
    // schema. Every newly-started provider turn requires entityType.
    assertExactKeys(record, legacyKeys, message);
  }
  const entityType = record.entityType ?? "itinerary_item";
  const action = record.action;
  const entityId = record.entityId;
  const baseRevision = record.baseRevision;
  const patchJson = record.patchJson;
  const reason = record.reason;
  if (
    !["itinerary_item", "expense"].includes(String(entityType))
    || typeof action !== "string"
    || !["create", "update", "update_pending", "cancel", "restore"].includes(action)
    || (entityId !== null && typeof entityId !== "string")
    || (baseRevision !== null && (
      typeof baseRevision !== "number"
      || !Number.isInteger(baseRevision)
      || baseRevision < 1
      || baseRevision > MAX_DATABASE_REVISION
    ))
    || typeof patchJson !== "string"
    || patchJson.length > MAX_PATCH_JSON_CHARACTERS
    || typeof reason !== "string"
    || reason.trim().length < 1
    || reason.length > MAX_PROPOSAL_REASON_CHARACTERS
  ) {
    throw new Error(message);
  }
  return {
    entityType: entityType as PlannerProposal["entityType"],
    action: action as PlannerProposal["action"],
    entityId: entityId as string | null,
    baseRevision: baseRevision as number | null,
    patchJson,
    reason: reason.trim(),
  };
}

function parseSources(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10
      || value.some((source) => typeof source !== "string" || source.length > 2_000)) {
    throw new Error("The AI response did not match the planning schema.");
  }
  return value as string[];
}

function parseStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems
      || value.some((item) => typeof item !== "string" || item.length > maxLength)) {
    throw new Error("The AI memory update did not match the schema.");
  }
  return value as string[];
}

function parseMemoryCheckpoint(value: unknown): PlannerOutput["memoryCheckpoint"] {
  if (value === undefined) return null;
  const message = "The AI memory checkpoint did not match the schema.";
  const record = plainRecord(value, message);
  assertExactKeys(record, ["summaryText", "goals", "decisions", "openQuestions"], message);
  if (typeof record.summaryText !== "string" || record.summaryText.length > 8_000) {
    throw new Error(message);
  }
  return {
    summaryText: record.summaryText,
    goals: parseStringList(record.goals, 12, 500),
    decisions: parseStringList(record.decisions, 12, 500),
    openQuestions: parseStringList(record.openQuestions, 12, 500),
  };
}

function parseOutput(raw: string): PlannerOutput {
  const message = "The AI response did not match the planning schema.";
  const value = plainRecord(JSON.parse(raw), message);
  if (typeof value.message !== "string" || value.message.length > MAX_PROVIDER_MESSAGE_CHARACTERS) {
    throw new Error(message);
  }
  const sources = parseSources(value.sources);

  if (Object.hasOwn(value, "proposals")) {
    const allowedKeys = ["message", "continuesDraft", "researchRequests", "proposals", "sources", "memoryCheckpoint"];
    if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error(message);
    if (value.continuesDraft !== undefined && typeof value.continuesDraft !== "boolean") throw new Error(message);
    if (!Array.isArray(value.proposals) || value.proposals.length > MAX_PROPOSALS_PER_REQUEST) {
      throw new Error(`The AI returned an invalid proposal batch.`);
    }
    return {
      message: value.message,
      continuesDraft: value.continuesDraft as boolean | undefined,
      researchRequests: parsePublicResearchRequests(value.researchRequests),
      proposals: value.proposals.map(parseProposal),
      sources,
      memoryCheckpoint: parseMemoryCheckpoint(value.memoryCheckpoint),
    };
  }

  // Read the exact legacy single-proposal envelope so an in-flight older adapter
  // response can finish while all newly-started turns use the proposals array.
  assertExactKeys(
    value,
    ["message", "action", "entityId", "baseRevision", "patchJson", "reason", "sources"],
    message,
  );
  if (value.action === "none") {
    if (value.entityId !== null || value.baseRevision !== null
        || typeof value.patchJson !== "string" || value.patchJson !== "{}"
        || typeof value.reason !== "string" || value.reason.length > MAX_PROPOSAL_REASON_CHARACTERS) {
      throw new Error(message);
    }
    return { message: value.message, proposals: [], sources, memoryCheckpoint: null };
  }
  return {
    message: value.message,
    proposals: [parseProposal({
      entityType: "itinerary_item",
      action: value.action,
      entityId: value.entityId,
      baseRevision: value.baseRevision,
      patchJson: value.patchJson,
      reason: value.reason,
    })],
    sources,
    memoryCheckpoint: null,
  };
}

function normalizePlannerPatch(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const patch = { ...(value as Record<string, unknown>) };
  if (patch.itemType === "private_event") {
    patch.itemType = "activity";
    patch.visibility = "private";
    if (patch.viewerMemberIds === undefined) patch.viewerMemberIds = [];
  } else if (patch.itemType === "hotel") {
    patch.itemType = "lodging";
  }
  if (patch.status === "confirmed") patch.status = "planned";
  for (const field of ["startsAt", "endsAt", "occurredAt"] as const) {
    if (Object.hasOwn(patch, field)) patch[field] = normalizeAiIsoDateTime(patch[field]);
  }
  if (patch.linkedExpense && typeof patch.linkedExpense === "object"
      && !Array.isArray(patch.linkedExpense)) {
    const expense = patch.linkedExpense as Record<string, unknown>;
    patch.linkedExpense = { ...expense, occurredAt: normalizeAiIsoDateTime(expense.occurredAt) };
  }
  return patch;
}

function redactPlannerOutput(output: PlannerOutput, secrets: ReservationSecretContext): PlannerOutput {
  const redact = (text: string) => redactReservationSecrets(text, secrets);
  const safeUrl = (url: string) => !containsKnownReservationSecret(url, secrets);
  return {
    ...output,
    message: redact(output.message),
    sources: output.sources.filter(safeUrl),
    proposals: output.proposals.map((proposal) => {
      let patchJson = proposal.patchJson;
      try {
        const patch: unknown = JSON.parse(patchJson);
        if (patch && typeof patch === "object" && !Array.isArray(patch)) {
          const fields = patch as Record<string, unknown>;
          for (const key of ["title", "notes", "locationName", "departureLocationName", "destinationLocationName", "description"]) {
            if (typeof fields[key] === "string") fields[key] = redact(fields[key]);
          }
          for (const key of ["mapUrl", "departureMapUrl", "destinationMapUrl"]) {
            if (typeof fields[key] === "string" && !safeUrl(fields[key])) fields[key] = null;
          }
          if (fields.linkedExpense && typeof fields.linkedExpense === "object" && !Array.isArray(fields.linkedExpense)) {
            const expense = fields.linkedExpense as Record<string, unknown>;
            if (typeof expense.description === "string") expense.description = redact(expense.description);
          }
          patchJson = JSON.stringify(fields);
        }
      } catch {
        // Invalid JSON is rejected below, never persisted or sent for repair.
      }
      return { ...proposal, reason: redact(proposal.reason), patchJson };
    }),
    memoryCheckpoint: output.memoryCheckpoint ? {
      summaryText: redact(output.memoryCheckpoint.summaryText),
      goals: output.memoryCheckpoint.goals.map(redact),
      decisions: output.memoryCheckpoint.decisions.map(redact),
      openQuestions: output.memoryCheckpoint.openQuestions.map(redact),
    } : null,
  };
}

class IndexedPatchValidationError extends ZodError {
  constructor(
    readonly proposalIndex: number,
    readonly entityType: PlannerProposal["entityType"],
    error: ZodError,
  ) {
    super(error.issues);
    this.name = "ZodError";
  }
}

function assertProposalReferences(proposal: PlannerProposal, index: number): void {
  if (proposal.action === "create") {
    if (proposal.entityId !== null || proposal.baseRevision !== null) {
      throw new AppConflictError(`AI proposal ${index + 1} cannot create an item from an existing revision.`);
    }
    return;
  }
  if (proposal.entityType === "expense") {
    throw new AppConflictError(`AI proposal ${index + 1} may only create a new expense.`);
  }
  if (!proposal.entityId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposal.entityId)
      || !Number.isInteger(proposal.baseRevision) || (proposal.baseRevision ?? 0) < 1) {
    throw new AppConflictError(`AI proposal ${index + 1} is missing a valid event revision.`);
  }
}

function unambiguousRequestedRelativeDate(
  prompt: string,
  currentTime: { tripLocalDate?: string; tomorrowLocalDate?: string },
): string | null {
  const normalized = prompt.normalize("NFKC");
  const mentionsToday = /(?:\btoday\b|今日)/iu.test(normalized);
  const mentionsTomorrow = /(?:\btomorrow\b|聽日|明日)/iu.test(normalized);
  if (mentionsToday === mentionsTomorrow) return null;
  return requestedRelativeDate(prompt, currentTime);
}

function validationFailureSummary(error: unknown): {
  stage: "itinerary_patch" | "expense_patch";
  issues: Array<{ path: Array<string | number>; code: string; message: string }>;
} | null {
  if (!(error instanceof ZodError)) return null;
  const prefix: Array<string | number> = error instanceof IndexedPatchValidationError
    ? ["proposals", error.proposalIndex, "patchJson"]
    : [];
  return {
    stage: error instanceof IndexedPatchValidationError && error.entityType === "expense"
      ? "expense_patch"
      : "itinerary_patch",
    issues: error.issues.slice(0, 20).map((issue) => ({
      path: [...prefix, ...issue.path.filter((part): part is string | number =>
        typeof part === "string" || typeof part === "number")].slice(0, 12),
      code: issue.code,
      // Do not echo schema keys, invalid values or provider-controlled text.
      message: issue.code === "invalid_format" ? "Invalid field format."
        : issue.code === "unrecognized_keys" ? "Unexpected proposal field."
        : "Invalid proposal field.",
    })),
  };
}

function decodeForInspection(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function containsSensitiveIdentifier(value: string): boolean {
  const decoded = decodeForInspection(value);
  return /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/iu.test(decoded)
    || /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(decoded)
    || /\d{8,}/u.test(decoded);
}

export function blocksLivePlaceSearchForPrivacy(prompt: string): boolean {
  return containsSensitiveIdentifier(prompt) || containsReservationSecret(prompt);
}

function redactSensitiveText(value: string): string {
  return decodeForInspection(value)
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(UUID_PATTERN, "[redacted]")
    .replace(LONG_NUMBER_PATTERN, "[redacted]");
}

function uniqueSearchQueries(queries: string[]): string[] {
  return [...new Set(queries
    .map((query) => redactSensitiveText(query).replace(/\s+/gu, " ").trim())
    .filter(Boolean))]
    .slice(0, 10)
    .map((query) => query.slice(0, 500));
}

function isLikelyPrivateReservationPath(pathname: string): boolean {
  const path = decodeForInspection(pathname);
  if (containsSensitiveIdentifier(path)) return true;
  const reservationWorkflow = /\/(?:reserv(?:e|es|ation|ations)|book(?:ing|ings)?|orders?|receipts?)(?:\/|$)/iu;
  const privateAction = /\/(?:complete|confirmation|confirm|manage|modify|cancel)(?:\/|$)/iu;
  return reservationWorkflow.test(path) && privateAction.test(path);
}

function sanitizePublicSourceUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (isLikelyPrivateReservationPath(url.pathname)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const values = url.searchParams.getAll(key);
      if (/(?:^|_)(?:access_?token|auth|booking|code|confirmation|credential|key|order|receipt|reservation|secret|session|signature|state)(?:$|_)/i.test(key)
          || values.some(containsSensitiveIdentifier)) {
        url.searchParams.delete(key);
      }
    }
    const sanitized = url.toString();
    return sanitized.length <= 2_000 ? sanitized : null;
  } catch {
    return null;
  }
}

function uniqueSourceUrls(urls: string[]): string[] {
  return [...new Set(urls.map(sanitizePublicSourceUrl).filter((url): url is string => Boolean(url)))].slice(0, 10);
}

function safeAiMapUrl(rawUrl: string | null | undefined, locationName: string | null | undefined): string | null | undefined {
  if (rawUrl === undefined && !locationName) return undefined;
  if (rawUrl && isTrustedGoogleMapsUrl(rawUrl)) {
    const sanitized = sanitizePublicSourceUrl(rawUrl);
    if (sanitized) return sanitized;
  }
  const publicLocation = locationName ? redactSensitiveText(locationName).trim() : "";
  return publicLocation
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(publicLocation)}`
    : null;
}

function hasLocationName(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function claudeWebSearchEvidence(value: unknown): { queries: string[]; sourceUrls: string[] } {
  if (!value || typeof value !== "object") return { queries: [], sourceUrls: [] };
  const record = value as { query?: unknown; results?: unknown };
  const queries = typeof record.query === "string" ? [record.query] : [];
  const sourceUrls: string[] = [];
  if (Array.isArray(record.results)) {
    for (const result of record.results) {
      if (!result || typeof result !== "object") continue;
      const content = (result as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const hit of content) {
        if (!hit || typeof hit !== "object") continue;
        const url = (hit as { url?: unknown }).url;
        if (typeof url === "string") sourceUrls.push(url);
      }
    }
  }
  return { queries, sourceUrls };
}

async function runCodexTurn(
  model: OwnerModel,
  prompt: string,
  context: unknown,
  workDirectory: string,
  locale: Locale,
  recentConversation: readonly AiConversationTurn[],
  conversationCheckpoint: AiConversationCheckpoint | null,
  aiInstructions: string,
  liveWebSearchEnabled: boolean,
  liveWebSearchPrivacyBlockReason: LiveWebSearchPrivacyBlockReason | null,
  control: { abortController: AbortController; repair?: TimestampRepairFeedback; draft?: PlanningDraft | null; research?: PlannerResearchContext },
): Promise<ProviderTurn> {
  const profile = ownerModelRegistry[model];
  if (profile.provider !== "openai") {
    throw new Error(`Model ${model} is not configured for the Codex SDK transport.`);
  }
  const codex = new Codex({ env: providerEnvironment(), config: lockedDownCodexConfig });
  const thread = codex.startThread({
    model,
    modelReasoningEffort: profile.reasoningEffort,
    sandboxMode: "read-only",
    workingDirectory: workDirectory,
    skipGitRepoCheck: true,
    networkAccessEnabled: false,
    webSearchMode: liveWebSearchEnabled ? "live" : "disabled",
    approvalPolicy: "never",
  });
  const turn = await thread.run(
    plannerPrompt(
      prompt,
      context,
      locale,
      recentConversation,
      liveWebSearchEnabled,
      liveWebSearchPrivacyBlockReason ?? false,
      conversationCheckpoint,
      aiInstructions,
      control.draft ?? null,
      control.research ?? null,
    ) + (control.repair ? `\n\n${timestampRepairInstructions(control.repair)}` : ""),
    { outputSchema: outputSchema, signal: control.abortController.signal },
  );
  if (usedForbiddenCodexItem(turn.items, { webSearch: liveWebSearchEnabled })) {
    throw new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "openai" });
  }
  let output: PlannerOutput;
  try { output = parseOutput(turn.finalResponse); }
  catch { throw new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "openai" }); }
  return {
    output,
    effectiveModel: model,
    provider: "openai",
    transport: "codex_sdk",
    authenticationMode: "api_key",
    inputTokens: turn.usage?.input_tokens ?? null,
    outputTokens: turn.usage?.output_tokens ?? null,
    cachedInputTokens: turn.usage?.cached_input_tokens ?? null,
    webSearchQueries: uniqueSearchQueries(codexSearchQueries(turn.items)),
    sourceUrls: liveWebSearchEnabled ? uniqueSourceUrls(output.sources) : [],
  };
}

async function runClaudeTurn(
  model: OwnerModel,
  prompt: string,
  context: unknown,
  workDirectory: string,
  locale: Locale,
  recentConversation: readonly AiConversationTurn[],
  conversationCheckpoint: AiConversationCheckpoint | null,
  aiInstructions: string,
  liveWebSearchEnabled: boolean,
  liveWebSearchPrivacyBlockReason: LiveWebSearchPrivacyBlockReason | null,
  control: { abortController: AbortController; repair?: TimestampRepairFeedback; draft?: PlanningDraft | null; research?: PlannerResearchContext },
): Promise<ProviderTurn> {
  const profile = ownerModelRegistry[model];
  if (profile.provider !== "anthropic") {
    throw new Error(`Model ${model} is not configured for the Claude Agent SDK transport.`);
  }
  const completion: { result: SDKResultSuccess | null } = { result: null };
  const webSearchQueries: string[] = [];
  const sourceUrls: string[] = [];
  const failureTracker = createClaudeProviderFailureTracker();
  const conversation = claudeQuery({
    prompt: plannerPrompt(
      prompt,
      context,
      locale,
      recentConversation,
      liveWebSearchEnabled,
      liveWebSearchPrivacyBlockReason ?? false,
      conversationCheckpoint,
      aiInstructions,
      control.draft ?? null,
      control.research ?? null,
    ) + (control.repair ? `\n\n${timestampRepairInstructions(control.repair)}` : ""),
    options: {
      env: providerEnvironment(),
      model,
      abortController: control.abortController,
      cwd: workDirectory,
      tools: liveWebSearchEnabled ? ["WebSearch"] : [],
      allowedTools: liveWebSearchEnabled ? ["WebSearch"] : [],
      disallowedTools: [
        "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "Agent", "Skill",
        ...(liveWebSearchEnabled ? [] : ["WebSearch"]),
      ],
      permissionMode: "dontAsk",
      settingSources: [],
      maxTurns: 4,
      effort: profile.effort,
      outputFormat: { type: "json_schema", schema: outputSchema },
    },
  });
  const lifecycle = await consumeClaudeQuery(conversation, control.abortController.signal, (message) => {
    const providerFailure = failureTracker.observe(message);
    if (providerFailure) throw providerFailure;
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use" && block.name === "WebSearch") {
          const input = block.input as { query?: unknown };
          if (typeof input.query === "string") webSearchQueries.push(input.query);
        }
      }
    }
    if (message.type === "user" && message.tool_use_result !== undefined) {
      const evidence = claudeWebSearchEvidence(message.tool_use_result);
      webSearchQueries.push(...evidence.queries);
      sourceUrls.push(...evidence.sourceUrls);
    }
    if (message.type === "result") {
      if (message.subtype !== "success" || message.is_error) {
        throw new Error(`Claude planning call failed (${message.subtype}).`);
      }
      completion.result = message;
      // SDK result is the turn-complete signal; later informational messages or
      // process teardown must not delay/discard this completed single-prompt turn.
      return true;
    }
  });
  const result = completion.result;
  if (!result) throw new Error("Claude returned no final result.");
  let output: PlannerOutput;
  try {
    const structured = result.structured_output ?? JSON.parse(result.result);
    output = parseOutput(JSON.stringify(structured));
  } catch { throw new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "anthropic" }); }
  const modelUsage = Object.keys(result.modelUsage);
  return {
    output,
    // SDK accounting may list an auxiliary model before the requested planner.
    effectiveModel: modelUsage.find((name) => name === model)
      ?? modelUsage.find((name) => name.startsWith(`${model}-`)) ?? model,
    provider: "anthropic",
    transport: "claude_agent_sdk",
    authenticationMode: "api_key",
    inputTokens: result.usage.input_tokens ?? null,
    outputTokens: result.usage.output_tokens ?? null,
    cachedInputTokens: result.usage.cache_read_input_tokens ?? null,
    webSearchQueries: uniqueSearchQueries(webSearchQueries),
    sourceUrls: liveWebSearchEnabled ? uniqueSourceUrls([...sourceUrls, ...output.sources]) : [],
    ...(lifecycle.cleanupFailed ? { sdkCleanupFailed: true } : {}),
  };
}

async function runGeminiTurn(
  model: OwnerModel,
  prompt: string,
  context: unknown,
  _workDirectory: string,
  locale: Locale,
  recentConversation: readonly AiConversationTurn[],
  conversationCheckpoint: AiConversationCheckpoint | null,
  aiInstructions: string,
  liveWebSearchEnabled: boolean,
  liveWebSearchPrivacyBlockReason: LiveWebSearchPrivacyBlockReason | null,
  control: { abortController: AbortController; repair?: TimestampRepairFeedback; draft?: PlanningDraft | null; research?: PlannerResearchContext },
): Promise<ProviderTurn> {
  const profile = ownerModelRegistry[model];
  if (profile.provider !== "google") {
    throw new Error(`Model ${model} is not configured for the Gemini transport.`);
  }
  const result = await generateWithGemini({
    model,
    parts: [{ text: plannerPrompt(
      prompt,
      context,
      locale,
      recentConversation,
      liveWebSearchEnabled,
      liveWebSearchPrivacyBlockReason ?? false,
      conversationCheckpoint,
      aiInstructions,
      control.draft ?? null,
      control.research ?? null,
    ) + (control.repair ? `\n\n${timestampRepairInstructions(control.repair)}` : "") }],
    responseJsonSchema: outputSchema,
    // Google Search grounding is Gemini's only tool here; nothing can touch files, shells or the network otherwise.
    googleSearch: liveWebSearchEnabled,
    signal: control.abortController.signal,
  });
  let output: PlannerOutput;
  try { output = parseOutput(result.text); }
  catch { throw new AiProviderFailureError({ code: "AI_PROVIDER_OUTPUT_INVALID", provider: "google" }); }
  return {
    output,
    effectiveModel: model,
    provider: "google",
    transport: "gemini_api",
    authenticationMode: "api_key",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cachedInputTokens: result.cachedInputTokens,
    webSearchQueries: uniqueSearchQueries(result.webSearchQueries),
    sourceUrls: liveWebSearchEnabled ? uniqueSourceUrls(output.sources) : [],
  };
}

async function recordAiPolicyDenial(
  pool: Pool,
  session: AuthenticatedSession,
  input: {
    requestId: string;
    prompt: string;
    locale: Locale;
    denial: {
      message: string;
      reasonCode: "ai_disabled" | "daily_limit_reached" | "conversation_busy";
      model: OwnerModel;
    };
    latencyMs: number;
  },
): Promise<void> {
  const safeMessage = input.denial.message;
  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO ai_requests (
         trip_id, id, actor_member_id, actor_user_id, actor_role, feature, prompt_text,
         requested_model, effective_model, provider, transport, authentication_mode,
         billing_basis, status, result_text, input_tokens, output_tokens,
         cached_input_tokens, latency_ms, error_code, error_message, completed_at
       ) VALUES (
         $1,$2,$3,$4,$5,'policy_denial',$6,$7,NULL,'local','policy_gate','none',
         'none','rejected',$8,0,0,0,$9,$10,$11,CURRENT_TIMESTAMP
       )`,
      [
        session.tripId,
        input.requestId,
        session.memberId,
        session.userId,
        session.role,
        input.prompt,
        input.denial.model,
        safeMessage,
        input.latencyMs,
        input.denial.reasonCode,
        safeMessage,
      ],
    );
    await client.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
       VALUES
         ($1,$2,1,'request.started',$3::jsonb),
         ($1,$2,2,'request.rejected',$4::jsonb),
         ($1,$2,3,'request.completed',$5::jsonb)`,
      [
        session.tripId,
        input.requestId,
        JSON.stringify({ model: input.denial.model, locale: input.locale, feature: "policy_denial" }),
        JSON.stringify({
          reasonCode: input.denial.reasonCode,
          message: safeMessage,
          outcome: "policy_denial",
          providerCallCount: 0,
          toolCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
        }),
        JSON.stringify({
          status: "rejected",
          outcome: "policy_denial",
          proposalId: null,
          changeStatus: null,
          entityId: null,
        }),
      ],
    );
  });
}

async function recordAiSetupFailure(
  pool: Pool,
  session: AuthenticatedSession,
  input: {
    requestId: string;
    prompt: string;
    locale: Locale;
    model: OwnerModel;
    stage: AiSetupFailureStage;
    latencyMs: number;
  },
): Promise<void> {
  const profile = ownerModelRegistry[input.model];
  const errorCode = `AI_SETUP_${input.stage.toUpperCase()}_FAILED`;
  const errorMessage = "AI request setup failed before the provider call.";
  await inTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ai_requests (
         trip_id, id, actor_member_id, actor_user_id, actor_role, feature, prompt_text,
         requested_model, effective_model, provider, transport, authentication_mode,
         billing_basis, status, input_tokens, output_tokens, cached_input_tokens,
         latency_ms, error_code, error_message, completed_at
       ) VALUES (
         $1,$2,$3,$4,$5,'planning',$6,$7,NULL,$8,$9,$10,
         'api','failed',0,0,0,$11,$12,$13,CURRENT_TIMESTAMP
       )
       ON CONFLICT (trip_id, id) DO NOTHING
       RETURNING id`,
      [
        session.tripId,
        input.requestId,
        session.memberId,
        session.userId,
        session.role,
        input.prompt,
        input.model,
        profile.provider,
        profile.transport,
        profile.authenticationMode,
        input.latencyMs,
        errorCode,
        errorMessage,
      ],
    );
    if (inserted.rowCount === 0) return;
    await client.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
       VALUES
         ($1,$2,1,'request.started',$3::jsonb),
         ($1,$2,2,'request.failed',$4::jsonb)`,
      [
        session.tripId,
        input.requestId,
        JSON.stringify({ model: input.model, locale: input.locale, feature: "planning" }),
        JSON.stringify({
          errorCode,
          errorMessage,
          stage: input.stage,
          providerCallCount: 0,
          toolCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
        }),
      ],
    );
  });
}

export function runAiPlanner(
  pool: Pool, session: AuthenticatedSession, prompt: string, requestedModel?: OwnerModel, locale?: Locale,
): Promise<AiPlannerResult>;
export function runAiPlanner(
  pool: Pool, session: AuthenticatedSession, prompt: string, requestedModel: OwnerModel | undefined,
  locale: Locale | undefined, clientRequestId: string | undefined,
  conversationId?: string | null,
  images?: readonly PreparedAiImage[],
): Promise<AiPlannerResult | AiRequestRecoveryResponse>;
export async function runAiPlanner(
  pool: Pool,
  session: AuthenticatedSession,
  prompt: string,
  requestedModel?: OwnerModel,
  locale: Locale = "en",
  clientRequestId?: string,
  conversationId?: string | null,
  images: readonly PreparedAiImage[] = [],
): Promise<AiPlannerResult | AiRequestRecoveryResponse> {
  const requestId = randomUUID();
  const originalPrompt = prompt;
  const payloadHash = clientRequestId ? aiRequestPayloadHash(prompt, requestedModel, locale, conversationId, images.map((image) => image.sha256)) : null;
  const started = Date.now();
  const workBudget = aiRequestWorkBudgetMs(images.length > 0);
  const offTopicDecision = classifyOffTopicPrompt(prompt);
  let selectedPolicyModel: OwnerModel | null = null;
  let setupFailureStage: AiSetupFailureStage = "conversation_memory";
  const setup = await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    await lockBoundUserAi(client, session.userId);
    if (clientRequestId && payloadHash) {
      const replay = await findAiRequestReplay(client, session, clientRequestId, payloadHash);
      if (replay) return { kind: "replay" as const, recovery: replay };
    }
    const selectedConversationId = conversationId !== undefined
      ? await selectAiConversationForSubmission(client, session, conversationId) : undefined;
    const purpose = await readAiConversationPurpose(client, session);
    if (purpose === "preferences") throw new AppConflictError("Legacy preference conversations are read-only. Start a new conversation.");
    const currentPolicy = await getAiPolicy(client, session, requestedModel, {
      serializeMemberQuota: true,
    });
    selectedPolicyModel = currentPolicy.model;
    await assertBoundUserAiIdle(client, session.userId);
    if (offTopicDecision.offTopic && images.length === 0) {
      setupFailureStage = "off_topic_recording";
      const message = offTopicReply(
        locale,
        offTopicDecision.category,
        offTopicDecision.restrictedTone ?? false,
      );
      const latencyMs = Date.now() - started;
      const response: AiPlannerResult = {
        requestId, message, proposalIds: [], proposalCount: 0, proposalId: null, changeStatus: null, entityId: null,
        model: currentPolicy.model, usedToday: currentPolicy.usedToday + 1,
        remainingToday: currentPolicy.limit === null ? null : Math.max(0, currentPolicy.limit - currentPolicy.usedToday - 1),
        webSearch: { performed: false, queryCount: 0, sources: [] },
        memory: { previousTurnsUsed: 0, tokenEstimate: 0, tokenBudget: RECENT_CONVERSATION_TOKEN_BUDGET,
          checkpointVersion: null, truncated: false },
      };
      await client.query(
        `INSERT INTO ai_requests (
           trip_id, id, actor_member_id, actor_user_id, actor_role, feature, prompt_text,
           requested_model, effective_model, provider, transport, authentication_mode, billing_basis,
           status, result_text, input_tokens, output_tokens, cached_input_tokens,
           latency_ms, completed_at
         ) VALUES (
           $1,$2,$3,$4,$5,'off_topic',$6,$7,$7,'local','deterministic_gate','none','none',
           'succeeded',$8,0,0,0,$9,CURRENT_TIMESTAMP
         )`,
        [session.tripId, requestId, session.memberId, session.userId, session.role, prompt,
          currentPolicy.model, message, latencyMs],
      );
      if (selectedConversationId) {
        await client.query(`UPDATE ai_requests SET conversation_id = $3 WHERE trip_id = $1 AND id = $2`,
          [session.tripId, requestId, selectedConversationId]);
      }
      if (clientRequestId) {
        await client.query(
          `UPDATE ai_requests SET client_request_id = $3, request_payload_hash = $4, response_json = $5::jsonb
            WHERE trip_id = $1 AND id = $2`,
          [session.tripId, requestId, clientRequestId, payloadHash, JSON.stringify(response)],
        );
      }
      await client.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES
           ($1,$2,1,'request.started',$3::jsonb),
           ($1,$2,2,'request.short_circuited',$4::jsonb),
           ($1,$2,3,'request.completed',$5::jsonb)`,
        [
          session.tripId,
          requestId,
          JSON.stringify({ model: currentPolicy.model, locale, feature: "off_topic" }),
          JSON.stringify({
            classifier: "deterministic_high_precision_v1",
            category: offTopicDecision.category,
            restrictedTone: offTopicDecision.restrictedTone ?? false,
            outcome: "off_topic",
            providerCallCount: 0,
            toolCallCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
          }),
          JSON.stringify({
            status: "succeeded",
            outcome: "off_topic",
            proposalId: null,
            changeStatus: null,
            entityId: null,
          }),
        ],
      );
      return { kind: "off_topic" as const, response };
    }

    setupFailureStage = "conversation_memory";
    const memory = await prepareAiConversation(client, session);
    const planningDraft = await loadPlanningDraft(client, session, memory.conversationId);
    setupFailureStage = "ai_instructions";
    const aiInstructions = await readAiInstructions(client, session.userId);
    setupFailureStage = "request_recording";
    const profile = ownerModelRegistry[currentPolicy.model];
    await client.query(
      `INSERT INTO ai_requests (
         trip_id, id, actor_member_id, actor_user_id, conversation_id, actor_role,
         prompt_text, requested_model, provider, transport, authentication_mode, billing_basis
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'api')`,
      [session.tripId, requestId, session.memberId, session.userId, memory.conversationId,
        session.role, prompt, currentPolicy.model,
        profile.provider, profile.transport, profile.authenticationMode],
    );
    if (images.length) await saveAiRequestImages(client, session, requestId, images);
    if (clientRequestId) {
      await client.query(
        `UPDATE ai_requests SET client_request_id = $3, request_payload_hash = $4 WHERE trip_id = $1 AND id = $2`,
        [session.tripId, requestId, clientRequestId, payloadHash],
      );
    }
    await client.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
       VALUES ($1,$2,1,'request.started',$3::jsonb)`,
      [session.tripId, requestId, JSON.stringify({ model: currentPolicy.model, locale })],
    );
    await client.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
       VALUES ($1,$2,2,'conversation.memory.loaded',$3::jsonb)`,
      [session.tripId, requestId, JSON.stringify({
        conversationId: memory.conversationId,
        turnCount: memory.turns.length,
        tokenEstimate: memory.tokenEstimate,
        tokenBudget: RECENT_CONVERSATION_TOKEN_BUDGET,
        checkpointId: memory.checkpoint?.id ?? null,
        checkpointVersion: memory.checkpoint?.version ?? null,
        aiInstructionsRevision: aiInstructions.revision,
        truncated: memory.truncated,
      })],
    );
    return {
      kind: "planning" as const,
      policy: currentPolicy,
      conversationMemory: memory,
      planningDraft,
      aiInstructions,
    };
  }).catch(async (error: unknown) => {
    if (error instanceof AiPolicyDeniedError) {
      try {
        await recordAiPolicyDenial(pool, session, {
          requestId,
          prompt,
          locale,
          denial: error,
          latencyMs: Date.now() - started,
        });
      } catch {
        // Audit persistence is best effort and must not replace the policy error.
      }
    } else if (error instanceof AiConversationBusyError && selectedPolicyModel) {
      try {
        await recordAiPolicyDenial(pool, session, {
          requestId,
          prompt,
          locale,
          denial: {
            message: error.message,
            reasonCode: "conversation_busy",
            model: selectedPolicyModel,
          },
          latencyMs: Date.now() - started,
        });
      } catch {
        // Audit persistence is best effort and must not replace the busy error.
      }
    } else if (selectedPolicyModel) {
      try {
        await recordAiSetupFailure(pool, session, {
          requestId,
          prompt,
          locale,
          model: selectedPolicyModel,
          stage: setupFailureStage,
          latencyMs: Date.now() - started,
        });
      } catch {
        // The setup transaction has already rolled back. Preserve its original
        // error even when the independent audit transaction also fails.
      }
    }
    throw error;
  });

  if (setup.kind === "replay") return setup.recovery;
  if (setup.kind === "off_topic") return setup.response;

  const { policy, conversationMemory, aiInstructions, planningDraft } = setup;
  let reservationSecrets = inspectReservationSecrets([
    prompt, aiInstructions.instructions, JSON.stringify(conversationMemory.turns), JSON.stringify(conversationMemory.checkpoint),
    JSON.stringify(planningDraft?.userRequests ?? []),
  ].join("\n"));

  let nextEventSequence = 3;
  let providerAttempts = 0;
  let recordedUsage: { input: number | null; output: number | null; cached: number | null } = {
    input: null, output: null, cached: null,
  };
  let recordedEffectiveModel: string | null = null;
  try {
    if (images.length) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_IMAGE_EXTRACTION_BUDGET_MS);
      timeout.unref();
      try {
        await pool.query(
          `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
           VALUES ($1,$2,$3,'images.extraction.started',$4::jsonb)`,
          [session.tripId, requestId, nextEventSequence++, JSON.stringify({ count: images.length, model: policy.model })],
        );
        const extracted = await extractAiImageFacts({ model: policy.model, images, signal: controller.signal, locale });
        providerAttempts = 1;
        recordedEffectiveModel = extracted.effectiveModel;
        recordedUsage = { input: extracted.inputTokens, output: extracted.outputTokens, cached: extracted.cachedInputTokens };
        reservationSecrets = {
          detected: reservationSecrets.detected || extracted.secrets.detected,
          credentials: [...new Set([...reservationSecrets.credentials, ...extracted.secrets.credentials])],
          privateUrls: [...new Set([...reservationSecrets.privateUrls, ...extracted.secrets.privateUrls])],
        };
        const facts = redactReservationSecrets(extracted.facts, reservationSecrets);
        await inTransaction(pool, async (client) => {
          await saveAiImageFacts(client, session, requestId, facts);
          await client.query(
            `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
             VALUES ($1,$2,$3,'images.extraction.completed',$4::jsonb)`,
            [session.tripId, requestId, nextEventSequence++, JSON.stringify({ count: images.length,
              characters: facts.length, model: extracted.effectiveModel,
              inputTokens: extracted.inputTokens, outputTokens: extracted.outputTokens, cachedInputTokens: extracted.cachedInputTokens })],
          );
        });
        prompt = withAiImageFacts(originalPrompt, facts);
      } finally { clearTimeout(timeout); }
    }
    const contextResult = await pool.query(
      `SELECT jsonb_build_object(
         'trip', jsonb_build_object(
           'id', t.id, 'name', t.name, 'destinationName', t.destination_name, 'timeZone', t.time_zone,
           'currency', t.default_currency, 'startsOn', t.starts_on, 'endsOn', t.ends_on
         ),
         'actor', (
           SELECT jsonb_build_object('memberId', actor.id, 'role', actor.role)
             FROM trip_members actor
            WHERE actor.trip_id = t.id AND actor.id = $2 AND actor.status = 'active'
         ),
         'audienceDirectory', COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', member.id, 'displayName', member.display_name, 'role', member.role,
             'status', member.status
           ) ORDER BY member.role = 'owner' DESC, member.display_name, member.id)
             FROM trip_members member
            WHERE member.trip_id = t.id AND member.status IN ('active', 'invited')
         ), '[]'::jsonb),
         'currentTime', jsonb_build_object(
           'nowUtc', CURRENT_TIMESTAMP,
           'timeZone', t.time_zone,
           'tripLocalDate', to_char(CURRENT_TIMESTAMP AT TIME ZONE t.time_zone, 'YYYY-MM-DD'),
           'tomorrowLocalDate', to_char((CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date + 1, 'YYYY-MM-DD'),
           'tripLocalTime', to_char(CURRENT_TIMESTAMP AT TIME ZONE t.time_zone, 'HH24:MI:SS'),
           'tripLocalWeekday', trim(to_char(CURRENT_TIMESTAMP AT TIME ZONE t.time_zone, 'Day')),
           'planningReferenceDate', to_char((CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date, 'YYYY-MM-DD')
         ),
         'days', COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', d.id, 'date', d.day_date, 'label', d.label) ORDER BY d.day_date)
             FROM trip_days d WHERE d.trip_id = t.id AND d.day_date BETWEEN t.starts_on AND t.ends_on
         ), '[]'::jsonb),
         'itinerary', COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'tripDayId', i.trip_day_id, 'revision', i.current_revision,
             'title', i.title, 'itemType', i.item_type, 'startsAt', i.starts_at,
             'endsAt', i.ends_at, 'locationName', i.location_name, 'visibility', i.visibility, 'mapUrl', i.map_url,
             'departureLocationName', i.departure_location_name,
             'destinationLocationName', i.destination_location_name, 'notes', i.notes,
             'status', i.status, 'isLocked', i.is_locked
           ) ORDER BY i.starts_at NULLS LAST, i.id)
             FROM itinerary_items i
            WHERE i.trip_id = t.id
              AND to_jsonb(i)->>'removed_at' IS NULL
              AND app_member_can_view_itinerary_item(i.trip_id, i.id, $2)
         ), '[]'::jsonb)
       ) AS context
       FROM trips t WHERE t.id = $1`,
      [session.tripId, session.memberId],
    );
    const canonicalContext = contextResult.rows[0]?.context;
    if (!canonicalContext) throw new Error("Trip context is unavailable.");
    // Pending proposals have their own identity/revision and never masquerade as
    // canonical itinerary rows. Only authorized editable drafts enter context.
    const pendingContext = await inTransaction(pool, async (client) => {
      await lockCurrentTripActor(client, session);
      return getAiPendingItineraryContext(client, session, session.tripId);
    });
    const context = {
      ...canonicalContext,
      ...pendingContext,
      currentRequest: { imageCount: images.length },
    };
    const contextRecord = context as {
      currentTime?: { tripLocalDate?: string; tomorrowLocalDate?: string };
      trip?: { destinationName?: string; timeZone?: string; startsOn?: string; endsOn?: string };
      days?: Array<{ id: string; date: string; label?: string | null }>;
      actor?: { memberId: string; role: "owner" | "editor" | "viewer" } | null;
      audienceDirectory?: Array<{
        id: string;
        displayName: string;
        role: "owner" | "editor" | "viewer";
        status?: "active" | "invited";
      }>;
      itinerary?: Array<{
        id: string;
        title?: string;
        notes?: string | null;
        itemType: ItineraryPatch["itemType"];
        tripDayId?: string;
        startsAt?: string | null;
        endsAt?: string | null;
        locationName?: string | null;
        visibility?: "trip" | "private";
        mapUrl?: string | null;
        departureLocationName?: string | null;
        destinationLocationName?: string | null;
      }>;
    } & Awaited<ReturnType<typeof getAiPendingItineraryContext>>;
    const clarificationReply = isDraftClarificationReply(
      originalPrompt, (contextRecord.audienceDirectory ?? []).map((member) => member.displayName),
    );
    const contextualCandidate = Boolean(planningDraft) && isDraftContinuationCandidate(originalPrompt);
    let draftMode: "close" | "new" | "continue" | "none" | "lookup" = isDraftCancellation(originalPrompt) ? "close"
      : isDraftCreateRequest(originalPrompt) ? "new"
        : contextualCandidate ? "continue"
        : clarificationReply ? planningDraft ? "continue" : "none"
          : getLiveSearchIntent(originalPrompt) === "required" ? "lookup" : "close";
    let resumedDraft = draftMode === "continue" && planningDraft ? anchorPlanningDraft(planningDraft) : null;
    let evidencePrompt = planningDraftEvidence(resumedDraft, prompt);
    const detachedClarification = clarificationReply && !planningDraft && draftMode === "none";
    await pool.query(
      `INSERT INTO ai_request_events (
         trip_id, ai_request_id, sequence, event_type, payload
       ) VALUES ($1,$2,$3,'context.prepared',$4::jsonb)`,
      [session.tripId, requestId, nextEventSequence, JSON.stringify({
        currentTime: contextRecord.currentTime ?? null,
        tripContext: contextRecord.trip ?? null,
        tripDayCount: contextRecord.days?.length ?? 0,
        audienceMemberCount: contextRecord.audienceDirectory?.length ?? 0,
        pendingItineraryCount: pendingContext.pendingItinerary.length,
        pendingItineraryTruncated: pendingContext.pendingItineraryTruncated,
      })],
    );
    nextEventSequence += 1;

    const liveSearchIntent = getLiveSearchIntent(originalPrompt);
    const livePlaceSearchRequested = liveSearchIntent === "required";
    const liveWebSearchPrivacyBlockReason: LiveWebSearchPrivacyBlockReason | null =
      !livePlaceSearchRequested
        ? null
        : (images.length > 0 && reservationSecrets.detected) || blocksLivePlaceSearchForPrivacy(prompt)
          ? "sensitive_identifiers"
          : aiInstructions.instructions.trim()
            ? "private_ai_instructions"
            : null;
    const livePlaceSearchRequired = livePlaceSearchRequested
      && liveWebSearchPrivacyBlockReason === null;
    const automaticPrivacyBlocked = reservationSecrets.detected || blocksLivePlaceSearchForPrivacy(evidencePrompt)
      || blocksLivePlaceSearchForPrivacy(aiInstructions.instructions)
      || /\bprivate\b|私人|私密|非公開|プライベート/iu.test(`${evidencePrompt}\n${aiInstructions.instructions}`);
    let researchContext: PlannerResearchContext = {
      phase: liveSearchIntent === "disabled" ? "disabled" : "available",
      outcome: liveSearchIntent === "disabled" ? "user_disabled" : automaticPrivacyBlocked ? "privacy_limited" : "not_needed_yet",
      facts: [],
    };
    await pool.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
       VALUES ($1,$2,$3,'web.search.policy',$4::jsonb)`,
      [session.tripId, requestId, nextEventSequence++, JSON.stringify({
        model: policy.model, provider: ownerModelRegistry[policy.model].provider,
        intent: liveSearchIntent, requested: livePlaceSearchRequested, enabled: livePlaceSearchRequired,
        automaticResearchAvailable: researchContext.phase === "available",
        reason: liveWebSearchPrivacyBlockReason
          ?? (liveSearchIntent === "disabled" ? "user_disabled"
            : livePlaceSearchRequested ? "public_lookup" : "not_requested"),
      })],
    );
    if (liveWebSearchPrivacyBlockReason) {
      await pool.query(
        `INSERT INTO ai_request_events (
           trip_id, ai_request_id, sequence, event_type, payload
         ) VALUES ($1,$2,$3,'web.search.blocked',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence, JSON.stringify({
          requested: true,
          reason: liveWebSearchPrivacyBlockReason,
        })],
      );
      nextEventSequence += 1;
    }
    const runTurn = async (repair?: TimestampRepairFeedback): Promise<ProviderTurn> => {
      const remainingBudget = started + workBudget - Date.now();
      if (remainingBudget <= 0) throw new AiPlannerTimeoutError();
      const workDirectory = await mkdtemp(join(tmpdir(), "stardust-ai-"));
      const abortController = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { abortController.abort(); reject(new AiPlannerTimeoutError()); },
          Math.max(1, started + workBudget - Date.now()));
        timeout.unref();
      });
      const control = { abortController, repair, draft: resumedDraft,
        research: repair ? { phase: "disabled" as const, outcome: "timestamp_repair", facts: [] } : researchContext };
      let providerFailed = false;
      let providerReturned = false;
      try {
        if (started + workBudget <= Date.now()) throw new AiPlannerTimeoutError();
        const provider = ownerModelRegistry[policy.model].provider;
        const runProviderTurn = provider === "anthropic" ? runClaudeTurn : provider === "google" ? runGeminiTurn : runCodexTurn;
        const providerPromise = runProviderTurn(
          policy.model, prompt, context, workDirectory, locale, conversationMemory.turns,
          conversationMemory.checkpoint, aiInstructions.instructions,
          repair || researchContext.phase === "complete" ? false : livePlaceSearchRequired,
          liveWebSearchPrivacyBlockReason,
          control,
        );
        const providerResult = await Promise.race([providerPromise, deadline]);
        providerReturned = true;
        const result: ProviderTurn = {
          ...providerResult,
          output: redactPlannerOutput(providerResult.output, reservationSecrets),
          webSearchQueries: providerResult.webSearchQueries.map((query) => redactReservationSecrets(query, reservationSecrets)),
          sourceUrls: providerResult.sourceUrls.filter((url) => !containsKnownReservationSecret(url, reservationSecrets)),
        };
        providerAttempts += 1;
        const addUsage = (previous: number | null, next: number | null): number | null =>
          previous === null || next === null ? null : previous + next;
        recordedUsage = providerAttempts > 1 ? {
          input: addUsage(recordedUsage.input, result.inputTokens),
          output: addUsage(recordedUsage.output, result.outputTokens),
          cached: addUsage(recordedUsage.cached, result.cachedInputTokens),
        } : { input: result.inputTokens, output: result.outputTokens, cached: result.cachedInputTokens };
        recordedEffectiveModel = result.effectiveModel;
        await pool.query(
          `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
           VALUES ($1,$2,$3,'provider.attempt.completed',$4::jsonb)`,
          [session.tripId, requestId, nextEventSequence++, JSON.stringify({
            attempt: providerAttempts, repair: Boolean(repair), model: result.effectiveModel,
            researchFinalization: researchContext.phase === "complete" && !repair,
            inputTokens: result.inputTokens, outputTokens: result.outputTokens,
            cachedInputTokens: result.cachedInputTokens,
            ...(result.sdkCleanupFailed ? { sdkCleanupFailed: true } : {}),
          })],
        );
        return result;
      } catch (error) {
        providerFailed = true;
        if (!providerReturned) {
          // A timed-out/failed attempt may have consumed unreported tokens. Keep
          // prior per-attempt receipts, but never present their sum as a full total.
          recordedUsage = { input: null, output: null, cached: null };
        }
        if (abortController.signal.aborted) throw new AiPlannerTimeoutError();
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
        abortController.abort();
        try {
          await rm(workDirectory, {
            recursive: true,
            force: true,
            maxRetries: WORKSPACE_CLEANUP_MAX_RETRIES,
            retryDelay: WORKSPACE_CLEANUP_RETRY_DELAY_MS,
          });
        } catch {
          const cleanupEventSequence = nextEventSequence;
          nextEventSequence += 1;
          try {
            await pool.query(
              `INSERT INTO ai_request_events (
                 trip_id, ai_request_id, sequence, event_type, payload
               ) VALUES ($1,$2,$3,'workspace.cleanup.failed',$4::jsonb)`,
              [session.tripId, requestId, cleanupEventSequence, JSON.stringify({
                providerFailed,
                maxRetries: WORKSPACE_CLEANUP_MAX_RETRIES,
                retryDelayMs: WORKSPACE_CLEANUP_RETRY_DELAY_MS,
              })],
            );
          } catch {
            // The primary failure must survive even if the independent cleanup
            // receipt cannot be persisted. Log only the request correlation ID.
            console.error("AI workspace cleanup audit failed", { requestId });
          }
          // Resource disposal is an independent operational problem, never
          // permission to discard a completed answer or skip normal validation.
        }
      }
    };
    let reusableHours: ReusableVenueHours = { hoursEvidence: [], attemptedHoursTargets: [] };
    // Set only when code replaces an unfinished answer with a zero-proposal
    // notice; model output cannot waive the normal required-search check.
    let finalizationIncomplete = false;
    let turn = await runTurn();

    // One planner-directed public lookup round. The preliminary answer is never
    // saved as a completed conversation or used to write proposals. Only minimal
    // validated subjects reach the researcher, which cannot see this context.
    if (turn.output.researchRequests?.length) {
      const preliminary = turn;
      const privateItems = (contextRecord.itinerary ?? []).filter((item) => item.visibility !== "trip");
      const forbiddenTexts = privateItems.flatMap((item) => [item.title, item.locationName,
        item.departureLocationName, item.destinationLocationName, item.notes])
        .concat(pendingContext.pendingItinerary.filter((item) => item.patch.visibility !== "trip")
          .flatMap((item) => [item.patch.title, item.patch.locationName, item.patch.departureLocationName,
            item.patch.destinationLocationName, item.patch.notes]))
        .filter((value): value is string => Boolean(value));
      const targets = selectPublicResearchTargets(turn.output.researchRequests, {
        forbiddenTexts,
        memberNames: (contextRecord.audienceDirectory ?? []).map((member) => member.displayName),
        privacyBlocked: automaticPrivacyBlocked,
        userDisabled: liveSearchIntent === "disabled",
      });
      const initialHoursTargets = selectPublicResearchHoursTargets(targets, contextRecord.trip?.timeZone ?? "UTC");
      researchContext = { phase: "complete", facts: [],
        outcome: liveSearchIntent === "disabled" ? "user_disabled" : targets.length ? "unverified" : "privacy_blocked" };
      let researchQueries: string[] = [];
      let researchSources: string[] = [];
      const researchBudget = Math.min(PUBLIC_RESEARCH_BUDGET_MS,
        started + workBudget - Date.now() - PUBLIC_RESEARCH_FINALIZATION_RESERVE_MS);
      await pool.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'public.research.requested',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence++, JSON.stringify({
          model: policy.model, requestedCount: turn.output.researchRequests.length, eligibleCount: targets.length,
          hoursTargetCount: initialHoursTargets.length,
          maximumMilliseconds: Math.max(0, researchBudget),
        })],
      );
      if (targets.length && researchBudget >= PUBLIC_RESEARCH_MIN_BUDGET_MS) {
        let workDirectory: string | null = null;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const abortController = new AbortController();
        let invoked = false;
        let returned = false;
        let receipt: Record<string, unknown> = {};
        try {
          workDirectory = await mkdtemp(join(tmpdir(), "stardust-public-research-"));
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => { abortController.abort(); reject(new Error("Public research timed out")); },
              Math.max(1, Math.min(researchBudget, started + workBudget - Date.now() - PUBLIC_RESEARCH_FINALIZATION_RESERVE_MS)));
            timeout.unref();
          });
          invoked = true;
          providerAttempts += 1;
          const result = await Promise.race([runPublicResearch({ model: policy.model, targets,
            hoursTargets: initialHoursTargets,
            workDirectory, abortController, nowUtc: new Date().toISOString() }), timeoutPromise]);
          returned = true;
          const add = (before: number | null, extra: number | null) => before === null || extra === null ? null : before + extra;
          recordedUsage = { input: add(recordedUsage.input, result.inputTokens), output: add(recordedUsage.output, result.outputTokens),
            cached: add(recordedUsage.cached, result.cachedInputTokens) };
          researchContext.facts = result.facts;
          researchQueries = result.webSearchQueries.map((query) => redactReservationSecrets(query, reservationSecrets));
          researchSources = result.sourceUrls.filter((url) => !containsKnownReservationSecret(url, reservationSecrets));
          if (researchQueries.length) {
            // Recheck the input binding at the orchestration boundary. V-keys
            // are ephemeral per lookup, never an event or cross-turn identity.
            const expected = (row: { key: string; venueName: string; date: string; timeZone: string }) =>
              initialHoursTargets.some((target) => target.key === row.key && target.venueName === row.venueName
                && target.date === row.date && target.timeZone === row.timeZone);
            reusableHours = {
              hoursEvidence: (result.hoursEvidence ?? []).filter(expected),
              attemptedHoursTargets: (result.attemptedHoursTargets ?? []).filter(expected),
            };
            researchContext.hoursEvidence = reusableHours.hoursEvidence;
            researchContext.attemptedHoursTargets = reusableHours.attemptedHoursTargets;
          }
          researchContext.outcome = result.facts.some((fact) => fact.status === "verified") ? "researched" : "unverified";
          receipt = { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens,
            queryCount: researchQueries.length, queries: researchQueries, sourceUrls: researchSources,
            priceQuoteCount: result.facts.reduce((count, fact) => count + (fact.priceQuotes?.length ?? 0), 0),
            hoursEvidenceCount: reusableHours.hoursEvidence.length, hoursAttemptedCount: reusableHours.attemptedHoursTargets.length,
            ...(result.cleanupFailed ? { cleanupFailed: true } : {}) };
        } catch (error) {
          if (invoked && !returned) recordedUsage = { input: null, output: null, cached: null };
          const providerFailure = aiProviderFailureDetails(error);
          if (providerFailure) receipt.providerFailure = providerFailure;
          researchContext = { phase: "complete", facts: [], outcome: abortController.signal.aborted ? "timeout" : "failed" };
        } finally {
          if (timeout) clearTimeout(timeout);
          abortController.abort();
          if (workDirectory) {
            try {
              // Only this exact mkdtemp-created directory is removed.
              await rm(workDirectory, { recursive: true, force: true,
                maxRetries: WORKSPACE_CLEANUP_MAX_RETRIES, retryDelay: WORKSPACE_CLEANUP_RETRY_DELAY_MS });
            } catch {
              receipt.cleanupFailed = true;
              // Workspace disposal is independent of the source evidence and
              // original timeout/provider outcome. Never relabel or erase it.
            }
          }
        }
        await pool.query(
          `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
           VALUES ($1,$2,$3,'public.research.completed',$4::jsonb)`,
          [session.tripId, requestId, nextEventSequence++, JSON.stringify({ outcome: researchContext.outcome,
            targetCount: targets.length, facts: researchContext.facts.map((fact) => ({ key: fact.key, kind: fact.kind, status: fact.status })), ...receipt })],
        );
      } else if (targets.length) {
        researchContext.outcome = "budget_exhausted";
      }
      // Preserve which subjects could not be researched without including them
      // in hosted search or copying private request text into audit events.
      const finalizationContext = { ...researchContext,
        requested: preliminary.output.researchRequests,
        eligibleCount: targets.length };
      researchContext = finalizationContext;
      let finalized = false;
      let finalizationFailure: ReturnType<typeof aiProviderFailureDetails> = null;
      let finalizationReason: ResearchCompletionFailure | null = "budget_exhausted";
      const researchOutcome = researchContext.outcome;
      const finalizationBudget = Math.max(0, started + workBudget - Date.now());
      if (started + workBudget - Date.now() >= PUBLIC_RESEARCH_MIN_BUDGET_MS) {
        try {
          turn = await runTurn();
          finalized = !turn.output.researchRequests?.length;
          finalizationReason = finalized ? null : "additional_research";
        } catch (error) {
          // Research cannot cause a half-written plan. A failed final pass
          // produces an explicit no-proposal response, not the interim answer.
          researchContext.outcome = "finalization_failed";
          finalizationFailure = aiProviderFailureDetails(error);
          finalizationReason = error instanceof AiPlannerTimeoutError ? "timeout" : finalizationFailure ? "provider_failed" : "failed";
        }
      }
      if (!finalized) {
        finalizationIncomplete = true;
        turn = { ...preliminary, output: { ...preliminary.output,
          message: researchCompletionNotice(finalizationReason ?? "failed", { locale, timeZone: contextRecord.trip?.timeZone ?? "UTC",
            isOwner: policy.limit === null, providerFailure: finalizationFailure }),
          proposals: [], researchRequests: [] } };
      }
      turn = { ...turn,
        webSearchQueries: uniqueSearchQueries([...preliminary.webSearchQueries, ...researchQueries, ...turn.webSearchQueries]),
        sourceUrls: uniqueSourceUrls([...preliminary.sourceUrls, ...researchSources]),
      };
      await pool.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'public.research.finalized',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence++, JSON.stringify({ outcome: researchContext.outcome,
          finalized, factCount: researchContext.facts.length, researchOutcome, finalizationBudgetMs: finalizationBudget,
          ...(finalizationReason ? { failureReason: finalizationReason } : {}),
          ...(finalizationFailure ? { providerFailure: finalizationFailure } : {}) })],
      );
    }

    if (resumedDraft) {
      const continues = turn.output.continuesDraft ?? clarificationReply;
      if (!continues) {
        if (turn.output.proposals.length) {
          throw new AppConflictError("This reply did not continue the open request; no change was proposed.");
        }
        draftMode = "lookup";
        resumedDraft = null;
        evidencePrompt = prompt;
      }
    }

    if (turn.webSearchQueries.length > 0) {
      await pool.query(
        `INSERT INTO ai_request_events (
           trip_id, ai_request_id, sequence, event_type, payload
         ) VALUES ($1,$2,$3,'web.search.completed',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence, JSON.stringify({
          provider: turn.provider,
          required: livePlaceSearchRequired,
          searched: true,
          toolCount: turn.webSearchQueries.length,
          queryCount: turn.webSearchQueries.length,
          queries: turn.webSearchQueries,
          sourceDomains: [...new Set(turn.sourceUrls.map((url) => new URL(url).hostname))],
          sourceUrls: turn.sourceUrls,
        })],
      );
      nextEventSequence += 1;
    } else if (livePlaceSearchRequired && !finalizationIncomplete) {
      await pool.query(
        `INSERT INTO ai_request_events (
           trip_id, ai_request_id, sequence, event_type, payload
         ) VALUES ($1,$2,$3,'web.search.missing',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence, JSON.stringify({
          provider: turn.provider,
          required: true,
        })],
      );
      nextEventSequence += 1;
      throw Object.assign(new AppConflictError(
        "Live place search was required, but the AI returned no search evidence. No itinerary change was proposed.",
      ), { name: "AI_SEARCH_EVIDENCE_MISSING" });
    }

    let output = !finalizationIncomplete && (detachedClarification || (!planningDraft && turn.output.continuesDraft === true))
      ? { ...turn.output, message: detachedPlanningClarification(locale), proposals: [] }
      : turn.output;
    const prepareProposals = (output: PlannerOutput) => {
      if (isSearchOnlyFollowup(originalPrompt) && output.proposals.length > 0) {
        throw new AppConflictError("A search-only follow-up cannot create or change trip items. Ask explicitly for any change after reviewing the research.");
      }
      if (resumedDraft && output.proposals.some((proposal) => proposal.action !== "create")) {
        throw new AppConflictError("A clarification may complete only the open create request, not change an existing item.");
      }
      if (isDraftCancellation(originalPrompt) && output.proposals.length > 0) {
        throw new AppConflictError("Abandoning an unfinished create request cannot change itinerary or expense records.");
      }
      const eligibleMembers = new Set(contextRecord.audienceDirectory?.map((member) => member.id) ?? []);
      const assertEligibleMembers = (memberIds: readonly string[]) => {
        if (memberIds.some((id) => !eligibleMembers.has(id))) {
          throw new AppConflictError("The AI selected an unavailable participant; ask it to clarify the member name.");
        }
      };
      const timeZone = contextRecord.trip?.timeZone;
      const relativeDate = unambiguousRequestedRelativeDate(prompt, contextRecord.currentTime ?? {})
        ?? previousDraftRelativeDate(resumedDraft ? planningDraft : null, prompt);
      const existingTargets = new Set<string>();
      for (let index = 0; index < output.proposals.length; index += 1) {
        const proposal = output.proposals[index]!;
        assertProposalReferences(proposal, index);
        if (proposal.action !== "create") {
          if (existingTargets.has(proposal.entityId!)) {
            throw new AppConflictError(`AI proposal ${index + 1} repeats an existing item target.`);
          }
          existingTargets.add(proposal.entityId!);
        }
      }
      if (output.proposals.length > 1
          && output.proposals.some((proposal) => proposal.action !== "create")) {
        throw new AppConflictError("A multi-proposal AI response may contain only new events or expenses.");
      }

      // Parse and validate the complete batch before writing its first request. This
      // prevents a malformed later proposal from leaving an earlier AI create behind.
      const preparedProposals = output.proposals.map((proposal, index): {
        proposal: PlannerProposal;
        patch: ItineraryPatch | ExpensePatch;
      } => {
        if (proposal.entityType === "expense") {
          let expensePatch: ExpensePatch;
          try {
            expensePatch = aiExpensePatchSchema.parse(normalizePlannerPatch(JSON.parse(proposal.patchJson)));
          } catch (error) {
            if (error instanceof ZodError) {
              throw new IndexedPatchValidationError(index, proposal.entityType, error);
            }
            throw error;
          }
          if (proposal.action !== "create") {
            throw new AppConflictError(`AI proposal ${index + 1} may only create a new expense.`);
          }
          if (!expensePatch.description
              || !expensePatch.amountMinor
              || !expensePatch.currency
              || !expensePatch.payerMemberId
              || !expensePatch.occurredAt
              || !expensePatch.splitMemberIds?.length) {
            throw new AppConflictError(
              `AI proposal ${index + 1} is missing a description, amount, currency, payer, date, or split member.`,
            );
          }
          if (expensePatch.status === "void") {
            throw new AppConflictError(`AI proposal ${index + 1} cannot create a void expense.`);
          }
          try { expenseSplitsForPatch(expensePatch); }
          catch { throw new AppConflictError(`AI proposal ${index + 1} has invalid expense shares.`); }
          assertEligibleMembers([expensePatch.payerMemberId, ...expensePatch.splitMemberIds]);
          if (expensePatch.itineraryItemId
              && !contextRecord.itinerary?.some((item) => item.id === expensePatch.itineraryItemId)) {
            throw new AppConflictError(`AI proposal ${index + 1} references an unavailable event.`);
          }
          const proposedDate = timeZone
            ? instantDateInTimeZone(expensePatch.occurredAt, timeZone)
            : null;
          if (relativeDate && proposedDate !== relativeDate) {
            throw new AppConflictError(
              `The AI resolved the relative date incorrectly. The requested date is ${relativeDate} in ${timeZone ?? "the trip time zone"}; no change was applied.`,
            );
          }
          if (proposedDate && !contextRecord.days?.some((day) => day.date === proposedDate)) {
            throw new AppConflictError(
              `${proposedDate} is outside this trip; no change was applied.`,
            );
          }
          return { proposal, patch: expensePatch };
        }

        let patchValue: ItineraryPatch;
        try {
          patchValue = (proposal.action === "update_pending" ? aiPendingItineraryPatchSchema : aiItineraryPatchSchema).parse(
            normalizePlannerPatch(JSON.parse(proposal.patchJson)),
          );
        } catch (error) {
          if (error instanceof ZodError) {
            throw new IndexedPatchValidationError(index, proposal.entityType, error);
          }
          throw error;
        }
        if (proposal.action === "create" && (!patchValue.tripDayId || !patchValue.title)) {
          throw new AppConflictError(`AI proposal ${index + 1} is missing a day or title.`);
        }
        if (patchValue.linkedExpense && proposal.action !== "create") {
          throw new AppConflictError("AI may attach a new expense only to a new event requiring owner approval.");
        }
        assertEligibleMembers(patchValue.viewerMemberIds ?? []);
        if (patchValue.linkedExpense) {
          try { expenseSplitsForPatch(patchValue.linkedExpense); }
          catch { throw new AppConflictError(`AI proposal ${index + 1} has invalid linked expense shares.`); }
          const memberIds = [patchValue.linkedExpense.payerMemberId, ...patchValue.linkedExpense.splitMemberIds];
          assertEligibleMembers(memberIds);
          if (patchValue.visibility === "private") {
            const audience = new Set([session.memberId, ...(patchValue.viewerMemberIds ?? [])]);
            if (memberIds.some((id) => !audience.has(id))) {
              throw new AppConflictError("A private event's linked expense must stay inside its selected audience.");
            }
          }
          const assumption = assessReservationExpense(
            evidencePrompt,
            session.memberId,
            (contextRecord.audienceDirectory ?? []).map((member) => ({ ...member, status: member.status ?? "active" })),
            {
              ...patchValue.linkedExpense,
              viewerMemberIds: patchValue.visibility === "private" ? patchValue.viewerMemberIds : [],
            },
            { requirePayerEvidence: false },
          );
          if (assumption && (assumption === "member_unavailable" || assumption === "member_name_ambiguous"
              || patchValue.visibility === "private")) {
            throw new ReservationClarificationNeeded(assumption);
          }
        }
        if (proposal.action === "create"
            && (patchValue.visibility === undefined || patchValue.viewerMemberIds === undefined)) {
          throw new AppConflictError(
            `AI proposal ${index + 1} must explicitly identify a private or trip audience.`,
          );
        }
        if (patchValue.visibility === "trip" && (patchValue.viewerMemberIds?.length ?? 0) > 0) {
          throw new AppConflictError(`AI proposal ${index + 1} cannot add private viewers to a trip-visible event.`);
        }
        const pendingTarget = proposal.action === "update_pending"
          ? pendingContext.pendingItinerary.find((item) => item.requestId === proposal.entityId)
          : undefined;
        if (proposal.action === "update_pending"
            && (!pendingTarget || pendingTarget.proposalRevision !== proposal.baseRevision)) {
          throw new AppConflictError("The pending event is unavailable or has changed. Reload and try again.");
        }
        if (proposal.action !== "create" && proposal.action !== "update_pending"
            && pendingContext.pendingItinerary.some((item) => item.targetItemId === proposal.entityId || item.requestId === proposal.entityId)) {
          throw new AppConflictError("This event already has a pending change. Edit that pending proposal instead.");
        }
        if (proposal.action !== "create" && proposal.action !== "update_pending"
            && !contextRecord.itinerary?.some((item) => item.id === proposal.entityId)) {
          throw new AppConflictError("The AI selected an unavailable event. Reload and try again.");
        }
        const existingItem = pendingTarget?.patch ?? (proposal.entityId
          ? contextRecord.itinerary?.find((item) => item.id === proposal.entityId)
          : undefined);
        const effectiveItemType = patchValue.itemType ?? existingItem?.itemType;
        if (effectiveItemType === "transport") {
          if (patchValue.locationName !== undefined || patchValue.mapUrl !== undefined) {
            patchValue = {
              ...patchValue,
              destinationLocationName: patchValue.destinationLocationName !== undefined
                ? patchValue.destinationLocationName
                : patchValue.locationName,
              destinationMapUrl: patchValue.destinationMapUrl !== undefined
                ? patchValue.destinationMapUrl
                : patchValue.mapUrl,
            };
            delete patchValue.locationName;
            delete patchValue.mapUrl;
          }
          const departureLocationName = patchValue.departureLocationName !== undefined
            ? patchValue.departureLocationName
            : existingItem?.departureLocationName;
          const destinationLocationName = patchValue.destinationLocationName !== undefined
            ? patchValue.destinationLocationName
            : existingItem?.destinationLocationName
              ?? (existingItem?.itemType !== "transport" ? existingItem?.locationName : undefined);
          if (!hasLocationName(departureLocationName) && !hasLocationName(destinationLocationName)) {
            throw new AppConflictError(
              `AI proposal ${index + 1} must include at least one transport endpoint.`,
            );
          }
          if (patchValue.departureMapUrl !== undefined && !hasLocationName(departureLocationName)) {
            throw new AppConflictError(
              `AI proposal ${index + 1} cannot add a departure map without a departure location.`,
            );
          }
          if (patchValue.destinationMapUrl !== undefined && !hasLocationName(destinationLocationName)) {
            throw new AppConflictError(
              `AI proposal ${index + 1} cannot add a destination map without a destination location.`,
            );
          }
          if (patchValue.departureLocationName !== undefined || patchValue.departureMapUrl !== undefined) {
            patchValue = {
              ...patchValue,
              departureMapUrl: hasLocationName(departureLocationName)
                ? safeAiMapUrl(patchValue.departureMapUrl, departureLocationName)
                : null,
            };
          }
          if (patchValue.destinationLocationName !== undefined || patchValue.destinationMapUrl !== undefined) {
            patchValue = {
              ...patchValue,
              destinationMapUrl: hasLocationName(destinationLocationName)
                ? safeAiMapUrl(patchValue.destinationMapUrl, destinationLocationName)
                : null,
            };
          }
        } else {
          const transportFields = [
            patchValue.departureLocationName,
            patchValue.departureMapUrl,
            patchValue.destinationLocationName,
            patchValue.destinationMapUrl,
          ];
          if (transportFields.some((value) => value !== undefined && value !== null)) {
            throw new AppConflictError(
              `AI proposal ${index + 1} cannot add transport endpoints to a non-transport event.`,
            );
          }
        }
        if (effectiveItemType !== "transport"
            && (patchValue.mapUrl !== undefined || patchValue.locationName)) {
          patchValue = {
            ...patchValue,
            mapUrl: safeAiMapUrl(patchValue.mapUrl, patchValue.locationName),
          };
        }
        const selectedDay = contextRecord.days?.find((day) => day.id === (patchValue.tripDayId ?? pendingTarget?.patch.tripDayId));
        if (patchValue.tripDayId && !contextRecord.days?.some((day) => day.id === patchValue.tripDayId)) {
          throw new AppConflictError(`AI proposal ${index + 1} references a day outside this trip.`);
        }
        const effectiveStartsAt = patchValue.startsAt !== undefined ? patchValue.startsAt : pendingTarget?.patch.startsAt;
        const proposedDate = effectiveStartsAt && timeZone
          ? instantDateInTimeZone(effectiveStartsAt, timeZone)
          : selectedDay?.date;
        if (relativeDate && proposedDate !== relativeDate) {
          throw new AppConflictError(
            `The AI resolved the relative date incorrectly. The requested date is ${relativeDate} in ${timeZone ?? "the trip time zone"}; no change was applied.`,
          );
        }
        if (patchValue.startsAt && timeZone) {
          const matchingDay = contextRecord.days?.find((day) => day.date === proposedDate);
          if (!matchingDay) {
            throw new AppConflictError(
              `${proposedDate ?? "The proposed date"} is outside this trip; no change was applied.`,
            );
          }
          patchValue = { ...patchValue, tripDayId: matchingDay.id };
        }
        const effectiveEndsAt = patchValue.endsAt !== undefined ? patchValue.endsAt : pendingTarget?.patch.endsAt;
        if (effectiveStartsAt && effectiveEndsAt
            && new Date(effectiveEndsAt).getTime() <= new Date(effectiveStartsAt).getTime()) {
          throw new AppConflictError(`AI proposal ${index + 1} must end after it starts.`);
        }
        return { proposal, patch: patchValue };
      });
      const createSignatures = new Set<string>();
      const expenseSignatures = new Set<string>();
      for (let index = 0; index < preparedProposals.length; index += 1) {
        const prepared = preparedProposals[index]!;
        if (prepared.proposal.action !== "create") continue;
        const newExpense = prepared.proposal.entityType === "expense"
          ? prepared.patch as ExpensePatch
          : (prepared.patch as ItineraryPatch).linkedExpense;
        if (newExpense) {
          const signature = JSON.stringify([
            newExpense.description?.trim().toLocaleLowerCase(), newExpense.amountMinor, newExpense.currency,
            newExpense.payerMemberId, newExpense.occurredAt,
            expenseSplitsForPatch(newExpense)!.sort((a, b) => a.participantId.localeCompare(b.participantId)),
          ]);
          if (expenseSignatures.has(signature)) {
            throw new AppConflictError("The AI repeated the same expense in this batch; no change was applied.");
          }
          expenseSignatures.add(signature);
        }
        const signature = prepared.proposal.entityType === "expense"
          ? (() => {
              const patch = prepared.patch as ExpensePatch;
              return JSON.stringify([
                "expense",
                patch.description?.trim().toLocaleLowerCase() ?? null,
                patch.amountMinor ?? null,
                patch.currency ?? null,
                patch.payerMemberId ?? null,
                patch.occurredAt ?? null,
                patch.itineraryItemId ?? null,
                expenseSplitsForPatch(patch)!.sort((a, b) => a.participantId.localeCompare(b.participantId)),
              ]);
            })()
          : (() => {
              const patch = prepared.patch as ItineraryPatch;
              return JSON.stringify([
                "itinerary_item",
                patch.tripDayId ?? null,
                patch.title?.trim().toLocaleLowerCase() ?? null,
                patch.startsAt ?? null,
                patch.locationName?.trim().toLocaleLowerCase()
                  ?? patch.departureLocationName?.trim().toLocaleLowerCase()
                  ?? null,
                patch.destinationLocationName?.trim().toLocaleLowerCase() ?? null,
              ]);
            })();
        if (createSignatures.has(signature)) {
          throw new AppConflictError(`AI proposal ${index + 1} duplicates another new item in this batch.`);
        }
        createSignatures.add(signature);
      }
      return preparedProposals;
    };

    const prepareCurrentOutput = async (): Promise<ReturnType<typeof prepareProposals>> => {
      try {
        return prepareProposals(output);
      } catch (error) {
        if (!(error instanceof ReservationClarificationNeeded)) throw error;
        output = {
          ...output, message: reservationExpenseClarification(error.reason, locale),
          proposals: [],
        };
        await pool.query(
          `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
           VALUES ($1,$2,$3,'proposal.clarification.required',$4::jsonb)`,
          [session.tripId, requestId, nextEventSequence++, JSON.stringify({ reason: error.reason, proposalCount: 0 })],
        );
        return [];
      }
    };
    let preparedProposals: ReturnType<typeof prepareProposals>;
    try {
      preparedProposals = await prepareCurrentOutput();
    } catch (error) {
      const feedback = error instanceof IndexedPatchValidationError
        ? timestampRepairFeedback(error.proposalIndex, error.issues, output.proposals)
        : null;
      if (!feedback
          || containsKnownReservationSecret(JSON.stringify(feedback.previousProposals), reservationSecrets)
          || started + workBudget - Date.now() < MIN_REPAIR_BUDGET_MS) throw error;
      await pool.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'proposal.repair.started',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence++, JSON.stringify({
          attempt: 2, reason: "timestamp_format", validation: validationFailureSummary(error),
        })],
      );
      const originalTurn = turn;
      const repairedTurn = await runTurn(feedback);
      if (!timestampRepairPreservesProposalIntent(feedback, repairedTurn.output.proposals)) {
        throw new AppConflictError("AI timestamp correction changed unrelated proposal fields; no change was applied.");
      }
      output = {
        ...repairedTurn.output,
        memoryCheckpoint: originalTurn.output.memoryCheckpoint,
      };
      // Search evidence belongs to the original research turn, never a repair.
      turn = { ...repairedTurn, sourceUrls: originalTurn.sourceUrls, webSearchQueries: originalTurn.webSearchQueries };
      preparedProposals = await prepareCurrentOutput();
      await pool.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'proposal.repair.completed',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence++, JSON.stringify({
          attempt: 2, outcome: output.proposals.length ? "validated" : "clarification", proposalCount: output.proposals.length,
        })],
      );
    }

    const financialReview: Array<{ proposalIndex: number; reason: ReservationExpenseAssumptionReason }> = [];
    for (const [proposalIndex, prepared] of preparedProposals.entries()) {
      const expense = prepared.proposal.entityType === "expense"
        ? prepared.patch as ExpensePatch : (prepared.patch as ItineraryPatch).linkedExpense;
      if (!expense) continue;
      const reason = assessReservationExpense(evidencePrompt, session.memberId,
        contextRecord.audienceDirectory ?? [], expense,
        { exactPayerAnswer: resumedDraft?.expectsPayerAnswer ? prompt : undefined });
      const latestPayer = resumedDraft && (hasPayerClarification(prompt) || resumedDraft.expectsPayerAnswer)
        ? assessReservationExpense(prompt, session.memberId, contextRecord.audienceDirectory ?? [],
            { payerMemberId: expense.payerMemberId, splitMemberIds: [session.memberId] },
            { exactPayerAnswer: resumedDraft.expectsPayerAnswer ? prompt : undefined }) : null;
      if (reason || latestPayer) {
        financialReview.push({ proposalIndex, reason: reason ?? latestPayer! });
        const notice = reservationExpenseReviewNotice(locale);
        prepared.proposal.reason = `${notice}\n${prepared.proposal.reason}`.slice(0, MAX_PROPOSAL_REASON_CHARACTERS);
      }
    }
    if (financialReview.length) {
      output.message = `${reservationExpenseReviewNotice(locale)}\n\n${output.message}`.slice(0, MAX_PROVIDER_MESSAGE_CHARACTERS);
      await pool.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'proposal.review.suggested',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence++, JSON.stringify({ items: financialReview })],
      );
    }

    // A separate public-only research turn cannot see the user's prompt, memory,
    // private itinerary, booking, notes, financial data, or database identities.
    // Research is advisory: missing evidence must not discard a valid proposal.
    const hoursCandidates = venueHoursCandidates(preparedProposals, {
      timeZone: contextRecord.trip?.timeZone ?? "UTC", days: contextRecord.days ?? [],
      itinerary: contextRecord.itinerary ?? [], pendingItinerary: pendingContext.pendingItinerary,
    });
    if (hoursCandidates.length) {
      const hoursPrivacyBlocked = reservationSecrets.detected || blocksLivePlaceSearchForPrivacy(evidencePrompt)
        || automaticPrivacyBlocked;
      const remaining = started + workBudget - Date.now();
      const memberNames = (contextRecord.audienceDirectory ?? []).map((member) => member.displayName);
      const reused = new Map<string, { evidence: ReusableVenueHours["hoursEvidence"][number] | undefined }>();
      if (liveSearchIntent !== "disabled" && !hoursPrivacyBlocked) {
        for (const candidate of hoursCandidates) {
          if (!safeVenueHoursTarget(candidate, memberNames)) continue;
          const matches = reusableHours.attemptedHoursTargets.filter((target) => target.venueName === candidate.venueName
            && target.date === candidate.date && target.timeZone === candidate.timeZone);
          if (matches.length !== 1) continue;
          const target = matches[0]!;
          const evidence = reusableHours.hoursEvidence.filter((row) => row.key === target.key
            && row.venueName === target.venueName && row.date === target.date && row.timeZone === target.timeZone);
          if (evidence.length > 1) continue;
          reused.set(candidate.key, { evidence: evidence[0] ? { ...evidence[0], key: candidate.key } : undefined });
        }
      }
      const fallbackCandidates = hoursCandidates.filter((candidate) => !reused.has(candidate.key));
      const targets = liveSearchIntent === "disabled" || hoursPrivacyBlocked || remaining < VENUE_HOURS_MIN_BUDGET_MS
        ? [] : fallbackCandidates.filter((candidate) => safeVenueHoursTarget(candidate, memberNames))
          .slice(0, VENUE_HOURS_MAX_TARGETS).map((candidate) => ({
            key: candidate.key, venueName: candidate.venueName, date: candidate.date!, timeZone: candidate.timeZone,
          }));
      let hoursEvidence: unknown = [];
      let hoursSearchPerformed = false;
      let hoursOutcome = targets.length ? "unverified" : liveSearchIntent === "disabled" ? "user_disabled"
        : hoursPrivacyBlocked ? "privacy_blocked" : !fallbackCandidates.length ? "reused"
          : remaining < VENUE_HOURS_MIN_BUDGET_MS ? "budget_exhausted" : "not_public_or_timed";
      if (reused.size) {
        await pool.query(
          `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
           VALUES ($1,$2,$3,'venue.hours.reused',$4::jsonb)`,
          [session.tripId, requestId, nextEventSequence++, JSON.stringify({ sourcePhase: "public.research",
            count: reused.size, proposalIndexes: hoursCandidates.filter((candidate) => reused.has(candidate.key)).map((candidate) => candidate.proposalIndex) })],
        );
      }
      if (targets.length) {
        await pool.query(
          `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
           VALUES ($1,$2,$3,'venue.hours.research.started',$4::jsonb)`,
          [session.tripId, requestId, nextEventSequence++, JSON.stringify({
            model: policy.model, targetCount: targets.length, maximumMilliseconds: Math.min(VENUE_HOURS_BUDGET_MS, remaining),
          })],
        );
        let workDirectory: string | null = null;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let invoked = false;
        let returned = false;
        let insufficientLaunchBudget = false;
        const abortController = new AbortController();
        let receipt: Record<string, unknown> = {};
        try {
          workDirectory = await mkdtemp(join(tmpdir(), "stardust-hours-"));
          if (started + workBudget - Date.now() < VENUE_HOURS_MIN_BUDGET_MS) {
            insufficientLaunchBudget = true;
            throw new Error("Hours setup exhausted the lookup start budget");
          }
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => { abortController.abort(); reject(new Error("Hours research timed out")); },
              Math.max(1, Math.min(VENUE_HOURS_BUDGET_MS, started + workBudget - Date.now())));
            timeout.unref();
          });
          invoked = true;
          providerAttempts += 1;
          const result = await Promise.race([runVenueHoursResearch({ model: policy.model, targets, workDirectory,
            abortController, nowUtc: new Date().toISOString() }), timeoutPromise]);
          returned = true;
          const add = (before: number | null, extra: number | null) => before === null || extra === null ? null : before + extra;
          recordedUsage = { input: add(recordedUsage.input, result.inputTokens),
            output: add(recordedUsage.output, result.outputTokens), cached: add(recordedUsage.cached, result.cachedInputTokens) };
          receipt = { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens,
            ...(result.cleanupFailed ? { cleanupFailed: true } : {}) };
          hoursEvidence = result.assessments;
          hoursSearchPerformed = result.webSearchQueries.length > 0;
          hoursOutcome = hoursSearchPerformed ? "researched" : "missing_search";
          const queries = result.webSearchQueries.map((query) => redactReservationSecrets(query, reservationSecrets));
          receipt = { ...receipt, queryCount: queries.length, queries,
            sourceUrls: result.sourceUrls.filter((url) => !containsKnownReservationSecret(url, reservationSecrets)) };
          turn = { ...turn, webSearchQueries: uniqueSearchQueries([...turn.webSearchQueries, ...queries]) };
        } catch (error) {
          if (invoked && !returned) recordedUsage = { input: null, output: null, cached: null };
          const providerFailure = aiProviderFailureDetails(error);
          if (providerFailure) receipt.providerFailure = providerFailure;
          hoursEvidence = [];
          hoursSearchPerformed = false;
          hoursOutcome = insufficientLaunchBudget ? "budget_exhausted" : abortController.signal.aborted ? "timeout" : "failed";
        } finally {
          if (timeout) clearTimeout(timeout);
          abortController.abort();
          if (workDirectory) {
            try {
              // Exact mkdtemp-created directory only; never a workspace or caller-controlled path.
              await rm(workDirectory, { recursive: true, force: true,
                maxRetries: WORKSPACE_CLEANUP_MAX_RETRIES, retryDelay: WORKSPACE_CLEANUP_RETRY_DELAY_MS });
            } catch {
              receipt.cleanupFailed = true;
              // A failed local cleanup is not a failed public-hours check.
            }
          }
        }
        await pool.query(
          `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
           VALUES ($1,$2,$3,'venue.hours.research.completed',$4::jsonb)`,
          [session.tripId, requestId, nextEventSequence++, JSON.stringify({ outcome: hoursOutcome, targetCount: targets.length, ...receipt })],
        );
      }
      const researchedKeys = new Set(targets.map((target) => target.key));
      const unverifiedReasons = new Map<string, VenueHoursUnverifiedReason>();
      for (const candidate of fallbackCandidates) {
        const reason: VenueHoursUnverifiedReason = liveSearchIntent === "disabled" ? "user_disabled"
          : hoursPrivacyBlocked || !candidate.public ? "privacy_blocked"
            : !safeVenueHoursTarget(candidate, memberNames) ? "not_public_or_timed"
              : remaining < VENUE_HOURS_MIN_BUDGET_MS || hoursOutcome === "budget_exhausted" ? "budget_exhausted"
                : !researchedKeys.has(candidate.key) ? "target_limit"
                  : hoursOutcome === "timeout" ? "timeout" : hoursOutcome === "failed" ? "failed"
                    : hoursOutcome === "missing_search" ? "missing_search" : "insufficient_evidence";
        unverifiedReasons.set(candidate.key, reason);
      }
      const assessments = [
        ...assessVenueHours(fallbackCandidates, hoursEvidence, hoursSearchPerformed, researchedKeys, { unverifiedReasons }),
        ...hoursCandidates.filter((candidate) => reused.has(candidate.key)).flatMap((candidate) => {
          const evidence = reused.get(candidate.key)!.evidence;
          return assessVenueHours([candidate], evidence ? [evidence] : [], true, new Set([candidate.key]),
            { unverifiedReason: "insufficient_evidence" });
        }),
      ].sort((left, right) => left.proposalIndex - right.proposalIndex);
      for (const assessment of assessments) {
        const prepared = preparedProposals[assessment.proposalIndex]!;
        prepared.proposal.reason = `${venueHoursNotice(assessment, locale)}\n${prepared.proposal.reason}`.slice(0, MAX_PROPOSAL_REASON_CHARACTERS);
      }
      output.message = `${assessments.map((assessment) => venueHoursNotice(assessment, locale)).join("\n\n")}\n\n${output.message}`
        .slice(0, MAX_PROVIDER_MESSAGE_CHARACTERS);
      turn = { ...turn, sourceUrls: uniqueSourceUrls([...assessments.flatMap((assessment) => assessment.sources), ...turn.sourceUrls]) };
      await pool.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'venue.hours.checked',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence++, JSON.stringify({ outcome: hoursOutcome, items: assessments.map((assessment) => ({
          proposalIndex: assessment.proposalIndex, status: assessment.status, sourceUrls: assessment.sources,
          ...(assessment.status === "unverified" ? { unverifiedReason: assessment.unverifiedReason } : {}),
          evidenceOrigin: reused.has(assessment.key) ? "public.research" : researchedKeys.has(assessment.key) ? "venue.hours.research" : "none",
        })) })],
      );
    }

    const proposalOutcomes: Array<{
      proposalId: string;
      changeStatus: "approved" | "pending";
      entityId: string | null;
    }> = [];
    const pendingEdit = preparedProposals.find((prepared) => prepared.proposal.action === "update_pending");
    const changeInputs = preparedProposals.filter((prepared) => prepared.proposal.action !== "update_pending")
      .map((prepared): ChangeRequestInput => ({
        entityType: prepared.proposal.entityType,
        entityId: prepared.proposal.entityId,
        operation: prepared.proposal.action as ChangeRequestInput["operation"],
        baseRevision: prepared.proposal.baseRevision,
        patch: prepared.patch,
        reason: prepared.proposal.reason,
        source: "ai",
      }));
    const responseFor = (outcomes: typeof proposalOutcomes): AiPlannerResult => ({
      requestId,
      message: output.message,
      proposalIds: outcomes.map((proposal) => proposal.proposalId),
      proposalCount: outcomes.length,
      proposalId: outcomes[0]?.proposalId ?? null,
      changeStatus: outcomes[0]?.changeStatus ?? null,
      entityId: outcomes[0]?.entityId ?? null,
      model: policy.model,
      usedToday: policy.usedToday + 1,
      remainingToday: policy.limit === null ? null : Math.max(0, policy.limit - policy.usedToday - 1),
      webSearch: { performed: turn.webSearchQueries.length > 0, queryCount: turn.webSearchQueries.length, sources: turn.sourceUrls },
      memory: {
        previousTurnsUsed: conversationMemory.turns.length,
        tokenEstimate: conversationMemory.tokenEstimate,
        tokenBudget: RECENT_CONVERSATION_TOKEN_BUDGET,
        checkpointVersion: conversationMemory.checkpoint?.version ?? null,
        truncated: conversationMemory.truncated,
      },
    });
    const recordSuccessfulRequest = async (
      client: Pick<PoolClient, "query">,
      outcomes: typeof proposalOutcomes,
    ): Promise<void> => {
      const firstOutcome = outcomes[0] ?? null;
      const proposalIds = outcomes.map((proposal) => proposal.proposalId);
      const latencyMs = Date.now() - started;
      await client.query(
        `UPDATE ai_requests
            SET result_text = $3, effective_model = $4, status = 'succeeded',
                proposal_id = $5, input_tokens = $6, output_tokens = $7,
                cached_input_tokens = $8, latency_ms = $9, completed_at = CURRENT_TIMESTAMP
                ${clientRequestId ? ", response_json = $10::jsonb" : ""}
          WHERE trip_id = $1 AND id = $2 AND status = 'started'`,
        [session.tripId, requestId, output.message, turn.effectiveModel,
          firstOutcome?.proposalId ?? null, recordedUsage?.input ?? null, recordedUsage?.output ?? null,
          recordedUsage?.cached ?? null, latencyMs,
          ...(clientRequestId ? [JSON.stringify(responseFor(outcomes))] : [])],
      );
      await recordPlanningDraft(client, session, {
        conversationId: conversationMemory.conversationId,
        requestId, prompt: originalPrompt, proposalCount: outcomes.length, previous: planningDraft,
        mode: draftMode, sequence: nextEventSequence++,
      });
      const checkpointCreated = output.memoryCheckpoint
        ? await createConversationCheckpoint(client, session, {
            conversationId: conversationMemory.conversationId,
            through: conversationMemory.checkpointThrough,
            ...output.memoryCheckpoint,
          })
        : null;
      await client.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'conversation.memory.receipt',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence, JSON.stringify({
          checkpointUsedId: conversationMemory.checkpoint?.id ?? null,
          checkpointUsedVersion: conversationMemory.checkpoint?.version ?? null,
          checkpointCreatedId: checkpointCreated?.id ?? null,
          checkpointCreatedVersion: checkpointCreated?.version ?? null,
          recentRequestIds: conversationMemory.turns.map((item) => item.requestId).filter(Boolean),
          recentTokenEstimate: conversationMemory.tokenEstimate,
        })],
      );
      nextEventSequence += 1;
      await client.query(
        `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
         VALUES ($1,$2,$3,'request.completed',$4::jsonb)`,
        [session.tripId, requestId, nextEventSequence, JSON.stringify({
          proposalId: firstOutcome?.proposalId ?? null,
          proposalIds,
          proposalCount: proposalIds.length,
          changeStatus: firstOutcome?.changeStatus ?? null,
          entityId: firstOutcome?.entityId ?? null,
          status: "succeeded",
        })],
      );
    };

    await inTransaction(pool, async (client) => {
      await assertAiRequestWritable(client, session, requestId, conversationMemory.conversationId);
      if (pendingEdit) {
        const updated = await updatePendingItineraryRequestWithClient(
          client, session, session.tripId, pendingEdit.proposal.entityId!, {
            proposalRevision: pendingEdit.proposal.baseRevision!,
            patch: pendingEdit.patch as ItineraryPatch,
            reason: pendingEdit.proposal.reason,
          }, { aiRequestId: requestId },
        );
        // Editing is never approval, including an owner edit of their own draft.
        proposalOutcomes.push({ proposalId: updated.requestId, changeStatus: "pending", entityId: updated.targetItemId });
      } else if (changeInputs.length > 0 && changeInputs.every((input) => input.operation === "create")) {
        if (resumedDraft && planningDraft) {
          await assertPlanningDraftCurrent(client, session, conversationMemory.conversationId, planningDraft);
        }
        const proposals = await createAiCreateRequestsWithClient(
          client,
          session,
          session.tripId,
          changeInputs,
        );
        proposalOutcomes.push(...proposals.map((proposal) => ({
          proposalId: proposal.id,
          changeStatus: "pending" as const,
          entityId: null,
        })));
      } else if (changeInputs[0]) {
        // Context is intentionally bounded. Recheck ALL pending updates under the
        // trip lock so an omitted/just-created draft cannot be bypassed by an
        // ordinary canonical update (especially the owner's fast path).
        if (changeInputs[0].entityType === "itinerary_item" && changeInputs[0].entityId) {
          const pending = await client.query<{ has_pending_change: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM change_requests cr
                WHERE cr.trip_id = $1 AND cr.entity_type = 'itinerary_item'
                  AND cr.entity_id = $2 AND cr.operation = 'update'
                  AND cr.status = 'pending' AND to_jsonb(cr)->>'invalidated_at' IS NULL
             ) AS has_pending_change`,
            [session.tripId, changeInputs[0].entityId],
          );
          if (pending.rows[0]?.has_pending_change) {
            throw new AppConflictError("This event has a pending change. Review or edit that proposal first.");
          }
        }
        const proposal = await createChangeRequestWithClient(client, session, session.tripId, changeInputs[0], randomUUID());
        let changeStatus: "approved" | "pending" = "pending";
        let entityId: string | null = null;
        if (images.length === 0 && session.role === "owner" && changeInputs[0].operation !== "create") {
          const applied = await reviewChangeRequestWithClient(
            client, session, session.tripId, proposal.id, "approve", "Applied directly by owner",
          );
          if (applied.status !== "approved" || !applied.entityId || !applied.revision) {
            throw new AppConflictError("The change could not be applied.");
          }
          changeStatus = applied.status;
          entityId = applied.entityId;
        }
        proposalOutcomes.push({ proposalId: proposal.id, changeStatus, entityId });
      }
      await recordSuccessfulRequest(client, proposalOutcomes);
    });

    return responseFor(proposalOutcomes);
  } catch (error) {
    const latencyMs = Date.now() - started;
    const providerFailure = aiProviderFailureDetails(error);
    const errorName = error && typeof error === "object" && "name" in error
      ? (error as { name?: unknown }).name
      : null;
    const errorCode = typeof errorName === "string" ? errorName.slice(0, 120) : "AI_ERROR";
    const validation = validationFailureSummary(error);
    await pool.query(
      `UPDATE ai_requests
          SET status = 'failed', error_code = $3, error_message = 'AI planning request failed.',
              latency_ms = $4, completed_at = CURRENT_TIMESTAMP,
              effective_model = $5, input_tokens = $6, output_tokens = $7, cached_input_tokens = $8
        WHERE trip_id = $1 AND id = $2 AND status = 'started'`,
      [session.tripId, requestId, errorCode, latencyMs, recordedEffectiveModel,
        recordedUsage?.input ?? null, recordedUsage?.output ?? null, recordedUsage?.cached ?? null],
    );
    await pool.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
       VALUES ($1,$2,$3,'request.failed',$4::jsonb)`,
      [session.tripId, requestId, nextEventSequence, JSON.stringify({
        errorCode,
        ...(providerFailure ? { providerFailure } : {}),
        ...(validation ? { validation } : {}),
      })],
    );
    throw error;
  }
}
