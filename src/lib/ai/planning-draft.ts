import type { PoolClient } from "pg";

import { AppConflictError } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { getLiveSearchIntent } from "@/lib/ai/search-policy";
import { withAiImageFacts } from "@/lib/ai/image-context";

const DRAFT_EVENT_TYPE = "planning.draft";
const DRAFT_RECEIPT_EVENT_TYPE = "planning.draft.receipt";
const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_DRAFT_SOURCE_TURNS = 8;
const MAX_DRAFT_SOURCE_CHARACTERS = 30_000;
const LEGACY_SCAN_ROWS = MAX_DRAFT_SOURCE_TURNS + 1;

type DraftState = "awaiting_details" | "consumed" | "closed";

type DraftPayload = {
  state: DraftState;
  rootRequestId: string;
  sourceRequestIds: string[];
  expiresAt: string;
};

export type PlanningDraft = {
  rootRequestId: string;
  sourceRequestIds: string[];
  expiresAt: string;
  /** The sequence of the authoritative planning.draft event on the root request. */
  version: number;
  userRequests: Array<{
    requestId: string;
    content: string;
    createdAt: string;
    referenceTime: {
      tripLocalDate?: string;
      tomorrowLocalDate?: string;
    } | null;
  }>;
  /** True only when the latest same-draft assistant turn asked who pays. */
  expectsPayerAnswer?: boolean;
  legacy: boolean;
};

type ActiveConversationRow = { id: string };

type MarkerRow = {
  root_request_id: string;
  root_created_at: Date | string;
  sequence: number;
  payload: unknown;
  database_now: Date | string;
};

type SourceRequestRow = {
  id: string;
  prompt_text: string;
  image_context_text?: string | null;
  result_text: string | null;
  created_at: Date | string;
  status: string;
  proposal_id: string | null;
  completed_payload: unknown;
  reference_time: unknown;
  clarification_payload?: unknown;
};

type CurrentRequestRow = {
  id: string;
  prompt_text: string;
  image_context_text?: string | null;
  created_at: Date | string;
};

const relativeToday = /\b(?:today|tonight)\b|今日|今天|本日|今晩|今晚/iu;
const relativeTomorrow = /\btomorrow\b|聽日|听日|明天|明日/iu;

const englishCreateVerb = /\b(?:add|create|schedule|save|record|put)\b/iu;
const englishCreateTarget = /\b(?:events?|plans?|itinerar(?:y|ies)|hotel|stay|lodging|bookings?|reservations?|expenses?|costs?|breakfast|lunch|dinner|meals?|transport|flights?|trains?|buses?)\b/iu;
const chineseCreateVerb = /(?:新增|加入|加到|建立|創建|创建|整(?:個|个)?|記錄|记录|記低|放入|排入)/u;
const chineseCreateTarget = /(?:活動|活动|行程|酒店|住宿|預訂|预订|預約|预约|支出|開支|开支|費用|费用|使費|洗費|早餐|午餐|晚餐|餐廳|餐厅|交通|航班|火車|火车|巴士)/u;
const japaneseCreateVerb = /(?:追加|作成|登録|記録|入れて|予定に入|旅程に入)/u;
const japaneseCreateTarget = /(?:予定|イベント|旅程|ホテル|宿泊|予約|経費|費用|朝食|昼食|夕食|食事|交通|飛行機|フライト|電車|バス)/u;
const createNegation = /\b(?:do\s+not|don't|dont|never|without)\s+(?:add|create|schedule|save|record)\b|(?:唔好|不要|別|别|毋須|毋须|無需|无需|不用|唔使|唔想|不想)\s*(?:新增|加入|加|建立|創建|创建|整|記錄|记录)|(?:追加|作成|登録|記録)(?:しないで|不要)/iu;
const proceduralCreateQuestion = /^\s*(?:how\s+(?:do|can|could|should|would)\b|what\s+(?:is|does|happens)\b|why\s+(?:do|does|should|would)\b)|^(?:點樣|点样|如何|怎樣|怎样).{0,40}(?:新增|加入|建立|創建|创建|記錄|记录)|^(?:どうやって|どのように).{0,40}(?:追加|作成|登録|記録)/iu;

const questionLanguage = /[?？]|\b(?:who|which|what|when|where|why|how|can\s+you|could\s+you|would\s+you)\b|(?:邊個|边个|邊位|边位|邊啲|边啲|幾時|几时|點解|点解|可唔可以|係咪|是否)|(?:誰|どなた|どの|いつ|どこ|なぜ|どうして|できますか)/iu;
// A standalone information request can mention "public" venues without answering
// a draft's visibility question. This gate does not grant live-search tools or
// change whether an existing draft may supply context to the provider.
const englishDiscoveryRequest = /(?:^|[.!?;]\s*)(?:please\s+)?(?:recommend|suggest|find|discover|list|show|tell|explore)\s+\S|\b(?:i|we)\s+(?:want|need|would\s+like)\s+(?:some\s+)?(?:recommendations?|suggestions?)\b/iu;
const chineseDiscoveryRequest = /(?:^|[。！？；;]\s*)(?:(?:請|请|幫我|帮我)\s*)?(?:推介|推薦|推荐|介紹|介绍).+|(?:有咩|有乜|有什麼|有什么).{0,120}(?:推介|推薦|推荐)/u;
const japaneseDiscoveryRequest = /(?:おすすめ|お勧め|オススメ)(?:して|を教えて)|(?:紹介|提案|推薦)して|(?:を|について)教えて/u;
const nonDraftMutation = /\b(?:update|edit|delete|remove|cancel|approve|reject|restore)\b|(?:更新|修改|編輯|编辑|刪除|删除|取消|批准|拒絕|拒绝|還原|还原)|(?:更新|編集|削除|キャンセル|承認|却下|復元)/iu;
const existingItemShareMutation = /\bshare\s+(?:(?:this|that|the|an?)\s+)?(?:existing\s+)?(?:events?|expenses?|plans?|itinerar(?:y|ies))\b|(?:分享|共享).{0,16}(?:活動|活动|行程|開支|开支|支出)|(?:予定|イベント|旅程|経費|費用)(?:を)?.{0,12}共有/u;
const clarificationNegation = /\b(?:not|never|no)\b|(?:唔係|不是|並非|并非|唔好|不要|別|别|冇|無|无|未)|(?:ではない|じゃない|しない|していない|不要)/iu;
const payerReply = /\b(?:(?:i|me|[\p{L}\p{N}_.-]+)\s+(?:have\s+|already\s+|will\s+)?paid|paid\s+by\s+(?:me|[\p{L}\p{N}_.-]+)|payer\s*(?:is|:|=)|(?:i|[\p{L}\p{N}_.-]+)\s+will\s+pay)\b|(?:我|[\p{L}\p{N}_.-]+)\s*(?:已經|已经|已|會|会)?\s*(?:俾|畀|付|付款|支付|埋單|買單|买单|結帳|结账|找數|找数)|由\s*(?:我|[\p{L}\p{N}_.-]+)\s*(?:付款|支付|埋單|買單|买单|結帳|结账|找數|找数)|(?:私|[\p{L}\p{N}_.-]+)(?:が|は)\s*(?:支払った|払った|支払います|払います|支払う|払う|決済した)/iu;
const splitReply = /\b(?:split|share|shared|divide)\b|(?:分擔|分担|攤分|摊分|夾錢|夹钱|一齊俾|一齐俾)|(?:割り勘|分担|折半)/iu;
const dateReply = /^(?:(?:the\s+)?date\s+(?:is|:)?\s*|on\s+)?(?:today|tonight|tomorrow|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?(?:\s*[ap]m)?)?\W*$|^(?:(?:日期|日子)(?:係|系|是|:)?\s*)?(?:今日|今天|今晚|聽日|听日|明天|明日|\d{1,2}月\d{1,2}日)(?:\s*\d{1,2}(?::\d{2})?)?\W*$|^(?:日付(?:は|:)?\s*)?(?:今日|本日|今晩|明日|\d{1,2}月\d{1,2}日)(?:\s*\d{1,2}(?::\d{2})?)?\W*$/iu;
const privacyReply = /\b(?:private|public|only\s+(?:me|us|them)|share\s+with)\b|(?:私人|私密|公開|公开|只限|淨係|净系|分享俾|分享畀)|(?:非公開|公開|自分だけ|共有)/iu;
const proceedReply = /^(?:yes|yep|yeah|ok(?:ay)?|sure|go\s+ahead|proceed|continue|do\s+it|confirm(?:ed)?|use\s+(?:the\s+)?(?:above|previous)(?:\s+(?:details?|message|request))?|i\s+already\s+(?:gave|provided|told)\s+(?:you\s+)?(?:that|this|it|the\s+(?:details?|information)))\W*$/iu;
const chineseProceedReply = /^(?:係|系|好|好呀|可以|得|照做|繼續|继续|確認|确认|用返上面(?:啲|的)?(?:資料|资料|內容|内容)?|上面有晒|之前講咗|之前讲咗|我已經講咗|我已经讲咗)\W*$/u;
const japaneseProceedReply = /^(?:はい|ええ|いいです|大丈夫|そのまま|進めて|続けて|確認|お願いします|上に書いた(?:内容|情報)?を使って|すでに伝えました)\W*$/u;

const englishCancellation = /^(?:never\s*mind|forget\s+it|cancel|stop|drop)(?:\s+(?:that|this|the))?(?:\s+(?:request|draft|plan))?[.!]?$/iu;
const englishDoNotCreate = /^(?:do\s+not|don't|dont)\s+(?:create|add|save|schedule)\s+(?:it|that|this)(?:\s+(?:event|expense|plan|booking|reservation))?[.!]?$/iu;
const chineseCancellation = /^(?:算啦|算了|唔使啦|不用了|取消|停止|唔好再整|不要再做|唔好加|不要加)(?:呢個|这个|嗰個|那个)?(?:要求|草稿|行程|活動|活动)?[。！!]?$/u;
const japaneseCancellation = /^(?:やめて|やめます|取り消して|中止して|忘れて|追加しないで|作成しないで)(?:ください)?[。！!]?$/u;
const explicitSearchNegationClause = /(?:^|[.;。；]\s*)(?:do\s+not|don't|dont|never|no\s+need\s+to)\s+(?:(?:use|using)\s+)?(?:(?:live|web|online|internet)\s+)*(?:search(?:ing)?|browse|look\s+it\s+up)\W*|(?:^|[。；;]\s*)(?:唔好|不要|毋須|毋须|無需|无需|不用|唔使)\s*(?:(?:上網|上网)\s*)?(?:搵|找|查|搜尋|搜索)\W*|(?:^|[。；;]\s*)(?:検索|調べ)(?:しないで|なくていい|不要)\W*/giu;

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeName(value: string): string {
  return normalizeText(value).toLocaleLowerCase("en-US").replace(/[.!?。！？]+$/u, "").trim();
}

/** High-confidence classification for a new event, booking, or expense create request. */
export function isDraftCreateRequest(prompt: string): boolean {
  const normalized = normalizeText(prompt);
  if (!normalized || createNegation.test(normalized) || proceduralCreateQuestion.test(normalized)) return false;
  return (englishCreateVerb.test(normalized) && englishCreateTarget.test(normalized))
    || (chineseCreateVerb.test(normalized) && chineseCreateTarget.test(normalized))
    || (japaneseCreateVerb.test(normalized) && japaneseCreateTarget.test(normalized));
}

/**
 * Accepts only a narrow whole-turn answer to a missing payer/split/date/privacy
 * detail or an explicit instruction to proceed. General questions, searches,
 * mutations, and new create requests must not inherit authority from history.
 */
export function isDraftClarificationReply(
  prompt: string,
  exactMemberNames: readonly string[] = [],
): boolean {
  const normalized = normalizeText(prompt);
  if (!normalized || normalized.length > 500) return false;
  const searchIntent = getLiveSearchIntent(normalized);
  if (questionLanguage.test(normalized)
      || englishDiscoveryRequest.test(normalized)
      || chineseDiscoveryRequest.test(normalized)
      || japaneseDiscoveryRequest.test(normalized)
      || searchIntent === "required"
      || isDraftCancellation(normalized)
      || isDraftCreateRequest(normalized)
      || nonDraftMutation.test(normalized)
      || existingItemShareMutation.test(normalized)) return false;

  const normalizedWhole = normalizeName(normalized);
  const exactMatches = exactMemberNames.filter(
    (name) => normalizeName(name) === normalizedWhole,
  );
  if (exactMatches.length === 1) return true;

  if (proceedReply.test(normalized)
      || chineseProceedReply.test(normalized)
      || japaneseProceedReply.test(normalized)) return true;

  const evidence = searchIntent === "disabled"
    ? normalizeText(normalized.replace(explicitSearchNegationClause, " "))
    : normalized;
  if (clarificationNegation.test(evidence)) return false;
  return payerReply.test(evidence)
    || splitReply.test(evidence)
    || dateReply.test(evidence)
    || privacyReply.test(evidence);
}

/** Select an open draft as context; the provider identifies an actual answer. */
export function isDraftContinuationCandidate(prompt: string): boolean {
  const normalized = normalizeText(prompt);
  // Let the provider interpret natural answers against the selected open draft.
  // Explicit separate operations continue through their own request path.
  return Boolean(normalized) && normalized.length <= 8_000
    && !isDraftCancellation(normalized) && !isDraftCreateRequest(normalized)
    && getLiveSearchIntent(normalized) !== "required"
    && !nonDraftMutation.test(normalized) && !existingItemShareMutation.test(normalized);
}

/** High-confidence request to abandon, rather than resume, a pending draft. */
export function isDraftCancellation(prompt: string): boolean {
  const normalized = normalizeText(prompt);
  if (!normalized || normalized.length > 160) return false;
  return englishCancellation.test(normalized)
    || englishDoNotCreate.test(normalized)
    || chineseCancellation.test(normalized)
    || japaneseCancellation.test(normalized);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw staleDraftError();
  return date.toISOString();
}

function parseDraftPayload(value: unknown, expectedRootRequestId: string): DraftPayload {
  const record = asRecord(value);
  const sourceRequestIds = record?.sourceRequestIds;
  if (!record
      || (record.state !== "awaiting_details" && record.state !== "consumed" && record.state !== "closed")
      || record.rootRequestId !== expectedRootRequestId
      || !Array.isArray(sourceRequestIds)
      || sourceRequestIds.length === 0
      || sourceRequestIds.length > MAX_DRAFT_SOURCE_TURNS
      || sourceRequestIds[0] !== expectedRootRequestId
      || sourceRequestIds.some((id) => typeof id !== "string" || id.length === 0)
      || new Set(sourceRequestIds).size !== sourceRequestIds.length
      || !validIsoDate(record.expiresAt)) {
    throw staleDraftError();
  }
  return {
    state: record.state,
    rootRequestId: record.rootRequestId,
    sourceRequestIds: [...sourceRequestIds] as string[],
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

function staleDraftError(): AppConflictError {
  return new AppConflictError("This AI planning clarification is no longer current. Start a new request with the full details.");
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expiryFor(createdAt: Date | string): string {
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) throw staleDraftError();
  return new Date(created.getTime() + DRAFT_LIFETIME_MS).toISOString();
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function proposalCount(row: SourceRequestRow): number | null {
  const payload = asRecord(row.completed_payload);
  const count = payload?.proposalCount;
  return Number.isSafeInteger(count) && Number(count) >= 0 ? Number(count) : null;
}

function latestTurnExpectsPayer(
  rows: readonly SourceRequestRow[],
  sourceRequestIds: readonly string[],
): boolean {
  const latestId = sourceRequestIds.at(-1);
  const latest = rows.find((row) => row.id === latestId);
  if (!latest) return false;
  const clarification = asRecord(latest.clarification_payload);
  if (clarification?.reason === "payer_not_explicit") return true;
  if (!assistantRequestedDetails(latest.result_text)) return false;
  return /\b(?:who\s+(?:paid|pays|will\s+pay)|payer)\b|付款人|(?:邊個|边个|邊位|边位).{0,24}(?:付款|支付|找數|找数|埋單|买单|買單)|(?:誰|どなた).{0,24}(?:支払|払)|(?:支払|払).{0,24}(?:誰|どなた)/iu
    .test(latest.result_text ?? "");
}

function referenceTime(value: unknown): PlanningDraft["userRequests"][number]["referenceTime"] {
  const record = asRecord(value);
  if (!record) return null;
  const tripLocalDate = typeof record.tripLocalDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(record.tripLocalDate)
    ? record.tripLocalDate
    : undefined;
  const tomorrowLocalDate = typeof record.tomorrowLocalDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(record.tomorrowLocalDate)
    ? record.tomorrowLocalDate
    : undefined;
  return tripLocalDate || tomorrowLocalDate ? { tripLocalDate, tomorrowLocalDate } : null;
}

function validateRelativeReference(
  content: string,
  reference: PlanningDraft["userRequests"][number]["referenceTime"],
): void {
  if (relativeToday.test(content) && !reference?.tripLocalDate) throw staleDraftError();
  if (relativeTomorrow.test(content) && !reference?.tomorrowLocalDate) throw staleDraftError();
}

function buildUserRequests(
  rows: readonly SourceRequestRow[],
  sourceRequestIds: readonly string[],
): PlanningDraft["userRequests"] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const userRequests = sourceRequestIds.map((requestId) => {
    const row = rowsById.get(requestId);
    if (!row
        || row.status !== "succeeded"
        || row.proposal_id !== null
        || proposalCount(row) !== 0
        || typeof row.prompt_text !== "string") throw staleDraftError();
    const currentReferenceTime = referenceTime(row.reference_time);
    const content = withAiImageFacts(row.prompt_text, row.image_context_text);
    validateRelativeReference(content, currentReferenceTime);
    return {
      requestId,
      content,
      createdAt: isoString(row.created_at),
      referenceTime: currentReferenceTime,
    };
  });
  const characterCount = userRequests.reduce((total, request) => total + request.content.length, 0);
  if (characterCount > MAX_DRAFT_SOURCE_CHARACTERS) throw staleDraftError();
  return userRequests;
}

async function lockActiveConversation(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  conversationId: string,
): Promise<void> {
  const result = await client.query<ActiveConversationRow>(
    `SELECT id
       FROM ai_conversations
      WHERE trip_id = $1 AND id = $2
        AND actor_member_id = $3 AND actor_user_id = $4
        AND closed_at IS NULL
      FOR UPDATE`,
    [session.tripId, conversationId, session.memberId, session.userId],
  );
  if (result.rows.length !== 1) throw staleDraftError();
}

async function readLatestMarker(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  conversationId: string,
): Promise<MarkerRow | null> {
  const result = await client.query<MarkerRow>(
    `SELECT request.id AS root_request_id, request.created_at AS root_created_at,
            event.sequence, event.payload, CURRENT_TIMESTAMP AS database_now
       FROM ai_requests request
       JOIN ai_request_events event
         ON event.trip_id = request.trip_id
        AND event.ai_request_id = request.id
        AND event.event_type = '${DRAFT_EVENT_TYPE}'
      WHERE request.trip_id = $1
        AND request.conversation_id = $2
        AND request.actor_member_id = $3
        AND request.actor_user_id = $4
        AND request.feature = 'planning'
        AND request.status = 'succeeded'
        AND event.payload ->> 'rootRequestId' = request.id::text
      ORDER BY event.created_at DESC, request.created_at DESC, event.sequence DESC, request.id DESC
      LIMIT 1`,
    [session.tripId, conversationId, session.memberId, session.userId],
  );
  return result.rows[0] ?? null;
}

async function readSourceRequests(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  conversationId: string,
  sourceRequestIds: readonly string[],
): Promise<SourceRequestRow[]> {
  const result = await client.query<SourceRequestRow>(
    `SELECT request.id, request.prompt_text, request.result_text, request.created_at,
            to_jsonb(request)->>'image_context_text' AS image_context_text,
            request.status, request.proposal_id,
            completed.payload AS completed_payload,
            clarification.payload AS clarification_payload,
            prepared.payload -> 'currentTime' AS reference_time
       FROM ai_requests request
       LEFT JOIN LATERAL (
         SELECT event.payload
           FROM ai_request_events event
          WHERE event.trip_id = request.trip_id
            AND event.ai_request_id = request.id
            AND event.event_type = 'request.completed'
          ORDER BY event.sequence DESC
          LIMIT 1
       ) completed ON true
       LEFT JOIN LATERAL (
         SELECT event.payload
           FROM ai_request_events event
          WHERE event.trip_id = request.trip_id
            AND event.ai_request_id = request.id
            AND event.event_type = 'proposal.clarification.required'
          ORDER BY event.sequence DESC
          LIMIT 1
       ) clarification ON true
       LEFT JOIN LATERAL (
         SELECT event.payload
           FROM ai_request_events event
          WHERE event.trip_id = request.trip_id
            AND event.ai_request_id = request.id
            AND event.event_type = 'context.prepared'
          ORDER BY event.sequence DESC
          LIMIT 1
       ) prepared ON true
      WHERE request.trip_id = $1
        AND request.conversation_id = $2
        AND request.actor_member_id = $3
        AND request.actor_user_id = $4
        AND request.feature = 'planning'
        AND request.id = ANY($5::uuid[])`,
    [session.tripId, conversationId, session.memberId, session.userId, sourceRequestIds],
  );
  return result.rows;
}

async function appendRootMarker(
  client: Pick<PoolClient, "query">,
  tripId: string,
  rootRequestId: string,
  payload: DraftPayload,
): Promise<number> {
  const result = await client.query<{ sequence: number }>(
    `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
     SELECT $1, $2, COALESCE(MAX(event.sequence), 0) + 1, '${DRAFT_EVENT_TYPE}', $3::jsonb
       FROM ai_request_events event
      WHERE event.trip_id = $1 AND event.ai_request_id = $2
     RETURNING sequence`,
    [tripId, rootRequestId, JSON.stringify(payload)],
  );
  const sequence = result.rows[0]?.sequence;
  if (!Number.isSafeInteger(sequence) || Number(sequence) < 1) throw staleDraftError();
  return Number(sequence);
}

async function appendCurrentReceipt(
  client: Pick<PoolClient, "query">,
  tripId: string,
  requestId: string,
  sequence: number,
  payload: DraftPayload,
): Promise<void> {
  await client.query(
    `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
     VALUES ($1,$2,$3,'${DRAFT_RECEIPT_EVENT_TYPE}',$4::jsonb)`,
    [tripId, requestId, sequence, JSON.stringify(payload)],
  );
}

function assistantRequestedDetails(resultText: string | null): boolean {
  if (!resultText) return false;
  return /[?？]|\b(?:who|which|what|when|please\s+(?:provide|confirm|specify|name)|need\s+(?:the|to\s+know))\b|(?:邊個|边个|邊位|边位|邊啲|边啲|請提供|请提供|請確認|请确认|請列出|请列出|需要知道)|(?:誰|どなた|どの|いつ|教えて|指定してください|確認してください)/iu.test(resultText);
}

async function loadLegacyDraft(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  conversationId: string,
): Promise<PlanningDraft | null> {
  const result = await client.query<SourceRequestRow & { database_now: Date | string }>(
    `SELECT request.id, request.prompt_text, request.result_text, request.created_at,
            to_jsonb(request)->>'image_context_text' AS image_context_text,
            request.status, request.proposal_id, CURRENT_TIMESTAMP AS database_now,
            completed.payload AS completed_payload,
            prepared.payload -> 'currentTime' AS reference_time
       FROM ai_requests request
       LEFT JOIN LATERAL (
         SELECT event.payload
           FROM ai_request_events event
          WHERE event.trip_id = request.trip_id
            AND event.ai_request_id = request.id
            AND event.event_type = 'request.completed'
          ORDER BY event.sequence DESC
          LIMIT 1
       ) completed ON true
       LEFT JOIN LATERAL (
         SELECT event.payload
           FROM ai_request_events event
          WHERE event.trip_id = request.trip_id
            AND event.ai_request_id = request.id
            AND event.event_type = 'context.prepared'
          ORDER BY event.sequence DESC
          LIMIT 1
       ) prepared ON true
      WHERE request.trip_id = $1
        AND request.conversation_id = $2
        AND request.actor_member_id = $3
        AND request.actor_user_id = $4
        AND request.feature = 'planning'
      ORDER BY request.created_at DESC, request.id DESC
      LIMIT $5`,
    [session.tripId, conversationId, session.memberId, session.userId, LEGACY_SCAN_ROWS],
  );
  if (result.rows.length === 0) return null;

  const newestFirstSources: SourceRequestRow[] = [];
  let root: (SourceRequestRow & { database_now: Date | string }) | null = null;
  for (let index = 0; index < Math.min(result.rows.length, MAX_DRAFT_SOURCE_TURNS); index += 1) {
    const row = result.rows[index]!;
    if (row.status !== "succeeded" || row.proposal_id !== null || proposalCount(row) !== 0) return null;

    if (isDraftCreateRequest(row.prompt_text)) {
      if (!assistantRequestedDetails(row.result_text)) return null;
      root = row;
      newestFirstSources.push(row);
      break;
    }

    if (getLiveSearchIntent(row.prompt_text) === "required") {
      continue;
    }
    if (!isDraftClarificationReply(row.prompt_text) || !assistantRequestedDetails(row.result_text)) {
      return null;
    }
    newestFirstSources.push(row);
  }
  if (!root) return null;

  const expiresAt = expiryFor(root.created_at);
  if (Date.parse(expiresAt) <= new Date(root.database_now).getTime()) return null;
  const sourceRows = newestFirstSources.reverse();
  const sourceRequestIds = sourceRows.map((row) => row.id);
  const userRequests = buildUserRequests(sourceRows, sourceRequestIds);

  const lockedRoot = await client.query<{ id: string }>(
    `SELECT id
       FROM ai_requests
      WHERE trip_id = $1 AND id = $2
        AND conversation_id = $3
        AND actor_member_id = $4 AND actor_user_id = $5
        AND feature = 'planning' AND status = 'succeeded'
      FOR UPDATE`,
    [session.tripId, root.id, conversationId, session.memberId, session.userId],
  );
  if (lockedRoot.rows.length !== 1) throw staleDraftError();

  // The active conversation row is already locked. Recheck that another marker
  // did not appear before initializing this one for a pre-feature conversation.
  if (await readLatestMarker(client, session, conversationId)) throw staleDraftError();
  const payload: DraftPayload = {
    state: "awaiting_details",
    rootRequestId: root.id,
    sourceRequestIds,
    expiresAt,
  };
  const version = await appendRootMarker(client, session.tripId, root.id, payload);
  return {
    rootRequestId: root.id,
    sourceRequestIds,
    expiresAt,
    version,
    userRequests,
    expectsPayerAnswer: latestTurnExpectsPayer(sourceRows, sourceRequestIds),
    legacy: true,
  };
}

/**
 * Loads the one active, exact-identity clarification draft. This function is
 * intended for the planner setup transaction and locks the active conversation;
 * it may initialize one marker for a narrowly recognized pre-feature chain.
 */
export async function loadPlanningDraft(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  conversationId: string,
  options: { freeOnly?: boolean } = {},
): Promise<PlanningDraft | null> {
  await lockActiveConversation(client, session, conversationId);
  const marker = await readLatestMarker(client, session, conversationId);
  if (!marker) return options.freeOnly ? null : loadLegacyDraft(client, session, conversationId);

  const payload = parseDraftPayload(marker.payload, marker.root_request_id);
  if (!sameInstant(payload.expiresAt, expiryFor(marker.root_created_at))) throw staleDraftError();
  if (payload.state !== "awaiting_details") return null;
  if (Date.parse(payload.expiresAt) <= new Date(marker.database_now).getTime()) return null;

  if (options.freeOnly) {
    const provenance = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ai_requests WHERE trip_id = $1 AND conversation_id = $2
         AND actor_user_id = $3 AND actor_member_id = $4 AND id = ANY($5::uuid[])
         AND to_jsonb(ai_requests)->>'credential_source' = 'free'`,
      [session.tripId, conversationId, session.userId, session.memberId, payload.sourceRequestIds],
    );
    if (provenance.rows[0]?.count !== payload.sourceRequestIds.length) return null;
  }

  const sourceRows = await readSourceRequests(
    client,
    session,
    conversationId,
    payload.sourceRequestIds,
  );
  const userRequests = buildUserRequests(sourceRows, payload.sourceRequestIds);
  return {
    rootRequestId: payload.rootRequestId,
    sourceRequestIds: payload.sourceRequestIds,
    expiresAt: payload.expiresAt,
    version: marker.sequence,
    userRequests,
    expectsPayerAnswer: latestTurnExpectsPayer(sourceRows, payload.sourceRequestIds),
    legacy: false,
  };
}

/**
 * Revalidates a previously loaded draft under the active-conversation and root
 * request row locks. Call this immediately before any proposal creation.
 */
export async function assertPlanningDraftCurrent(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  conversationId: string,
  draft: PlanningDraft,
): Promise<void> {
  await lockActiveConversation(client, session, conversationId);
  const root = await client.query<{ id: string }>(
    `SELECT id
       FROM ai_requests
      WHERE trip_id = $1 AND id = $2
        AND conversation_id = $3
        AND actor_member_id = $4 AND actor_user_id = $5
        AND feature = 'planning' AND status = 'succeeded'
      FOR UPDATE`,
    [session.tripId, draft.rootRequestId, conversationId, session.memberId, session.userId],
  );
  if (root.rows.length !== 1) throw staleDraftError();

  const marker = await readLatestMarker(client, session, conversationId);
  if (!marker || marker.root_request_id !== draft.rootRequestId || marker.sequence !== draft.version) {
    throw staleDraftError();
  }
  const payload = parseDraftPayload(marker.payload, marker.root_request_id);
  if (payload.state !== "awaiting_details"
      || !arraysEqual(payload.sourceRequestIds, draft.sourceRequestIds)
      || !sameInstant(payload.expiresAt, draft.expiresAt)
      || !sameInstant(payload.expiresAt, expiryFor(marker.root_created_at))
      || Date.parse(payload.expiresAt) <= new Date(marker.database_now).getTime()) {
    throw staleDraftError();
  }
}

export type RecordPlanningDraftInput = {
  conversationId: string;
  requestId: string;
  prompt: string;
  proposalCount: number;
  previous: PlanningDraft | null;
  mode: "new" | "continue" | "lookup" | "close" | "none";
  /** The next unused event sequence on the current request. */
  sequence: number;
};

async function lockCurrentRequest(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  input: RecordPlanningDraftInput,
): Promise<CurrentRequestRow> {
  const result = await client.query<CurrentRequestRow>(
    `SELECT id, prompt_text, created_at, to_jsonb(ai_requests)->>'image_context_text' AS image_context_text
       FROM ai_requests
      WHERE trip_id = $1 AND id = $2
        AND conversation_id = $3
        AND actor_member_id = $4 AND actor_user_id = $5
        AND feature = 'planning' AND status = 'succeeded'
        AND completed_at IS NOT NULL
      FOR UPDATE`,
    [session.tripId, input.requestId, input.conversationId, session.memberId, session.userId],
  );
  const row = result.rows[0];
  if (!row || row.prompt_text !== input.prompt) throw staleDraftError();
  return row;
}

async function recordExistingRootState(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  input: RecordPlanningDraftInput,
  previous: PlanningDraft,
  state: DraftState,
  sourceRequestIds: string[],
): Promise<void> {
  const payload: DraftPayload = {
    state,
    rootRequestId: previous.rootRequestId,
    sourceRequestIds,
    expiresAt: previous.expiresAt,
  };
  await appendRootMarker(client, session.tripId, previous.rootRequestId, payload);
  await appendCurrentReceipt(client, session.tripId, input.requestId, input.sequence, payload);
}

/**
 * Records lifecycle state after the current AI request has been marked
 * succeeded. The caller owns the surrounding transaction and increments its
 * current-request event sequence exactly once after this call.
 */
export async function recordPlanningDraft(
  client: Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  input: RecordPlanningDraftInput,
): Promise<void> {
  if (input.mode === "none") return;
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1
      || !Number.isSafeInteger(input.proposalCount) || input.proposalCount < 0) {
    throw staleDraftError();
  }

  if (input.previous) {
    await assertPlanningDraftCurrent(
      client,
      session,
      input.conversationId,
      input.previous,
    );
  } else {
    await lockActiveConversation(client, session, input.conversationId);
  }
  const current = await lockCurrentRequest(client, session, input);

  if (input.mode === "new") {
    if (input.previous) {
      const closedPayload: DraftPayload = {
        state: "closed",
        rootRequestId: input.previous.rootRequestId,
        sourceRequestIds: input.previous.sourceRequestIds,
        expiresAt: input.previous.expiresAt,
      };
      await appendRootMarker(client, session.tripId, input.previous.rootRequestId, closedPayload);
    }
    if (withAiImageFacts(input.prompt, current.image_context_text).length > MAX_DRAFT_SOURCE_CHARACTERS) throw staleDraftError();
    const payload: DraftPayload = {
      state: input.proposalCount > 0 ? "consumed" : "awaiting_details",
      rootRequestId: input.requestId,
      sourceRequestIds: [input.requestId],
      expiresAt: expiryFor(current.created_at),
    };
    await client.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
       VALUES ($1,$2,$3,'${DRAFT_EVENT_TYPE}',$4::jsonb)`,
      [session.tripId, input.requestId, input.sequence, JSON.stringify(payload)],
    );
    return;
  }

  if (!input.previous) return;
  if (input.mode === "continue") {
    const sourceRequestIds = [...input.previous.sourceRequestIds, input.requestId];
    const characterCount = input.previous.userRequests.reduce(
      (total, request) => total + request.content.length,
      withAiImageFacts(input.prompt, current.image_context_text).length,
    );
    if (sourceRequestIds.length > MAX_DRAFT_SOURCE_TURNS
        || new Set(sourceRequestIds).size !== sourceRequestIds.length
        || characterCount > MAX_DRAFT_SOURCE_CHARACTERS) throw staleDraftError();
    await recordExistingRootState(
      client,
      session,
      input,
      input.previous,
      input.proposalCount > 0 ? "consumed" : "awaiting_details",
      sourceRequestIds,
    );
    return;
  }

  if (input.mode === "lookup") {
    if (input.proposalCount !== 0) throw staleDraftError();
    await recordExistingRootState(
      client,
      session,
      input,
      input.previous,
      "awaiting_details",
      [...input.previous.sourceRequestIds],
    );
    return;
  }

  await recordExistingRootState(
    client,
    session,
    input,
    input.previous,
    "closed",
    [...input.previous.sourceRequestIds],
  );
}
