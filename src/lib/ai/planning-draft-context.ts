import type { PlanningDraft } from "@/lib/ai/planning-draft";
import type { Locale } from "@/lib/i18n";
import { requestedRelativeDate } from "@/lib/ai/relative-date";

/** Keep relative dates tied to the user submission that introduced them. */
export function anchorPlanningDraft(draft: PlanningDraft): PlanningDraft {
  return {
    ...draft,
    userRequests: draft.userRequests.map((request) => ({
      ...request,
      content: request.content
        .replace(/\btomorrow\b|聽日|听日|明天|明日/giu, (word) => request.referenceTime?.tomorrowLocalDate ?? word)
        .replace(/\b(?:today|tonight)\b|今日|今天|本日|今晩|今晚/giu, (word) => request.referenceTime?.tripLocalDate ?? word),
    })),
  };
}

export function planningDraftEvidence(draft: PlanningDraft | null, current: string): string {
  return [...(draft?.userRequests.map((request) => request.content) ?? []), current]
    .join("\n<user-clarification-boundary>\n");
}

export function hasPayerClarification(prompt: string): boolean {
  return /\b(?:pay|paid|payer|paying)\b|付款|支付|埋單|買單|买单|找數|找数|支払|払った|払います/iu.test(prompt);
}

export function previousDraftRelativeDate(draft: PlanningDraft | null, current: string): string | null {
  if (!draft || /\d{4}[-/]\d|\b\d{1,2}[/-]\d{1,2}\b|\d{1,2}月\d{1,2}日|\b(?:date|check.?in|check.?out|tomorrow|today|tonight)\b|日期|入住|退房|聽日|听日|明天|明日|今日|今天|本日|今晩|今晚/iu.test(current)) return null;
  for (const request of [...draft.userRequests].reverse()) {
    // A batch spanning multiple relative days has no one date to enforce on
    // every proposal; its individually anchored source still goes to the model.
    if (/\b(?:today|tonight)\b|今日|今天|本日|今晩|今晚/iu.test(request.content)
        && /\btomorrow\b|聽日|听日|明天|明日/iu.test(request.content)) return null;
    const normalized = request.content.replace(/\btonight\b|今天|本日|今晩|今晚/giu, "today")
      .replace(/听日|明天/gu, "tomorrow");
    const date = requestedRelativeDate(normalized, request.referenceTime ?? {});
    if (date) return date;
  }
  return null;
}

export function detachedPlanningClarification(locale: Locale): string {
  return {
    en: "There is no unfinished create request to attach this answer to. If the item was already proposed, review that pending item; otherwise tell me what new event or expense you want to create.",
    "zh-HK": "而家冇未完成嘅新增要求可以接住呢個答案。如果之前已經建立待批項目，請查看嗰個項目；否則請話我知要新增邊個活動或開支。",
    "zh-HK-lihkg": "而家冇未完成嘅新增要求可以接住呢個答案。如果之前已經建立待批項目，請查看嗰個項目；否則請話我知要新增邊個活動或開支。",
    "ja-JP": "この回答を追加できる未完了の新規作成リクエストはありません。すでに提案済みなら承認待ちの項目を確認してください。そうでなければ、新しく作成する予定や費用を教えてください。",
  }[locale];
}
