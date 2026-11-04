import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { disruptionMonitorInternals, runDueDisruptionMonitors } from "@/lib/disruptions/monitor";
import {
  DisruptionProviderCleanupError,
  DisruptionProviderInvocationError,
} from "@/lib/disruptions/provider";
import type { DisruptionAlert, DisruptionProvider } from "@/lib/disruptions/types";

const tripId = "10000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-03T00:00:00.000Z");

type FakeOptions = {
  currentRevision?: number;
  currentWarning?: boolean;
  currentFingerprint?: string;
  currentWarningVersion?: 0 | 1;
  candidateCount?: number;
};

function fakePool(options: FakeOptions = {}) {
  const qualifiedCurrent = options.currentWarning && (options.currentWarningVersion ?? 1) === 1;
  let dueClaimed = false;
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const release = vi.fn();
  const query = vi.fn(async (statement: unknown, parameters?: unknown[]) => {
    const sql = String(statement);
    const values = parameters ?? [];
    calls.push({ sql, values });
    if (sql.includes("FROM trip_disruption_settings settings")) {
      if (dueClaimed) return { rows: [] };
      dueClaimed = true;
      return { rows: [{
        trip_id: tripId,
        time_zone: "Asia/Tokyo",
        interval_minutes: 30,
        lookahead_hours: 168,
        scheduled_for: now,
      }] };
    }
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("FROM itinerary_items i") && sql.includes("i.title")) {
      return { rows: Array.from({ length: options.candidateCount ?? 1 }, (_, index) => ({
        trip_id: tripId,
        id: index === 0 ? itemId : `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        current_revision: 2,
        title: index === 0 ? "Dinner owner@example.com 999999999999" : `Event ${index + 1}`,
        item_type: "meal",
        starts_at: new Date(new Date("2026-09-04T10:00:00Z").getTime() + index * 60_000),
        ends_at: new Date(new Date("2026-09-04T12:00:00Z").getTime() + index * 60_000),
        location_name: "Tokyo Station",
        departure_location_name: null,
        destination_location_name: null,
        check_scope: "future_day",
        current_state: qualifiedCurrent && index === 0 ? "confirmed" : null,
        current_reason_code: qualifiedCurrent && index === 0 ? "closure" : null,
        current_severity: qualifiedCurrent && index === 0 ? "warning" : null,
        current_detail: qualifiedCurrent && index === 0 ? "Venue closed." : null,
        current_source_urls: qualifiedCurrent && index === 0
          ? ["https://venue.example.com/notice"] : null,
        current_evidence_fingerprint: qualifiedCurrent && index === 0
          ? (options.currentFingerprint ?? "a".repeat(64)) : null,
      })) };
    }
    if (sql.includes("SELECT id, current_revision, status, visibility")) {
      const ids = values[1] as string[];
      return { rows: ids.map((id) => ({
        id,
        current_revision: options.currentRevision ?? 2,
        status: "planned",
        visibility: "trip",
      })) };
    }
    if (sql.includes("FROM event_disruption_current")) {
      return { rows: options.currentWarning ? [{
        observation_id: "30000000-0000-4000-8000-000000000001",
        itinerary_item_id: itemId,
        item_revision: 2,
        state: "confirmed",
        reason_code: "closure",
        severity: "warning",
        detail: "Venue closed.",
        source_urls: ["https://venue.example.com/notice"],
        evidence_fingerprint: options.currentFingerprint ?? "a".repeat(64),
        first_seen_at: new Date("2026-09-02T00:00:00Z"),
        last_seen_at: new Date("2026-09-02T12:00:00Z"),
        qualification_policy_version: options.currentWarningVersion ?? 1,
      }] : [] };
    }
    if (sql.includes("FROM disruption_monitor_runs") && sql.includes("id <>")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  const client = { query, release };
  return {
    pool: { connect: vi.fn(async () => client) } as unknown as Pool,
    calls,
    release,
  };
}

function provider(result: Awaited<ReturnType<DisruptionProvider["check"]>>): DisruptionProvider {
  return { check: vi.fn(async () => result) };
}

const qualifiedAssessment: NonNullable<DisruptionAlert["impactAssessment"]> = {
  confidence: "high", sourceAuthority: "official", match: "exact_venue", effect: "unavailable",
  minimumDelayMinutes: null, affectedEntity: "Tokyo Station",
  evidenceSummary: "An official notice explicitly closes this exact venue during the event period.",
  ongoing: false,
};

function qualifiedAlert(overrides: Partial<DisruptionAlert> = {}): DisruptionAlert {
  return {
    eventKey: "E1", state: "confirmed", reasonCode: "closure", severity: "warning",
    detail: "Official venue notice says it will close during this event.",
    sourceUrls: ["https://venue.example.com/notices/closed"],
    affectedFrom: "2026-09-04T09:00:00Z", affectedUntil: "2026-09-04T15:00:00Z",
    validForMinutes: 30, impactAssessment: qualifiedAssessment, ...overrides,
  };
}

function checkedAlerts(alerts: DisruptionAlert[]): DisruptionProvider {
  return provider({
    rawOutput: JSON.stringify({ alerts }), effectiveModel: "gpt-6.1-sol",
    inputTokens: 10, outputTokens: 10, cachedInputTokens: 0,
    webSearchCount: 1, webSearchQueries: ["official venue status"],
  });
}

describe("due disruption monitor", () => {
  it("persists sourced warnings while keeping database identifiers out of the model prompt", async () => {
    const database = fakePool();
    const model = provider({
      rawOutput: JSON.stringify({ alerts: [{
        eventKey: "E1",
        state: "confirmed",
        reasonCode: "closure",
        severity: "warning",
        detail: "Official venue notice says it will close during this event.",
        localizedDetails: { en: "Official venue notice says it will close during this event.",
          "zh-HK": "場地官方公告指活動期間會關閉。", "ja-JP": "公式案内によるとイベント中は休業します。" },
        sourceUrls: ["https://venue.example.com/notices/closed"],
        affectedFrom: "2026-09-04T09:00:00Z",
        affectedUntil: "2026-09-04T15:00:00Z",
        validForMinutes: 15,
        impactAssessment: qualifiedAssessment,
      }] }),
      effectiveModel: "gpt-6.1-sol",
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
      webSearchCount: 1,
      webSearchQueries: ["Tokyo venue closure September 4"],
    });

    const result = await runDueDisruptionMonitors(database.pool, {
      provider: model,
      now,
      maxTrips: 1,
    });

    expect(result).toEqual({
      claimedTrips: 1,
      succeededTrips: 1,
      failedTrips: 0,
      skippedTrips: 0,
      observationsWritten: 1,
    });
    const providerPrompt = (model.check as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].prompt as string;
    expect(providerPrompt).toContain('"key":"E1"');
    expect(providerPrompt).not.toContain(tripId);
    expect(providerPrompt).not.toContain(itemId);
    expect(providerPrompt).not.toContain("owner@example.com");
    expect(providerPrompt).not.toContain("999999999999");
    const candidateRead = database.calls.find((call) => (
      call.sql.includes("FROM itinerary_items i") && call.sql.includes("i.title")
    ));
    expect(candidateRead?.sql).toContain("td.day_date::timestamp AT TIME ZONE trip.time_zone");
    expect(database.calls.some((call) => call.sql.includes("INSERT INTO event_disruption_observations"))).toBe(true);
    expect(database.calls.some((call) => call.sql.includes("INSERT INTO event_disruption_current"))).toBe(true);
    const observationWrite = database.calls.find((call) =>
      call.sql.includes("INSERT INTO event_disruption_observations"));
    const currentWrite = database.calls.find((call) =>
      call.sql.includes("INSERT INTO event_disruption_current"));
    const localizationWrite = database.calls.find((call) =>
      call.sql.includes("INSERT INTO event_disruption_localizations"));
    expect(localizationWrite?.values.slice(0, 3)).toEqual([tripId, observationWrite!.values[1], itemId]);
    expect(Object.keys(JSON.parse(String(localizationWrite?.values[3])))).toEqual(["en", "zh-HK", "ja-JP"]);
    expect(new Date(observationWrite!.values[14] as Date).getTime()
      - new Date(observationWrite!.values[13] as Date).getTime()).toBe(15 * 60_000);
    expect(new Date(currentWrite!.values[12] as Date).getTime()
      - new Date(currentWrite!.values[11] as Date).getTime()).toBe(1_450 * 60_000);
    expect(disruptionMonitorInternals.currentWarningFreshnessMinutes(15, 30)).toBe(40);
    expect(disruptionMonitorInternals.currentWarningFreshnessMinutes(360, 30)).toBe(360);
    expect(disruptionMonitorInternals.currentWarningFreshnessMinutes(360, 1_440)).toBe(1_450);
    expect(database.calls.find((call) => call.sql.includes("FROM itinerary_items i"))?.sql)
      .toMatch(/visibility = 'trip'[\s\S]+status = 'planned'/u);
    expect(candidateRead?.sql).toMatch(/effective_starts_at < day_window\.next_day_start[\s\S]+effective_ends_at >= day_window\.current_day_start/u);
    expect(candidateRead?.sql).toMatch(/check_state\.itinerary_item_id IS NULL THEN i\.created_at/u);
    expect(candidateRead?.sql).toMatch(/event_scope\.check_scope = 'current_day'[\s\S]+make_interval\(mins => \$4::integer\)/u);
    expect(candidateRead?.sql).toMatch(/ELSE check_state\.last_checked_at \+ interval '1 day'/u);
    expect(candidateRead?.sql).toMatch(/ORDER BY event_schedule\.due_at/u);
    expect(candidateRead?.sql).not.toMatch(/td\.day_date >=/u);
    expect(candidateRead?.sql).toContain("current.state = 'confirmed'");
    expect(candidateRead?.sql).toContain("current.severity IN ('warning', 'critical')");
    expect(candidateRead?.sql).toContain("qualified.id = current.observation_id");
    expect(candidateRead?.sql).toContain("qualified.itinerary_item_id = current.itinerary_item_id");
    expect(candidateRead?.sql).toContain("COALESCE(to_jsonb(qualified)->>'qualification_policy_version', '0') = '1'");
    expect(observationWrite?.values[15]).toBe(1);
    expect(database.calls.some((call) =>
      call.sql.includes("INSERT INTO event_disruption_check_state"))).toBe(true);
    const requestStarted = database.calls.find((call) =>
      call.sql.includes("'request.started'"));
    expect(JSON.parse(String(requestStarted?.values[2]))).toMatchObject({
      model: "gpt-6.1-sol",
      reasoningEffort: "medium",
    });
    const dueTripRead = database.calls.find((call) =>
      call.sql.includes("FROM trip_disruption_settings settings"));
    expect(dueTripRead?.sql).toMatch(/EXISTS[\s\S]+event_disruption_check_state/u);
    expect(dueTripRead?.sql).toMatch(/effective_starts_at < day_window\.next_day_start[\s\S]+effective_ends_at >= day_window\.current_day_start/u);
    expect(dueTripRead?.sql).toMatch(/event_scope\.check_scope = 'current_day'[\s\S]+settings\.interval_minutes/u);
    expect(dueTripRead?.sql).toMatch(/ELSE check_state\.last_checked_at \+ interval '1 day'/u);
    expect(dueTripRead?.sql).not.toMatch(/candidate_day\.day_date >=/u);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("does not clear current warnings when hosted-search evidence is missing", async () => {
    const database = fakePool({ currentWarning: true });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: provider({
        rawOutput: '{"alerts":[]}',
        effectiveModel: "gpt-6.1-sol",
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 0,
        webSearchCount: 0,
        webSearchQueries: [],
      }),
      now,
      maxTrips: 1,
    });

    expect(result.failedTrips).toBe(1);
    expect(database.calls.some((call) => call.sql.includes("INSERT INTO event_disruption_observations"))).toBe(false);
    expect(database.calls.some((call) => call.sql.includes("UPDATE event_disruption_current"))).toBe(false);
    expect(database.calls.some((call) => call.sql.includes("status = 'failed'"))).toBe(true);
    expect(database.calls.some((call) => /make_interval\(mins => \$4(?:::integer)?\)/u.test(call.sql)))
      .toBe(true);
  });

  it("keeps a current warning when a successful search merely omits it", async () => {
    const database = fakePool({ currentWarning: true });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: provider({
        rawOutput: '{"alerts":[]}',
        effectiveModel: "gpt-6.1-sol",
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 0,
        webSearchCount: 1,
        webSearchQueries: ["official venue status"],
      }),
      now,
      maxTrips: 1,
    });

    expect(result.succeededTrips).toBe(1);
    expect(result.observationsWritten).toBe(0);
    expect(database.calls.some((call) => call.sql.includes("INSERT INTO event_disruption_observations"))).toBe(false);
    expect(database.calls.some((call) => call.sql.includes("UPDATE event_disruption_current"))).toBe(false);
  });

  it("resolves a current warning only with an explicit sourced matching result", async () => {
    const database = fakePool({ currentWarning: true });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: provider({
        rawOutput: JSON.stringify({ alerts: [{
          eventKey: "E1",
          state: "resolved",
          reasonCode: "closure",
          severity: "info",
          detail: "The official venue notice confirms normal opening for the event period.",
          sourceUrls: ["https://venue.example.com/notices/reopened"],
          affectedFrom: null,
          affectedUntil: null,
          validForMinutes: 30,
        }] }),
        effectiveModel: "gpt-6.1-sol",
        inputTokens: 10,
        outputTokens: 12,
        cachedInputTokens: 0,
        webSearchCount: 1,
        webSearchQueries: ["official venue reopening status"],
      }),
      now,
      maxTrips: 1,
    });

    expect(result.succeededTrips).toBe(1);
    expect(result.observationsWritten).toBe(1);
    expect(database.calls.some((call) =>
      call.sql.includes("INSERT INTO event_disruption_observations")
      && call.values.includes("resolved"))).toBe(true);
    expect(database.calls.some((call) =>
      call.sql.includes("UPDATE event_disruption_current")
      && call.sql.includes("state = 'resolved'"))).toBe(true);
  });

  it("checks only one bounded batch per backend scheduler wake", async () => {
    const database = fakePool({ candidateCount: 25 });
    const model = provider({
      rawOutput: '{"alerts":[]}',
      effectiveModel: "gpt-6.1-sol",
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 0,
      webSearchCount: 1,
      webSearchQueries: ["official event status"],
    });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: model,
      now,
      maxTrips: 1,
      maxCandidatesPerBatch: 5,
      maxCandidatesPerRun: 25,
    });

    expect(result.succeededTrips).toBe(1);
    expect(model.check).toHaveBeenCalledTimes(1);
    expect(database.calls.filter((call) => call.sql.includes("INSERT INTO ai_requests (")))
      .toHaveLength(1);
    const prompts = (model.check as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0].prompt));
    for (let eventNumber = 1; eventNumber <= 4; eventNumber += 1) {
      const expectedTitle = eventNumber === 1 ? "Dinner [redacted] [redacted]" : `Event ${eventNumber}`;
      expect(prompts.some((prompt) => prompt.includes(expectedTitle))).toBe(true);
    }
    expect(prompts.some((prompt) => prompt.includes("Event 5"))).toBe(false);
    const runCompletion = database.calls.find((call) =>
      call.sql.includes("status = 'succeeded'") && call.sql.includes("candidate_count = $3"));
    expect(runCompletion?.values[2]).toBe(4);
    expect(runCompletion?.values[3]).toBe(1);
    expect(database.calls.filter((call) =>
      call.sql.includes("INSERT INTO event_disruption_check_state"))).toHaveLength(4);
  });

  it("retries one generic Codex turn failure and records the retry without exposing its message", async () => {
    const database = fakePool();
    const check = vi.fn()
      .mockRejectedValueOnce(new DisruptionProviderInvocationError(
        new Error("provider diagnostic that must stay out of the audit event"),
      ))
      .mockResolvedValueOnce({
        rawOutput: '{"alerts":[]}',
        effectiveModel: "gpt-6.1-sol",
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 0,
        webSearchCount: 1,
        webSearchQueries: ["official event status"],
      });

    const result = await runDueDisruptionMonitors(database.pool, {
      provider: { check },
      now,
      maxTrips: 1,
    });

    expect(result.succeededTrips).toBe(1);
    expect(check).toHaveBeenCalledTimes(2);
    const retry = database.calls.find((call) => call.sql.includes("'provider.retry.scheduled'"));
    expect(retry?.values[2]).toBe(2);
    expect(JSON.parse(String(retry?.values[3]))).toEqual({
      attempt: 2,
      errorCode: "DISRUPTION_PROVIDER_ERROR",
      priorAttemptUsageAvailable: false,
      retryLimitScope: "run",
    });
    expect(String(retry?.values[3])).not.toContain("provider diagnostic");
    const successEvents = database.calls.find((call) =>
      call.sql.includes("'provider.response.parsed'") && call.sql.includes("'request.completed'"));
    expect(successEvents?.values.slice(2, 5)).toEqual([3, 4, 5]);
  });

  it("does not retry an authentication failure and records a stable provider error code", async () => {
    const database = fakePool();
    const authenticationError = Object.assign(new Error("Forbidden"), { status: 403 });
    const check = vi.fn(async () => {
      throw authenticationError;
    });

    const result = await runDueDisruptionMonitors(database.pool, {
      provider: { check },
      now,
      maxTrips: 1,
    });

    expect(result.failedTrips).toBe(1);
    expect(check).toHaveBeenCalledOnce();
    expect(database.calls.some((call) => call.sql.includes("'provider.retry.scheduled'"))).toBe(false);
    const failedRequest = database.calls.find((call) =>
      call.sql.includes("UPDATE ai_requests") && call.sql.includes("status = 'failed'"));
    expect(failedRequest?.values).toContain("DISRUPTION_PROVIDER_AUTH");
  });

  it("does not create a new observation for unchanged evidence", async () => {
    const alert = {
      eventKey: "E1",
      state: "confirmed" as const,
      reasonCode: "closure" as const,
      severity: "warning" as const,
      detail: "Official venue notice says it will close during this event.",
      sourceUrls: ["https://venue.example.com/notices/closed"],
      affectedFrom: "2026-09-04T09:00:00Z",
      affectedUntil: "2026-09-04T15:00:00Z",
      validForMinutes: 30,
      impactAssessment: qualifiedAssessment,
      localizedDetails: {
        en: "Official venue notice says it will close during this event.",
        "zh-HK": "場地官方通告表示，活動期間會關閉。",
        "ja-JP": "施設の公式案内によると、この予定の時間帯は閉鎖されます。",
      },
    };
    const currentFingerprint = disruptionMonitorInternals.fingerprint(alert);
    const originalEvidence = { ...alert, localizedDetails: undefined };
    expect(disruptionMonitorInternals.fingerprint(originalEvidence)).toBe(currentFingerprint);
    expect(disruptionMonitorInternals.fingerprint({
      ...alert,
      detail: "The same source now reports a materially different impact.",
    })).not.toBe(currentFingerprint);
    const database = fakePool({ currentWarning: true, currentFingerprint });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: provider({
        rawOutput: JSON.stringify({ alerts: [alert] }),
        effectiveModel: "gpt-6.1-sol",
        inputTokens: 10,
        outputTokens: 10,
        cachedInputTokens: 0,
        webSearchCount: 1,
        webSearchQueries: ["official venue closure"],
      }),
      now,
      maxTrips: 1,
    });

    expect(result.observationsWritten).toBe(0);
    expect(database.calls.some((call) => call.sql.includes("INSERT INTO event_disruption_observations"))).toBe(false);
    const localizationWrite = database.calls.find((call) =>
      call.sql.includes("INSERT INTO event_disruption_localizations"));
    expect(localizationWrite?.values.slice(0, 3)).toEqual([
      tripId, "30000000-0000-4000-8000-000000000001", itemId,
    ]);
    expect(JSON.parse(String(localizationWrite?.values[3]))).toEqual(alert.localizedDetails);
    expect(database.calls.some((call) =>
      call.sql.includes("UPDATE event_disruption_current")
      && call.sql.includes("last_seen_at = $3"))).toBe(true);
  });

  it("rejects a resolved result when no matching current warning was supplied", async () => {
    const database = fakePool();
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: provider({
        rawOutput: JSON.stringify({ alerts: [{
          eventKey: "E1",
          state: "resolved",
          reasonCode: "closure",
          severity: "info",
          detail: "The venue is open.",
          sourceUrls: ["https://venue.example.com/status"],
          affectedFrom: null,
          affectedUntil: null,
          validForMinutes: 30,
        }] }),
        effectiveModel: "gpt-6.1-sol",
        inputTokens: 10,
        outputTokens: 10,
        cachedInputTokens: 0,
        webSearchCount: 1,
        webSearchQueries: ["official venue status"],
      }),
      now,
      maxTrips: 1,
    });

    expect(result.failedTrips).toBe(1);
    expect(database.calls.some((call) => call.sql.includes("INSERT INTO event_disruption_observations"))).toBe(false);
    const failedRequest = database.calls.find((call) =>
      call.sql.includes("UPDATE ai_requests") && call.sql.includes("status = 'failed'"));
    expect(failedRequest?.values).toContain("InvalidResolutionEvidenceError");
  });

  it("drops model output when the itinerary revision changes during the call", async () => {
    const database = fakePool({ currentRevision: 3 });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: provider({
        rawOutput: JSON.stringify({ alerts: [{
          eventKey: "E1",
          state: "confirmed",
          reasonCode: "closure",
          severity: "warning",
          detail: "The exact venue is closed during this event.",
          sourceUrls: ["https://operator.example.com/status"],
          affectedFrom: "2026-09-04T09:00:00Z",
          affectedUntil: "2026-09-04T15:00:00Z",
          validForMinutes: 30,
          impactAssessment: qualifiedAssessment,
        }] }),
        effectiveModel: "gpt-6.1-sol",
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        webSearchCount: 1,
        webSearchQueries: ["operator status"],
      }),
      now,
      maxTrips: 1,
    });

    expect(result.succeededTrips).toBe(1);
    expect(result.observationsWritten).toBe(0);
    expect(database.calls.some((call) => call.sql.includes("INSERT INTO event_disruption_observations"))).toBe(false);
  });

  it("does not start a second provider batch in the same scheduler process", async () => {
    const database = fakePool({ candidateCount: 2 });
    const check = vi.fn(async () => {
      if (check.mock.calls.length === 1) {
        return {
          rawOutput: JSON.stringify({ alerts: [{
            eventKey: "E1",
            state: "confirmed",
            reasonCode: "closure",
            severity: "warning",
            detail: "The official venue notice says this event is cancelled.",
            sourceUrls: ["https://venue.example.com/notices/cancelled"],
            affectedFrom: "2026-09-04T09:00:00Z",
            affectedUntil: "2026-09-04T15:00:00Z",
            validForMinutes: 30,
            impactAssessment: qualifiedAssessment,
          }] }),
          effectiveModel: "gpt-6.1-sol",
          inputTokens: 10,
          outputTokens: 10,
          cachedInputTokens: 0,
          webSearchCount: 1,
          webSearchQueries: ["official venue cancellation"],
        };
      }
      throw new Error("A second provider batch must not run.");
    });

    const result = await runDueDisruptionMonitors(database.pool, {
      provider: { check },
      now,
      maxTrips: 1,
      maxCandidatesPerBatch: 1,
      maxCandidatesPerRun: 2,
    });

    expect(result.succeededTrips).toBe(1);
    expect(result.observationsWritten).toBe(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(database.calls.filter((call) =>
      call.sql.includes("INSERT INTO event_disruption_observations"))).toHaveLength(1);
    expect(database.calls.filter((call) =>
      call.sql.includes("INSERT INTO event_disruption_check_state"))).toHaveLength(1);
  });

  it.each([
    ["possible", { state: "possible" }, "not_confirmed"],
    ["information only", { severity: "info" }, "not_warning_severity"],
    ["legacy missing assessment", { impactAssessment: undefined }, "missing_impact_assessment"],
    ["low confidence", { impactAssessment: { ...qualifiedAssessment, confidence: "low" } }, "insufficient_confidence"],
    ["nearby venue", { impactAssessment: { ...qualifiedAssessment, match: "nearby" } }, "indirect_event_match"],
    ["minor impact", { impactAssessment: { ...qualifiedAssessment, effect: "minor" } }, "no_meaningful_effect"],
    ["assumed rail route to a meal", { reasonCode: "transit_disruption" }, "unplanned_transport_route"],
    ["outside event time", { affectedFrom: "2026-09-05T09:00:00Z", affectedUntil: "2026-09-05T12:00:00Z" }, "no_supported_time_overlap"],
  ] as const)("suppresses %s without failure, TTL renewal or false resolution", async (_name, patch, reason) => {
    const claim = qualifiedAlert(patch);
    const database = fakePool({ currentWarning: true });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: checkedAlerts([claim]), now, maxTrips: 1,
    });
    expect(result).toMatchObject({ succeededTrips: 1, failedTrips: 0, observationsWritten: 0 });
    expect(database.calls.some(({ sql }) => sql.includes("INSERT INTO event_disruption_check_state"))).toBe(true);
    expect(database.calls.some(({ sql }) => sql.includes("INSERT INTO event_disruption_observations"))).toBe(false);
    expect(database.calls.some(({ sql }) => sql.includes("INSERT INTO event_disruption_current")
      || sql.includes("UPDATE event_disruption_current") || sql.includes("DELETE FROM event_disruption"))).toBe(false);
    const recorded = database.calls.find(({ sql }) => sql.includes("UPDATE ai_requests") && sql.includes("status = 'succeeded'"));
    expect(JSON.parse(String(recorded?.values[2]))).toMatchObject({
      alerts: [{ eventKey: "E1", detail: claim.detail }],
      qualificationPolicyVersion: 1, suppressedAlerts: [{ eventKey: "E1", reason }],
    });
    const events = database.calls.find(({ sql }) => sql.includes("'provider.response.parsed'"));
    expect(JSON.parse(String(events?.values[6]))).toMatchObject({ alertCount: 1, acceptedAlertCount: 0,
      suppressedAlerts: [{ eventKey: "E1", reason }] });
    expect(JSON.parse(String(events?.values[8]))).toMatchObject({ acceptedAlertCount: 0, suppressedAlertCount: 1 });
  });

  it("persists a qualified claim from a mixed batch while still recording the suppressed claim", async () => {
    const database = fakePool({ candidateCount: 2 });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: checkedAlerts([qualifiedAlert({ state: "possible" }), qualifiedAlert({ eventKey: "E2" })]),
      now, maxTrips: 1,
    });
    expect(result).toMatchObject({ succeededTrips: 1, failedTrips: 0, observationsWritten: 1 });
    expect(database.calls.filter(({ sql }) => sql.includes("INSERT INTO event_disruption_check_state"))).toHaveLength(2);
    const observations = database.calls.filter(({ sql }) => sql.includes("INSERT INTO event_disruption_observations"));
    expect(observations).toHaveLength(1);
    expect(observations[0]?.values[2]).toBe("20000000-0000-4000-8000-000000000002");
    expect(observations[0]?.values[15]).toBe(1);
    const recorded = database.calls.find(({ sql }) => sql.includes("UPDATE ai_requests") && sql.includes("status = 'succeeded'"));
    const parsed = JSON.parse(String(recorded?.values[2]));
    expect(parsed.alerts).toHaveLength(2);
    expect(parsed.suppressedAlerts).toEqual([{ eventKey: "E1", reason: "not_confirmed" }]);
  });

  it("appends a qualified recheck for identical legacy evidence instead of upgrading or renewing old evidence", async () => {
    const alert = qualifiedAlert();
    const database = fakePool({ currentWarning: true, currentWarningVersion: 0,
      currentFingerprint: disruptionMonitorInternals.fingerprint(alert) });
    const model = checkedAlerts([alert]);
    const result = await runDueDisruptionMonitors(database.pool, { provider: model, now, maxTrips: 1 });
    expect(result.observationsWritten).toBe(1);
    const providerPrompt = (model.check as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].prompt as string;
    expect(providerPrompt).toContain('"currentWarning":null');
    const observations = database.calls.filter(({ sql }) => sql.includes("INSERT INTO event_disruption_observations"));
    expect(observations).toHaveLength(1);
    expect(observations[0]?.values[1]).not.toBe("30000000-0000-4000-8000-000000000001");
    expect(observations[0]?.values[15]).toBe(1);
    expect(database.calls.some(({ sql }) => sql.includes("UPDATE event_disruption_observations")
      || (sql.includes("UPDATE event_disruption_current") && sql.includes("last_seen_at = $3")))).toBe(false);
    const currentWrite = database.calls.find(({ sql }) => sql.includes("INSERT INTO event_disruption_current"));
    expect(currentWrite?.values[10]).toEqual(new Date("2026-09-02T00:00:00Z"));
    const lockedRead = database.calls.find(({ sql }) => sql.includes("FROM event_disruption_current"));
    expect(lockedRead?.sql).toContain("qualified.qualification_policy_version");
    expect(lockedRead?.sql).toContain("FOR UPDATE OF current");
  });

  it("cannot turn a hidden unqualified legacy warning into a resolution", async () => {
    const database = fakePool({ currentWarning: true, currentWarningVersion: 0 });
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: checkedAlerts([qualifiedAlert({ state: "resolved", severity: "info",
        affectedFrom: null, affectedUntil: null, impactAssessment: undefined })]), now, maxTrips: 1,
    });
    expect(result).toMatchObject({ failedTrips: 1, observationsWritten: 0 });
    expect(database.calls.some(({ sql }) => sql.includes("INSERT INTO event_disruption_observations")
      || sql.includes("UPDATE event_disruption_current"))).toBe(false);
    const failed = database.calls.find(({ sql }) => sql.includes("UPDATE ai_requests") && sql.includes("status = 'failed'"));
    expect(failed?.values).toContain("InvalidResolutionEvidenceError");
  });

  it("keeps unknown aliases fatal instead of silently treating malformed output as a clean check", async () => {
    const database = fakePool();
    const result = await runDueDisruptionMonitors(database.pool, {
      provider: checkedAlerts([qualifiedAlert({ eventKey: "E2" })]), now, maxTrips: 1,
    });
    expect(result.failedTrips).toBe(1);
    expect(database.calls.some(({ sql }) => sql.includes("INSERT INTO event_disruption_check_state"))).toBe(false);
  });

  it("takes one ordered bounded candidate window per scheduler wake", () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      tripId,
      itemId: `item-${index}`,
      revision: 1,
      title: `Event ${index}`,
      itemType: "activity",
      startsAt: new Date("2026-09-04T10:00:00Z"),
      endsAt: new Date("2026-09-04T11:00:00Z"),
      locationName: "Tokyo",
      departureLocationName: null,
      destinationLocationName: null,
      checkScope: "future_day" as const,
      currentWarning: null,
    }));
    expect(disruptionMonitorInternals.selectCandidatesForRun(candidates, 2)
      .map((candidate) => candidate.itemId)).toEqual(["item-0", "item-1"]);
  });

  it("rejects non-overlapping evidence and cross-domain resolution claims", () => {
    const candidate = {
      tripId,
      itemId,
      revision: 2,
      title: "Venue event",
      itemType: "activity",
      startsAt: new Date("2026-09-04T10:00:00Z"),
      endsAt: new Date("2026-09-04T12:00:00Z"),
      locationName: "Tokyo",
      departureLocationName: null,
      destinationLocationName: null,
      checkScope: "current_day" as const,
      currentWarning: {
        state: "confirmed" as const,
        reasonCode: "closure" as const,
        severity: "warning" as const,
        detail: "The venue is closed.",
        sourceUrls: ["https://venue.example.com/status"],
        evidenceFingerprint: "a".repeat(64),
      },
    };
    const baseAlert = {
      eventKey: "E1",
      state: "confirmed" as const,
      reasonCode: "closure" as const,
      severity: "warning" as const,
      detail: "The venue remains closed.",
      sourceUrls: ["https://venue.example.com/status"],
      affectedFrom: "2026-09-04T09:00:00Z",
      affectedUntil: "2026-09-04T13:00:00Z",
      validForMinutes: 30,
    };

    expect(disruptionMonitorInternals.alertEvidenceMatchesCandidate(baseAlert, candidate)).toBe(true);
    expect(disruptionMonitorInternals.alertEvidenceMatchesCandidate({
      ...baseAlert,
      affectedFrom: "2026-09-05T09:00:00Z",
      affectedUntil: "2026-09-05T13:00:00Z",
    }, candidate)).toBe(false);
    expect(disruptionMonitorInternals.alertEvidenceMatchesCandidate({
      ...baseAlert,
      state: "resolved",
      severity: "info",
      sourceUrls: ["https://unrelated.example.net/status"],
      affectedFrom: null,
      affectedUntil: null,
    }, candidate)).toBe(false);
  });

  it("caps each provider call by both the call timeout and remaining run budget", () => {
    expect(disruptionMonitorInternals.remainingProviderTimeoutMs(200_000, 0)).toBe(120_000);
    expect(disruptionMonitorInternals.remainingProviderTimeoutMs(10_000, 4_950)).toBe(50);
    expect(() => disruptionMonitorInternals.remainingProviderTimeoutMs(5_000, 0))
      .toThrow(/run deadline/u);
    expect(disruptionMonitorInternals.hasProviderRetryBudget(125_000, 0)).toBe(true);
    expect(disruptionMonitorInternals.hasProviderRetryBudget(124_999, 0)).toBe(false);
    expect(disruptionMonitorInternals.classifyProviderFailure(
      new DisruptionProviderCleanupError(),
      new AbortController().signal,
    )).toEqual({ code: "DISRUPTION_PROVIDER_CLEANUP", retryable: false });
    expect(disruptionMonitorInternals.classifyProviderFailure(
      new Error("untagged internal failure"),
      new AbortController().signal,
    )).toEqual({ code: "DISRUPTION_PROVIDER_ERROR", retryable: false });
  });
});
