import type { Locale } from "@/lib/i18n";
import { localizedCatalog, type BaseCatalogs } from "@/lib/locale-packs";

export const reservationExpenseAssumptionReasons = [
  "payer_not_explicit",
  "member_name_ambiguous",
  "participant_not_explicit",
  "member_unavailable",
] as const;

export type ReservationExpenseAssumptionReason =
  (typeof reservationExpenseAssumptionReasons)[number];

export type ReservationExpenseDirectoryMember = Readonly<{
  id: string;
  displayName: string;
  status?: "active" | "invited";
}>;

export type ProposedReservationExpenseMembers = Readonly<{
  payerMemberId?: string | null;
  splitMemberIds?: readonly string[] | null;
  viewerMemberIds?: readonly string[] | null;
}>;

export type ReservationExpenseEvidenceOptions = Readonly<{
  /** A bare exact member name is payer evidence only after a payer question. */
  exactPayerAnswer?: string;
  /** Payer wording is reviewable; a private audience still needs source support. */
  requirePayerEvidence?: boolean;
}>;

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{L}\p{N}\p{M}\p{Pd}_]/u.test(value));
}

function isCjkName(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function isCjkCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value));
}

function exactNameOccurrences(prompt: string, displayName: string): Array<{ start: number; end: number }> {
  const name = normalizeEvidence(displayName);
  if (!name) return [];
  const allowAttachedHonorific = isCjkName(name);
  const occurrences: Array<{ start: number; end: number }> = [];
  let fromIndex = 0;
  while (fromIndex <= prompt.length - name.length) {
    const start = prompt.indexOf(name, fromIndex);
    if (start < 0) break;
    const end = start + name.length;
    const leftBoundary = !isWordCharacter(prompt[start - 1]) || isCjkCharacter(prompt[start - 1]);
    const rightBoundary = !isWordCharacter(prompt[end]) || isCjkCharacter(prompt[end]);
    if (allowAttachedHonorific || (leftBoundary && rightBoundary)) {
      occurrences.push({ start, end });
    }
    fromIndex = start + Math.max(1, name.length);
  }
  return occurrences;
}

function hasExplicitSelfPayer(prompt: string): boolean {
  const negatedOrHypothetical = /\b(?:not|never)\s+paid\s+by\s+me\b|\bi\s+(?:(?:have|had)\s+)?(?:not|never)\s+paid\b|\bi\s+(?:did\s+not|didn't)\s+pay\b|\b(?:if|whether)\s+i\s+(?:(?:have|had|already)\s+)?paid\b|\bif\s+paid\s+by\s+me\b/iu.test(prompt)
    || /(?:もし|仮に)\s*私\s*が.{0,12}(?:支払った|払った|支払う)|私\s*(?:が|は).{0,12}(?:支払っていない|払っていない|支払わなかった|払わなかった|支払ったわけではない)/u.test(prompt)
    || /(?:唔係|不是|並非|并非|係咪|是否)\s*(?:由\s*)?我\s*(?:付款|支付|埋單|買單|买单|結帳|结账|找數|找数)|(?:如果|假如|若果)\s*(?:係|是)?\s*(?:由\s*)?我\s*(?:已經|已经|已|會|会)?\s*(?:俾|畀|付|付款|支付|找數|找数)|我\s*(?:冇|無|无|未|沒有|没有|唔|不)\s*(?:會|会)?\s*(?:俾|畀|付|付款|支付|找數|找数)/u.test(prompt);
  if (negatedOrHypothetical) return false;
  return /\bi\s+(?:(?:have|already)\s+)?paid\b|\bpaid\s+by\s+me\b|\bi(?:['’]?ll|\s+will)\s+pay\b/iu.test(prompt)
    || /私\s*が\s*(?:代金|料金|費用)?\s*(?:を\s*)?(?:支払った|払った|支払います|支払う|決済した)/u.test(prompt)
    || /我\s*(?:俾|畀|付)(?:咗|左|了)?(?:\s*(?:錢|钱|款|費|费|¥|￥|\d))?/u.test(prompt)
    || /由\s*我\s*(?:付款|支付|埋單|買單|买单|結帳|结账|找數|找数)|我\s*(?:已經|已经|已|會|会)?\s*(?:付款|支付|找數|找数)/u.test(prompt);
}

function namedPayerEvidenceIsBlocked(before: string, after: string): boolean {
  return /\b(?:not|never)\s+paid\s+by\s*$/iu.test(before)
    || /\b(?:if|whether)\s+(?:paid\s+by\s*)?$/iu.test(before)
    || /(?:もし|仮に)\s*$|(?:如果|假如|若果)\s*(?:(?:係|是)\s*)?(?:由\s*)?$/u.test(before)
    || /(?:唔係|不是|並非|并非|係咪|是否)\s*(?:由\s*)?$/u.test(before)
    || /^\s*(?:(?:has|had)\s+(?:not|never)\s+paid|(?:did\s+not|didn't|does\s+not|doesn't)\s+pay)\b/iu.test(after)
    || /^(?:さん|様)?\s*(?:が|は).{0,12}?(?:支払っていない|払っていない|支払わなかった|払わなかった|支払ったわけではない)/u.test(after)
    || /^\s*(?:冇|無|无|未|沒有|没有|唔|不|唔係|不是|並非|并非).{0,8}?(?:俾|畀|付|付款|支付|埋單|買單|买单|結帳|结账|找數|找数)/u.test(after);
}

function hasExplicitNamedPayer(prompt: string, displayName: string): boolean {
  for (const occurrence of exactNameOccurrences(prompt, displayName)) {
    const before = prompt.slice(Math.max(0, occurrence.start - 24), occurrence.start);
    const after = prompt.slice(occurrence.end, Math.min(prompt.length, occurrence.end + 48));
    if (namedPayerEvidenceIsBlocked(before, after)) continue;
    if (/\b(?:paid\s+by|payer\s*[:=])\s*$/iu.test(before)
        || /^\s*(?:(?:has|had|already)\s+)?paid\b/iu.test(after)
        || /^\s*(?:(?:will|is\s+going\s+to)\s+pay)\b/iu.test(after)
        || /由\s*$/u.test(before) && /^\s*(?:付款|支付|埋單|買單|买单|結帳|结账|找數|找数)/u.test(after)
        || /^(?:さん|様)?\s*(?:が|は).{0,12}?(?:支払った|払った|支払います|支払う|決済した)/u.test(after)
        || /^\s*(?:已經|已经|已|會|会)?\s*(?:俾咗|畀咗|付咗|付款|支付|埋單|買單|买单|結帳|结账|找數|找数)/u.test(after)) {
      return true;
    }
  }
  return false;
}

function selectedMemberHasAmbiguousName(
  member: ReservationExpenseDirectoryMember,
  eligibleDirectory: readonly ReservationExpenseDirectoryMember[],
): boolean {
  const normalizedName = normalizeEvidence(member.displayName);
  return Boolean(normalizedName) && eligibleDirectory.filter(
    (candidate) => normalizeEvidence(candidate.displayName) === normalizedName,
  ).length > 1;
}

function isExactPayerNameAnswer(
  answer: string | undefined,
  payer: ReservationExpenseDirectoryMember,
): boolean {
  if (!answer) return false;
  const normalizedAnswer = normalizeEvidence(answer).replace(/[.!?。！？]+$/gu, "").trim();
  return normalizedAnswer === normalizeEvidence(payer.displayName);
}

/**
 * Checks only explicit member evidence for a proposed nested reservation
 * expense. It does not infer expense intent, change amounts, or remove an
 * expense; callers decide whether to ask the localized clarification.
 */
export function assessReservationExpense(
  prompt: string,
  actorMemberId: string,
  directory: readonly ReservationExpenseDirectoryMember[],
  proposed: ProposedReservationExpenseMembers,
  options: ReservationExpenseEvidenceOptions = {},
): ReservationExpenseAssumptionReason | null {
  const normalizedPrompt = normalizeEvidence(prompt);
  const eligibleDirectory = directory.filter(
    (member) => member.status === undefined || member.status === "active" || member.status === "invited",
  );
  const membersById = new Map(eligibleDirectory.map((member) => [member.id, member]));
  const payerId = proposed.payerMemberId ?? null;
  const splitIds = [...new Set(proposed.splitMemberIds ?? [])];
  const viewerIds = [...new Set(proposed.viewerMemberIds ?? [])];
  const selectedIds = [...new Set(
    [payerId, ...splitIds, ...viewerIds].filter((id): id is string => Boolean(id)),
  )];

  if (selectedIds.some((memberId) => !membersById.has(memberId))) return "member_unavailable";

  // Splitting between every eligible member, with no private viewers, is the default when a request names
  // no one (JOB-080, D-092), so those sharers need no evidence and their names are not being resolved.
  const everyoneShares = viewerIds.length === 0 && eligibleDirectory.length > 0
    && eligibleDirectory.every((member) => splitIds.includes(member.id));
  const resolvedIds = everyoneShares
    ? [...new Set([payerId].filter((id): id is string => Boolean(id)))] : selectedIds;
  const selectedNonActors = resolvedIds
    .filter((memberId) => memberId !== actorMemberId)
    .map((memberId) => membersById.get(memberId)!);
  if (selectedNonActors.some((member) => selectedMemberHasAmbiguousName(member, eligibleDirectory))) {
    return "member_name_ambiguous";
  }

  if (!payerId) return "payer_not_explicit";
  const payer = membersById.get(payerId)!;
  const exactPayerNameAnswer = isExactPayerNameAnswer(options.exactPayerAnswer, payer);
  if (exactPayerNameAnswer && selectedMemberHasAmbiguousName(payer, eligibleDirectory)) {
    return "member_name_ambiguous";
  }
  const exactPayerAnswer = exactPayerNameAnswer;
  if (options.requirePayerEvidence === false) {
    // Continue to participant/viewer validation without enforcing payment prose.
  } else if (payerId === actorMemberId) {
    if (!hasExplicitSelfPayer(normalizedPrompt)) {
      if (selectedMemberHasAmbiguousName(payer, eligibleDirectory)
          && hasExplicitNamedPayer(normalizedPrompt, payer.displayName)) {
        return "member_name_ambiguous";
      }
      if (!hasExplicitNamedPayer(normalizedPrompt, payer.displayName) && !exactPayerAnswer) {
        return "payer_not_explicit";
      }
    }
  } else {
    if (!hasExplicitNamedPayer(normalizedPrompt, payer.displayName) && !exactPayerAnswer) {
      return "payer_not_explicit";
    }
  }

  if (splitIds.length === 0) return "participant_not_explicit";
  if (everyoneShares) return null;
  for (const selectedId of new Set([...splitIds, ...viewerIds])) {
    if (selectedId === actorMemberId) continue;
    const participant = membersById.get(selectedId)!;
    if (exactNameOccurrences(normalizedPrompt, participant.displayName).length === 0) {
      return "participant_not_explicit";
    }
  }
  return null;
}

export function reservationExpenseReviewNotice(locale: Locale): string {
  return localizedCatalog(locale, "reservationReview", {
    en: { notice: "Please confirm the proposed payer and split members before approving. They are a draft interpretation, not confirmation of payment." },
    "zh-HK": { notice: "批准前請確認草稿嘅付款人及分帳成員；呢啲安排係暫定，唔代表已確認付款。" },
    "zh-HK-lihkg": { notice: "批准前請確認草稿嘅付款人及分帳成員；呢啲安排係暫定，唔代表已確認付款。" },
    "ja-JP": { notice: "承認前に支払者と分担メンバーを確認してください。これは仮の割り当てで、支払い済みの確認ではありません。" },
  }).notice;
}

export const reservationClarificationMessages: BaseCatalogs<Record<ReservationExpenseAssumptionReason, string>> = {
  en: {
    payer_not_explicit: "Which trip member paid or will pay for this reservation?",
    member_name_ambiguous: "More than one eligible trip member has that name. Which member do you mean?",
    participant_not_explicit: "Which trip members should share this reservation expense or private event? Please name everyone involved.",
    member_unavailable: "One selected person is unavailable. Which active or invited trip member should be used instead?",
  },
  "zh-HK": {
    payer_not_explicit: "邊位行程成員已經付款或會支付呢筆預訂費用？",
    member_name_ambiguous: "有多於一位合資格行程成員使用相同名稱。你指邊位成員？",
    participant_not_explicit: "邊啲行程成員需要分擔呢筆預訂費用或查看私人活動？請列出所有參與成員。",
    member_unavailable: "其中一位所選人士目前不可用。請指定另一位已啟用或已邀請嘅行程成員。",
  },
  "zh-HK-lihkg": {
    payer_not_explicit: "邊位行程成員已經付款或會支付呢筆預訂費用？",
    member_name_ambiguous: "有多於一位合資格行程成員使用相同名稱。你指邊位成員？",
    participant_not_explicit: "邊啲行程成員需要分擔呢筆預訂費用或查看私人活動？請列出所有參與成員。",
    member_unavailable: "其中一位所選人士目前不可用。請指定另一位已啟用或已邀請嘅行程成員。",
  },
  "ja-JP": {
    payer_not_explicit: "この予約代金を支払った、または支払う予定の旅行メンバーは誰ですか？",
    member_name_ambiguous: "同じ名前の対象メンバーが複数います。どのメンバーを指していますか？",
    participant_not_explicit: "この予約費用を分担する、または非公開の予定を共有する旅行メンバーを全員指定してください。",
    member_unavailable: "対象外のメンバーがいます。代わりに有効または招待済みの旅行メンバーを指定してください。",
  },
};

export function reservationExpenseClarification(
  reason: ReservationExpenseAssumptionReason,
  locale: Locale = "en",
): string {
  return localizedCatalog(locale, "reservationClarification", reservationClarificationMessages)[reason];
}
