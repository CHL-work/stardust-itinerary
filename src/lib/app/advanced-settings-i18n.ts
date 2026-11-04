import type { Locale } from "@/lib/i18n";

const en = {
  advanced: "Advanced settings",
  description: "AI access, member permissions, activity and operational details. Open only when needed.",
  memberDescription: "Your AI access and usage allowance.",
  permissions: "Member permissions",
  permissionsDescription: "Editors can update visible events. The owner controls whether event and expense changes require approval. Permission changes are recorded.",
  googleIdentity: "Google sign-in", linked: "Linked", unlinked: "Not linked",
  unbind: "Unbind Google identity", invite: "Create invitation link", invitation: "One-time invitation link",
  editItinerary: "Can edit itinerary", itineraryApproval: "Event edits require owner approval",
  editExpenses: "Can add and edit expenses", expenseApproval: "Expense edits require owner approval", syncCalendar: "Can sync Google Calendar",
  noMembers: "No eligible members to configure.",
  usage: "AI usage", usageDescription: "Owner-only request history and recorded usage. These figures do not replace the provider's account limits or billing records.",
  requestsToday: "Requests today", inputTokens: "Logged input tokens", outputTokens: "{count} output tokens",
  outcomes: "Request outcomes", succeededCount: "{count} succeeded", otherOutcomes: "{failed} failed · {rejected} rejected",
  effectiveModel: "Effective model", recentEntries: "{count} recent log entries", requestLog: "AI request log",
  requestLogDescription: "Prompts, results, token counts and latency are visible only to trip owners under the existing audit policy.",
  prompt: "Prompt", result: "Result", provider: "Provider", transport: "Connection", billing: "Usage basis",
  unknown: "Unknown", tokensAndLatency: "{input} input / {output} output tokens · {latency} ms",
  noLogs: "No recent AI requests.", refresh: "Refresh", started: "Running", succeeded: "Succeeded", failed: "Failed", rejected: "Rejected",
};
type Copy = { [K in keyof typeof en]: string };
const zh: Copy = {
  advanced: "進階設定",
  description: "AI 使用權、成員權限、活動記錄及運作詳情。有需要時才展開。",
  memberDescription: "你的 AI 使用權及可用次數。",
  permissions: "成員權限",
  permissionsDescription: "編輯者可以修改有權查看的活動。管理員可設定活動及開支更改是否需要審批；權限更改會被記錄。",
  googleIdentity: "Google 登入", linked: "已連結", unlinked: "未連結",
  unbind: "解除 Google 身份連結", invite: "建立邀請連結", invitation: "一次性邀請連結",
  editItinerary: "可編輯行程", itineraryApproval: "活動更改需要管理員審批",
  editExpenses: "可新增及編輯開支", expenseApproval: "開支更改需要管理員審批", syncCalendar: "可同步 Google 日曆",
  noMembers: "目前沒有可設定權限的成員。",
  usage: "AI 用量", usageDescription: "僅管理員可查看的請求歷史及已記錄用量；這些數字不能取代供應商的帳戶限制或帳單記錄。",
  requestsToday: "今日請求次數", inputTokens: "已記錄輸入 token", outputTokens: "{count} 輸出 token",
  outcomes: "請求結果", succeededCount: "{count} 次成功", otherOutcomes: "{failed} 次失敗 · {rejected} 次被拒",
  effectiveModel: "實際模型", recentEntries: "最近 {count} 項記錄", requestLog: "AI 請求記錄",
  requestLogDescription: "問題、回覆、token 數量及處理時間按現有審計政策，只供旅程管理員查看。",
  prompt: "問題", result: "回覆", provider: "供應商", transport: "連線方式", billing: "用量類別",
  unknown: "未知", tokensAndLatency: "{input} 輸入／{output} 輸出 token · {latency} 毫秒",
  noLogs: "目前沒有最近的 AI 請求。", refresh: "重新整理", started: "處理中", succeeded: "成功", failed: "失敗", rejected: "已拒絕",
};
const ja: Copy = {
  advanced: "詳細設定",
  description: "AI 利用権限、メンバー権限、操作履歴と稼働状況。必要なときに開いてください。",
  memberDescription: "自分の AI 利用権限と利用可能回数。",
  permissions: "メンバーの権限",
  permissionsDescription: "編集者は閲覧できる予定を編集できます。管理者は予定・費用の変更に承認が必要か設定できます。権限の変更は記録されます。",
  googleIdentity: "Google ログイン", linked: "連携済み", unlinked: "未連携",
  unbind: "Google アカウント連携を解除", invite: "招待リンクを作成", invitation: "1 回限りの招待リンク",
  editItinerary: "旅程を編集できる", itineraryApproval: "予定の変更に管理者の承認が必要",
  editExpenses: "費用を追加・編集できる", expenseApproval: "費用の変更に管理者の承認が必要", syncCalendar: "Google カレンダーと同期できる",
  noMembers: "権限を設定できるメンバーはいません。",
  usage: "AI利用状況", usageDescription: "管理者のみが閲覧できるリクエスト履歴と記録済みの使用量です。プロバイダーの利用制限や請求記録を置き換えるものではありません。",
  requestsToday: "今日のリクエスト", inputTokens: "記録済み入力トークン", outputTokens: "出力 {count} トークン",
  outcomes: "リクエスト結果", succeededCount: "成功 {count} 件", otherOutcomes: "失敗 {failed} 件 · 拒否 {rejected} 件",
  effectiveModel: "実際のモデル", recentEntries: "直近 {count} 件の記録", requestLog: "AI リクエスト履歴",
  requestLogDescription: "既存の監査方針に基づき、質問、回答、トークン数と処理時間は旅行の管理者のみが閲覧できます。",
  prompt: "質問", result: "回答", provider: "プロバイダー", transport: "接続方式", billing: "使用区分",
  unknown: "不明", tokensAndLatency: "入力 {input}／出力 {output} トークン · {latency} ms",
  noLogs: "最近の AI リクエストはありません。", refresh: "再読み込み", started: "処理中", succeeded: "成功", failed: "失敗", rejected: "拒否",
};

export function advancedSettingsMessages(locale: Locale): Copy {
  return locale === "ja-JP" ? ja : locale === "en" ? en : zh;
}

export function advancedRequestStatus(status: string, locale: Locale): string {
  const copy = advancedSettingsMessages(locale);
  return status === "started" || status === "succeeded" || status === "failed" || status === "rejected"
    ? copy[status] : copy.unknown;
}
