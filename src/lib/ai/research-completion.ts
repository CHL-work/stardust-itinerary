import { aiProviderFailureMessage } from "@/lib/ai/provider-failure-presentation";
import type { AiProviderFailureDetails } from "@/lib/ai/provider-failure";
import type { Locale } from "@/lib/i18n";

export type ResearchCompletionFailure = "budget_exhausted" | "timeout" | "additional_research" | "provider_failed" | "failed";

const copy = {
  en: {
    budget_exhausted: "There was not enough time left to finish the final answer. Please try again; no trip changes were saved.",
    timeout: "Preparing the final answer timed out. Please try again; no trip changes were saved.",
    additional_research: "The AI requested another research round instead of finishing the answer. Please try a more focused question; no trip changes were saved.",
    failed: "The final answer could not be completed. Please try again; no trip changes were saved.",
  },
  "zh-HK": {
    budget_exhausted: "餘下時間不足以整理最後答案。請再試一次；今次沒有儲存任何旅程變更。",
    timeout: "整理最後答案時超時。請再試一次；今次沒有儲存任何旅程變更。",
    additional_research: "AI 未有完成答案，而是要求再做一輪搜尋。請把問題收窄後再試；今次沒有儲存任何旅程變更。",
    failed: "未能完成最後答案。請再試一次；今次沒有儲存任何旅程變更。",
  },
  "ja-JP": {
    budget_exhausted: "最終回答をまとめる時間が足りませんでした。もう一度お試しください。旅行の変更は保存していません。",
    timeout: "最終回答の作成がタイムアウトしました。もう一度お試しください。旅行の変更は保存していません。",
    additional_research: "AIが回答を完了せず、追加の検索を要求しました。質問を絞ってお試しください。旅行の変更は保存していません。",
    failed: "最終回答を完成できませんでした。もう一度お試しください。旅行の変更は保存していません。",
  },
} as const;

/** A final-answer failure is not proof that research failed or a venue is closed. */
export function researchCompletionNotice(reason: ResearchCompletionFailure, options: {
  locale: Locale; timeZone: string; isOwner: boolean; providerFailure?: AiProviderFailureDetails | null;
}): string {
  if (options.providerFailure) {
    const provider = aiProviderFailureMessage({ errorCode: options.providerFailure.code, providerFailure: options.providerFailure }, options);
    if (provider) return provider;
  }
  const language = options.locale === "en" ? "en" : options.locale === "ja-JP" ? "ja-JP" : "zh-HK";
  return copy[language][reason === "provider_failed" ? "failed" : reason];
}
