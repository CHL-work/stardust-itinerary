import type { Pool, PoolClient } from "pg";

import { estimateRequestUsd } from "@/lib/ai/model-prices";
import { assertTrip, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { AuthenticatedSession } from "@/lib/auth/repository";

/**
 * The signed-in account's AI usage for the AI tab (JOB-093, D-105): the last 30 UTC days of requests it
 * made and requests its keys paid for, with token totals by service and model. Only requests the
 * account's own keys paid for carry an estimated cost; free, shared and site-funded requests show tokens.
 */
import { AI_USAGE_DAYS, aiUsageServices, type AiUsagePayer, type AiUsageService, type AiUsageSummary } from "@/lib/ai/usage-types";

export { AI_USAGE_DAYS, aiUsageServices, type AiUsagePayer, type AiUsageService, type AiUsageSummary };

type UsageRow = {
  day: string; feature: string; model: string; provider: string; payer: AiUsagePayer;
  requests: number; input_tokens: string; output_tokens: string; cached_input_tokens: string; web_searches: string;
};

export function usageService(feature: string): AiUsageService {
  if (feature === "planning" || feature === "off_topic" || feature === "policy_denial") return "chat";
  if (feature === "flight_status" || feature === "disruption_monitor") return "routine";
  if (feature === "trip_destination_defaults") return "tripSetup";
  return "other";
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emptyTokens(): Record<AiUsageService, number> {
  return { chat: 0, routine: 0, tripSetup: 0, other: 0 };
}

const PAYER = `CASE WHEN r.credential_source = 'free' THEN 'free' ELSE 'others' END`;
const SUMS = `count(*)::integer AS requests,
       COALESCE(sum(r.input_tokens), 0)::text AS input_tokens,
       COALESCE(sum(r.output_tokens), 0)::text AS output_tokens,
       COALESCE(sum(r.cached_input_tokens), 0)::text AS cached_input_tokens`;

/**
 * Three disjoint sources, so each index applies: requests the account made; requests members made on its
 * shared key; and routine checks its own key paid for (system rows with a paying member, JOB-094).
 * Destination lookups have no trip, so they come from `account_ai_lookups`.
 */
export async function readAiUsageRows(client: Pick<PoolClient, "query">, userId: string, since: Date): Promise<UsageRow[]> {
  const result = await client.query<UsageRow>(
    `SELECT (r.created_at AT TIME ZONE 'UTC')::date::text AS day, r.feature,
            COALESCE(r.effective_model, r.requested_model) AS model, r.provider,
            CASE WHEN r.credential_source = 'own' THEN 'mine' ELSE ${PAYER} END AS payer,
            ${SUMS}, COALESCE(sum(r.web_search_count), 0)::text AS web_searches
       FROM ai_requests r
      WHERE r.actor_user_id = $1 AND r.created_at >= $2 AND r.status <> 'rejected'
      GROUP BY 1, 2, 3, 4, 5
     UNION ALL
     SELECT (r.created_at AT TIME ZONE 'UTC')::date::text, r.feature,
            COALESCE(r.effective_model, r.requested_model), r.provider, 'mine',
            ${SUMS}, COALESCE(sum(r.web_search_count), 0)::text
       FROM trip_members sponsor
       JOIN ai_requests r ON r.trip_id = sponsor.trip_id AND r.credential_sponsor_member_id = sponsor.id
      WHERE sponsor.user_id = $1 AND r.credential_source = 'shared' AND r.created_at >= $2 AND r.status <> 'rejected'
      GROUP BY 1, 2, 3, 4, 5
     UNION ALL
     SELECT (r.created_at AT TIME ZONE 'UTC')::date::text, r.feature,
            COALESCE(r.effective_model, r.requested_model), r.provider, 'mine',
            ${SUMS}, COALESCE(sum(r.web_search_count), 0)::text
       FROM trip_members payer
       JOIN ai_requests r ON r.trip_id = payer.trip_id AND r.credential_member_id = payer.id
      WHERE payer.user_id = $1 AND r.credential_source = 'own' AND r.initiator_kind = 'system'
        AND r.created_at >= $2 AND r.status <> 'rejected'
      GROUP BY 1, 2, 3, 4, 5
     UNION ALL
     SELECT (l.created_at AT TIME ZONE 'UTC')::date::text, l.feature,
            COALESCE(l.effective_model, l.requested_model), l.provider,
            CASE WHEN l.credential_source = 'own' THEN 'mine' WHEN l.credential_source = 'free' THEN 'free' ELSE 'others' END,
            count(*)::integer, COALESCE(sum(l.input_tokens), 0)::text, COALESCE(sum(l.output_tokens), 0)::text,
            COALESCE(sum(l.cached_input_tokens), 0)::text, '0'
       FROM account_ai_lookups l
      WHERE l.user_id = $1 AND l.created_at >= $2
      GROUP BY 1, 2, 3, 4, 5`,
    [userId, since],
  );
  return result.rows;
}

function count(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** Anthropic reports cache reads apart from input tokens; the others include them. */
function rowTokens(row: UsageRow): number {
  const input = count(row.input_tokens);
  return (row.provider === "anthropic" ? input + count(row.cached_input_tokens) : input) + count(row.output_tokens);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function summarizeAiUsage(rows: readonly UsageRow[], now: Date): AiUsageSummary {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (AI_USAGE_DAYS - 1)));
  const days = Array.from({ length: AI_USAGE_DAYS }, (_, index) => ({
    date: utcDay(new Date(first.getTime() + index * 86_400_000)), tokens: emptyTokens(),
  }));
  const byDay = new Map(days.map((day) => [day.date, day]));
  const services = new Map(aiUsageServices.map((service) => [service, { service, requests: 0, tokens: 0, costUsd: 0 }]));
  const models = new Map<string, AiUsageSummary["models"][number]>();
  const total = { requests: 0, tokens: 0, costUsd: 0, webSearches: 0 };
  for (const row of rows) {
    const service = usageService(row.feature);
    const tokens = rowTokens(row);
    const searches = count(row.web_searches);
    const cost = row.payer === "mine"
      ? estimateRequestUsd({ model: row.model, at: `${row.day}T12:00:00Z`, inputTokens: count(row.input_tokens),
        outputTokens: count(row.output_tokens), cachedInputTokens: count(row.cached_input_tokens), webSearches: searches })
      : null;
    const day = byDay.get(row.day);
    if (day) day.tokens[service] += tokens;
    const serviceTotal = services.get(service)!;
    serviceTotal.requests += row.requests;
    serviceTotal.tokens += tokens;
    serviceTotal.costUsd += cost ?? 0;
    const key = `${row.model}\u0000${row.provider}\u0000${row.payer}`;
    const model = models.get(key) ?? { model: row.model, provider: row.provider, payer: row.payer, requests: 0, tokens: 0,
      costUsd: row.payer === "mine" ? 0 : null };
    model.requests += row.requests;
    model.tokens += tokens;
    if (model.costUsd !== null && cost !== null) model.costUsd += cost;
    models.set(key, model);
    total.requests += row.requests;
    total.tokens += tokens;
    total.costUsd += cost ?? 0;
    total.webSearches += row.payer === "mine" ? searches : 0;
  }
  return {
    since: days[0].date,
    days,
    services: [...services.values()].map((entry) => ({ ...entry, costUsd: roundUsd(entry.costUsd) })),
    models: [...models.values()]
      .map((entry) => ({ ...entry, costUsd: entry.costUsd === null ? null : roundUsd(entry.costUsd) }))
      .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model)),
    total: { ...total, costUsd: roundUsd(total.costUsd) },
  };
}

export async function getAiUsageSummary(pool: Pool, session: AuthenticatedSession, tripId: string, now = new Date()): Promise<AiUsageSummary> {
  assertTrip(session, tripId);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (AI_USAGE_DAYS - 1)));
  const rows = await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    return readAiUsageRows(client, session.userId, since);
  });
  return summarizeAiUsage(rows, now);
}
