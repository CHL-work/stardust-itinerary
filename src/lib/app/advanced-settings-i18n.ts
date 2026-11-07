import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

const en = {
  advanced: "Advanced settings",
  description: "AI access, member permissions, activity and status.",
  memberDescription: "Your AI access and usage allowance.",
  permissions: "Member permissions",
  permissionsDescription: "Choose what members can change and what needs approval.",
  googleIdentity: "Google sign-in", linked: "Linked", unlinked: "Not linked",
  unbind: "Unbind Google identity", invite: "Create invitation link", invitation: "One-time invitation link",
  editItinerary: "Can edit itinerary", itineraryApproval: "Event edits require owner approval",
  editExpenses: "Can add and edit expenses", expenseApproval: "Expense edits require owner approval", syncCalendar: "Can sync Google Calendar",
  noMembers: "No eligible members to configure.",
  usage: "AI usage", usageDescription: "AI requests and usage for this trip.",
  requestsToday: "Requests today", inputTokens: "Logged input tokens", outputTokensOne: "{count} output token", outputTokens: "{count} output tokens",
  outcomes: "Request outcomes", succeededCount: "{count} succeeded", otherOutcomes: "{failed} failed · {rejected} rejected",
  effectiveModel: "Effective model", recentEntriesOne: "{count} recent log entry", recentEntries: "{count} recent log entries", requestLog: "AI request log",
  requestLogDescription: "Only trip owners can see this log.",
  prompt: "Prompt", result: "Result", provider: "Provider", transport: "Connection", billing: "Usage basis",
  unknown: "Unknown", tokensAndLatency: "{input} input / {output} output tokens · {latency} ms",
  noLogs: "No recent AI requests.", refresh: "Refresh", started: "Running", succeeded: "Succeeded", failed: "Failed", rejected: "Rejected",
};
type Copy = { [K in keyof typeof en]: string };
const zh: Copy = {
  advanced: "進階設定",
  description: "AI 存取、成員權限、活動紀錄及狀態。",
  memberDescription: "你的 AI 使用權及可用次數。",
  permissions: "成員權限",
  permissionsDescription: "選擇成員可以更改甚麼，以及哪些需要批准。",
  googleIdentity: "Google 登入", linked: "已連結", unlinked: "未連結",
  unbind: "解除 Google 身份連結", invite: "建立邀請連結", invitation: "一次性邀請連結",
  editItinerary: "可編輯行程", itineraryApproval: "活動更改需要管理員審批",
  editExpenses: "可新增及編輯開支", expenseApproval: "開支更改需要管理員審批", syncCalendar: "可同步 Google 日曆",
  noMembers: "目前沒有可設定權限的成員。",
  usage: "AI 用量", usageDescription: "此旅程的 AI 請求及用量。",
  requestsToday: "今日請求次數", inputTokens: "已記錄輸入 token", outputTokensOne: "{count} 輸出 token", outputTokens: "{count} 輸出 token",
  outcomes: "請求結果", succeededCount: "{count} 次成功", otherOutcomes: "{failed} 次失敗 · {rejected} 次被拒",
  effectiveModel: "實際模型", recentEntriesOne: "最近 {count} 項記錄", recentEntries: "最近 {count} 項記錄", requestLog: "AI 請求記錄",
  requestLogDescription: "只有旅程管理員可查看此記錄。",
  prompt: "問題", result: "回覆", provider: "供應商", transport: "連線方式", billing: "用量類別",
  unknown: "未知", tokensAndLatency: "{input} 輸入／{output} 輸出 token · {latency} 毫秒",
  noLogs: "目前沒有最近的 AI 請求。", refresh: "重新整理", started: "處理中", succeeded: "成功", failed: "失敗", rejected: "已拒絕",
};
const ja: Copy = {
  advanced: "詳細設定",
  description: "AIの利用、メンバーの権限、操作履歴、状態。",
  memberDescription: "自分の AI 利用権限と利用可能回数。",
  permissions: "メンバーの権限",
  permissionsDescription: "メンバーが変更できる内容と、承認が必要な内容を選びます。",
  googleIdentity: "Google ログイン", linked: "連携済み", unlinked: "未連携",
  unbind: "Google アカウント連携を解除", invite: "招待リンクを作成", invitation: "1 回限りの招待リンク",
  editItinerary: "旅程を編集できる", itineraryApproval: "予定の変更に管理者の承認が必要",
  editExpenses: "費用を追加・編集できる", expenseApproval: "費用の変更に管理者の承認が必要", syncCalendar: "Google カレンダーと同期できる",
  noMembers: "権限を設定できるメンバーはいません。",
  usage: "AI利用状況", usageDescription: "この旅行のAIリクエストと使用量。",
  requestsToday: "今日のリクエスト", inputTokens: "記録済み入力トークン", outputTokensOne: "出力 {count} トークン", outputTokens: "出力 {count} トークン",
  outcomes: "リクエスト結果", succeededCount: "成功 {count} 件", otherOutcomes: "失敗 {failed} 件 · 拒否 {rejected} 件",
  effectiveModel: "実際のモデル", recentEntriesOne: "直近 {count} 件の記録", recentEntries: "直近 {count} 件の記録", requestLog: "AI リクエスト履歴",
  requestLogDescription: "このログは旅行のオーナーだけが見られます。",
  prompt: "質問", result: "回答", provider: "プロバイダー", transport: "接続方式", billing: "使用区分",
  unknown: "不明", tokensAndLatency: "入力 {input}／出力 {output} トークン · {latency} ms",
  noLogs: "最近の AI リクエストはありません。", refresh: "再読み込み", started: "処理中", succeeded: "成功", failed: "失敗", rejected: "拒否",
};

export function advancedSettingsMessages(locale: Locale): Copy {
  return localizedCatalog(locale, "advancedSettings", { en, "zh-HK": zh, "ja-JP": ja });
}

export function advancedRequestStatus(status: string, locale: Locale): string {
  const copy = advancedSettingsMessages(locale);
  return status === "started" || status === "succeeded" || status === "failed" || status === "rejected"
    ? copy[status] : copy.unknown;
}
