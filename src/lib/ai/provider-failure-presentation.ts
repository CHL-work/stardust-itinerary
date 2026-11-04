import { parseAiProviderFailureDetails } from "@/lib/ai/provider-failure";
import { formatMessage, type Locale } from "@/lib/i18n";

const english = {
  provider: "The AI provider",
  AI_PROVIDER_RATE_LIMITED: "{provider} has reached a usage or rate limit.",
  AI_PROVIDER_AUTH_REQUIRED: "{provider} needs its connection renewed by the owner. This is separate from your Google sign-in session.",
  AI_PROVIDER_BILLING: "{provider} rejected the request because of its account billing or credit settings.",
  AI_PROVIDER_MODEL_UNAVAILABLE: "{provider} cannot use the selected model for this request.",
  AI_PROVIDER_UNAVAILABLE: "{provider} is temporarily unavailable.",
  AI_PROVIDER_OUTPUT_INVALID: "{provider} did not return a usable answer for this request.",
  reset: "Provider-reported reset estimate: {time} ({timeZone}). Availability at that time is not guaranteed.",
  owner: "Wait, or manually choose another allowed model for a new request.",
  ownerAccount: "Check the provider connection or account settings, or manually choose another allowed model for a new request.",
  member: "Wait or ask the trip owner for help. Members cannot change their assigned model.",
  unchanged: "Your selected model has not changed. This request was not automatically sent again.",
};
type FailureCopy = { [K in keyof typeof english]: string };
const cantonese: FailureCopy = {
  provider: "AI 供應商",
  AI_PROVIDER_RATE_LIMITED: "{provider} 已達用量或請求頻率上限。",
  AI_PROVIDER_AUTH_REQUIRED: "{provider} 需要管理員重新連接。這與你的 Google 登入狀態無關。",
  AI_PROVIDER_BILLING: "{provider} 因帳戶付款或額度設定而拒絕此請求。",
  AI_PROVIDER_MODEL_UNAVAILABLE: "{provider} 目前未能以所選模型處理此請求。",
  AI_PROVIDER_UNAVAILABLE: "{provider} 暫時無法使用。",
  AI_PROVIDER_OUTPUT_INVALID: "{provider} 未有為此請求傳回可用的答案。",
  reset: "供應商提供的預計重設時間：{time}（{timeZone}）。不保證屆時一定可以使用。",
  owner: "你可以等候，或手動選擇其他允許使用的模型，再提出新請求。",
  ownerAccount: "請檢查供應商連接或帳戶設定，或手動選擇其他允許使用的模型，再提出新請求。",
  member: "請等候或聯絡旅程管理員。成員不能更改獲分配的模型。",
  unchanged: "所選模型沒有改變，系統沒有自動重新傳送此請求。",
};
const japanese: FailureCopy = {
  provider: "AIプロバイダー",
  AI_PROVIDER_RATE_LIMITED: "{provider}の利用量またはリクエスト頻度の上限に達しました。",
  AI_PROVIDER_AUTH_REQUIRED: "{provider}の接続をオーナーが更新する必要があります。Googleログインのセッションとは別の問題です。",
  AI_PROVIDER_BILLING: "{provider}のアカウントの請求またはクレジット設定により、リクエストが拒否されました。",
  AI_PROVIDER_MODEL_UNAVAILABLE: "{provider}は、このリクエストで選択されたモデルを利用できません。",
  AI_PROVIDER_UNAVAILABLE: "{provider}は一時的に利用できません。",
  AI_PROVIDER_OUTPUT_INVALID: "{provider}から、このリクエストに利用できる回答が返されませんでした。",
  reset: "プロバイダーによるリセット予定時刻：{time}（{timeZone}）。その時刻の利用再開は保証されません。",
  owner: "しばらく待つか、許可された別のモデルを手動で選び、新しいリクエストを送信してください。",
  ownerAccount: "プロバイダーの接続やアカウント設定を確認するか、許可された別のモデルを手動で選び、新しいリクエストを送信してください。",
  member: "しばらく待つか、旅行オーナーにお問い合わせください。メンバーは割り当てられたモデルを変更できません。",
  unchanged: "選択したモデルは変更していません。このリクエストは自動再送信していません。",
};

export type AiFailurePresentationOptions = { locale: Locale; timeZone: string; isOwner: boolean };
export function aiProviderFailureCopy(locale: Locale): FailureCopy {
  return locale === "ja-JP" ? japanese : locale === "zh-HK" || locale === "zh-HK-lihkg" ? cantonese : english;
}

/** Only fixed categories and validated metadata are rendered, never provider diagnostics. */
export function aiProviderFailureMessage(failure: { errorCode?: string | null; providerFailure?: unknown }, options: AiFailurePresentationOptions): string | null {
  const copy = aiProviderFailureCopy(options.locale);
  const code = failure.errorCode;
  if (!code || !Object.prototype.hasOwnProperty.call(english, code) || !code.startsWith("AI_PROVIDER_")) return null;
  const parsed = parseAiProviderFailureDetails(failure.providerFailure);
  const details = parsed?.code === code ? parsed : null;
  const provider = details?.provider === "anthropic" ? "Anthropic (Claude)" : details?.provider === "openai" ? "OpenAI"
    : details?.provider === "google" ? "Google (Gemini)" : copy.provider;
  const reason = formatMessage(copy[code as keyof FailureCopy], { provider });
  let reset: string | null = null;
  if (code === "AI_PROVIDER_RATE_LIMITED" && details?.retryAt) {
    try {
      const time = new Intl.DateTimeFormat(options.locale === "zh-HK-lihkg" ? "zh-HK" : options.locale, {
        timeZone: options.timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      }).format(new Date(details.retryAt));
      reset = formatMessage(copy.reset, { time, timeZone: options.timeZone });
    } catch { /* Invalid display zones/dates must not hide the safe provider reason. */ }
  }
  const guidance = !options.isOwner ? copy.member
    : code === "AI_PROVIDER_AUTH_REQUIRED" || code === "AI_PROVIDER_BILLING" ? copy.ownerAccount : copy.owner;
  return [reason, reset, guidance, copy.unchanged].filter(Boolean).join("\n\n");
}
