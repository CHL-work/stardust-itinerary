import type { Locale } from "@/lib/i18n";
import { isPackLocale, packLocales, packSection, type PackLocale } from "@/lib/locale-packs";
import type { FeedbackAction } from "./contracts";

const en = {
  open: "Feedback / report a bug", heading: "Help improve Stardust", close: "Close", loading: "Checking sign-in…",
  login: "Sign in to a trip to send feedback.", signin: "Sign in", kind: "Type", bug: "Something is broken", feedback: "Suggestion", title: "Short summary", description: "What happened?",
  placeholder: "What happened, and what did you expect? Leave out passwords and booking codes.",
  diagnostics: "Include recent actions (last 10 minutes)", privacy: "Only page names, actions, times and device type. No typed text.",
  preview: "Preview attached actions", empty: "No recent actions recorded.", disclosure: "Reports are reviewed by AI with personal details removed and may become GitHub issues. Originals stay private.",
  policy: "The feedback policy changed. Copy your draft, then refresh.",
  send: "Send feedback", sending: "Saving…", saved: "Feedback saved. Thank you!", receipt: "Report ID", error: "Could not confirm delivery. Retry sends the same report, with no duplicate.", retry: "Retry delivery", reset: "Start another report", rate: "Too many reports. Please wait before retrying.", scope: "Your trip or sign-in changed. Please review your report again before sending.", recent: "My recent feedback", unavailable: "Feedback is unavailable right now. Your draft is kept.",
  queued: "Awaiting review", triaged: "Reviewed", ignored: "No issue planned", published: "Issue created", private: "Private feedback", actions: "Recent actions", page: "Page", action: "Action", time: "Time",
  pages: { today: "Overview", itinerary: "Itinerary", expenses: "Expenses", ai: "AI", requests: "Approvals", settings: "Settings", permissions: "Settings", usage: "Settings", activity: "Activity", login: "Sign-in", join: "Join trip", onboarding: "Account setup", privacy: "Privacy", terms: "Terms", other: "Other page" },
  verbs: { navigate: "View page", event: "Event action", expense: "Expense action", calendar: "Calendar action", ai: "AI action", trip: "Switch trip", member: "Member action", settings: "Settings action", feedback: "Feedback action", error: "Request failed", login: "Sign in", logout: "Sign out", generic: "Button or form action" },
};
type Copy = Omit<typeof en, "pages" | "verbs"> & { pages: Record<keyof typeof en.pages, string>; verbs: Record<keyof typeof en.verbs, string> };
const hk: Copy = {
  open: "意見／回報問題", heading: "幫手改善星塵遠征軍", close: "關閉", loading: "檢查登入狀態…", login: "登入旅程後即可提交意見。", signin: "登入", kind: "類型", bug: "功能有問題", feedback: "改善建議", title: "簡短標題", description: "發生甚麼事？",
  placeholder: "發生了甚麼？你預期應該怎樣？請勿填寫密碼或預約代碼。", diagnostics: "附上最近 10 分鐘的操作", privacy: "只包括頁面名稱、操作、時間及裝置類型，不含輸入文字。", preview: "查看將附上的操作", empty: "暫無操作記錄。", disclosure: "回報會在移除個人資料後由 AI 審閱，並可能建立 GitHub 問題單。原始回報會保持私密。", send: "提交意見", sending: "儲存中…", saved: "意見已儲存，多謝！", receipt: "回報編號", error: "未能確認是否已送出。重試會送出同一份回報，不會重複。", retry: "重試提交", reset: "新增另一份回報", rate: "提交太頻密，請稍後重試。", scope: "旅程或登入身分已改變，請重新檢查後提交。", recent: "我的近期回報", unavailable: "暫時無法提交意見，草稿會保留。", queued: "等待審閱", triaged: "已審閱", ignored: "暫不建立問題單", published: "已建立問題單", private: "私人回報", actions: "近期操作", page: "頁面", action: "操作", time: "時間",
  policy: "回報政策已更新。請先複製草稿，再重新整理。",
  pages: { today: "總覽", itinerary: "行程", expenses: "開支", ai: "AI", requests: "審批", settings: "設定", permissions: "設定", usage: "設定", activity: "活動紀錄", login: "登入", join: "加入旅程", onboarding: "帳戶設定", privacy: "私隱", terms: "條款", other: "其他頁面" },
  verbs: { navigate: "查看頁面", event: "操作活動", expense: "操作開支", calendar: "操作日曆", ai: "操作 AI", trip: "切換旅程", member: "操作成員", settings: "更改設定", feedback: "操作回報", error: "請求失敗", login: "登入", logout: "登出", generic: "按鈕或表單操作" },
};
const spicy: Copy = { ...hk, heading: "幫手捉蟲，執靚星塵遠征軍", description: "邊度出事？", placeholder: "出咗咩事？你預期係點？密碼同預約代碼就唔好貼喇。", saved: "收到，多謝幫手捉蟲！", recent: "我嘅近期回報" };
const ja: Copy = {
  open: "ご意見・不具合報告", heading: "Stardust の改善に協力", close: "閉じる", loading: "ログインを確認中…", login: "旅行にログインすると報告できます。", signin: "ログイン", kind: "種類", bug: "不具合", feedback: "改善案", title: "短い概要", description: "何が起きましたか？", placeholder: "何が起き、どうなるはずでしたか？パスワードや予約コードは入力しないでください。", diagnostics: "直近 10 分の操作を添付", privacy: "ページ名、操作、時刻、端末の種類のみ。入力内容は含みません。", preview: "添付する操作を確認", empty: "最近の操作はありません。", disclosure: "報告は個人情報を除いてAIが確認し、GitHub の課題になる場合があります。元の報告は非公開のままです。", send: "送信", sending: "保存中…", saved: "保存しました。ありがとうございます！", receipt: "報告 ID", error: "送信を確認できませんでした。再試行しても同じ報告として送られ、重複しません。", retry: "再送信", reset: "別の報告を作成", rate: "送信回数が多すぎます。しばらくしてから再試行してください。", scope: "旅行またはログインが変わりました。内容を再確認してください。", recent: "自分の最近の報告", unavailable: "現在報告できません。下書きは保持されます。", queued: "確認待ち", triaged: "確認済み", ignored: "Issue 作成なし", published: "Issue 作成済み", private: "非公開の報告", actions: "最近の操作", page: "ページ", action: "操作", time: "時刻",
  policy: "報告のポリシーが変わりました。下書きをコピーしてから再読み込みしてください。",
  pages: { today: "概要", itinerary: "日程", expenses: "支出", ai: "AI", requests: "承認", settings: "設定", permissions: "設定", usage: "設定", activity: "操作履歴", login: "ログイン", join: "旅行に参加", onboarding: "アカウント設定", privacy: "プライバシー", terms: "規約", other: "その他" },
  verbs: { navigate: "ページを表示", event: "予定の操作", expense: "支出の操作", calendar: "カレンダーの操作", ai: "AI の操作", trip: "旅行を切り替え", member: "メンバーの操作", settings: "設定の変更", feedback: "報告の操作", error: "リクエスト失敗", login: "ログイン", logout: "ログアウト", generic: "ボタン・フォーム操作" },
};
export const feedbackCopy: Record<Locale, Copy> = {
  en, "zh-HK": hk, "zh-HK-lihkg": spicy, "ja-JP": ja,
  ...Object.fromEntries(packLocales.map((locale) => [locale, packSection(locale, "feedback", en)])) as Record<PackLocale, Copy>,
};
const actionNames: Record<FeedbackAction, readonly [string, string, string]> = {
  navigate: ["View page", "查看頁面", "ページを表示"], page_view: ["View page", "查看頁面", "ページを表示"],
  dialog_open: ["Open dialog", "開啟視窗", "ダイアログを開く"], dialog_close: ["Close dialog", "關閉視窗", "ダイアログを閉じる"],
  event_open: ["Open event editor", "開啟活動編輯器", "予定の編集を開く"], event_edit: ["Edit event", "編輯活動", "予定を編集"], event_save: ["Save event", "儲存活動", "予定を保存"],
  event_cancel: ["Cancel / restore event", "取消／恢復活動", "予定を取消・復元"], event_remove: ["Remove event", "移除活動", "予定を削除"], event_approve: ["Approve event", "批准活動", "予定を承認"], event_reject: ["Reject event", "拒絕活動", "予定を却下"],
  expense_open: ["Open expense editor", "開啟開支編輯器", "支出の編集を開く"], expense_edit: ["Edit expense", "編輯開支", "支出を編集"], expense_save: ["Save expense", "儲存開支", "支出を保存"], expense_review: ["Review expense", "審閱開支", "支出を確認"], expense_approve: ["Approve expense", "批准開支", "支出を承認"], expense_reject: ["Reject expense", "拒絕開支", "支出を却下"],
  repayment_submit: ["Record repayment", "記錄還款", "返済を記録"], calendar_connect: ["Connect Calendar", "連接日曆", "カレンダーを接続"], calendar_sync: ["Sync Calendar", "同步日曆", "カレンダーを同期"], calendar_refresh: ["Refresh Calendar", "重新載入日曆", "カレンダーを更新"],
  ai_submit: ["Send AI request", "提交 AI 問題", "AI に送信"], ai_complete: ["AI request completed", "AI 已完成回覆", "AI の回答完了"], ai_error: ["AI request failed", "AI 請求失敗", "AI のリクエスト失敗"], ai_new: ["New AI conversation", "新增 AI 對話", "新しい AI 会話"], ai_resume: ["Resume AI conversation", "繼續 AI 對話", "AI 会話を再開"],
  trip_switch: ["Switch trip", "切換旅程", "旅行を切り替え"], request_error: ["Request failed", "請求失敗", "リクエスト失敗"], client_error: ["Browser error", "瀏覽器錯誤", "ブラウザーのエラー"],
  feedback_open: ["Open feedback", "開啟意見回報", "報告を開く"], feedback_submit: ["Submit feedback", "提交意見回報", "報告を送信"], feedback_retry: ["Retry feedback", "重試意見回報", "報告を再送信"],
  login: ["Sign in", "登入", "ログイン"], logout: ["Sign out", "登出", "ログアウト"], form_submit: ["Submit form", "提交表單", "フォームを送信"], locale_change: ["Change language", "切換語言", "言語を変更"],
  settings_save: ["Save settings", "儲存設定", "設定を保存"], member_invite: ["Member invitation", "操作成員邀請", "メンバー招待"], member_change: ["Manage member", "管理成員", "メンバーを管理"], button: ["Button / link action", "按鈕／連結操作", "ボタン・リンク操作"],
};
const environmentNames: Record<string, readonly [string, string, string]> = { phone: ["Phone", "電話", "スマートフォン"], tablet: ["Tablet", "平板電腦", "タブレット"], desktop: ["Computer", "電腦", "パソコン"], unknown: ["Unknown", "未能辨識", "不明"], other: ["Other", "其他", "その他"] };
/** English action and device names: the added languages' packs translate these (JOB-084). */
export const englishFeedbackActionNames = Object.fromEntries(Object.entries(actionNames).map(([key, names]) => [key, names[0]])) as Record<FeedbackAction, string>;
export const englishFeedbackEnvironmentNames: Record<string, string> = Object.fromEntries(Object.entries(environmentNames).map(([key, names]) => [key, names[0]]));
function baseName(names: readonly [string, string, string], locale: Locale): string {
  return names[locale === "en" ? 0 : locale === "ja-JP" ? 2 : 1];
}
export function feedbackActionLabel(action: string, locale: Locale): string {
  const exact = Object.hasOwn(actionNames, action) ? actionNames[action as FeedbackAction] : undefined;
  if (exact) return isPackLocale(locale) ? packSection(locale, "feedbackActions", englishFeedbackActionNames)[action as FeedbackAction] : baseName(exact, locale);
  const verbs = feedbackCopy[locale].verbs;
  if (action.includes("error")) return verbs.error;
  if (action === "navigate" || action === "page_view") return verbs.navigate;
  if (action === "login" || action === "logout") return verbs[action];
  for (const key of ["event", "expense", "calendar", "ai", "trip", "member", "settings", "feedback"] as const) if (action.startsWith(`${key}_`) || action.endsWith(`_${key}`)) return verbs[key];
  return verbs.generic;
}
export function feedbackEnvironmentLabel(value: string, locale: Locale): string {
  const translated = Object.hasOwn(environmentNames, value) ? environmentNames[value] : undefined;
  if (translated) return isPackLocale(locale) ? packSection(locale, "feedbackEnvironment", englishFeedbackEnvironmentNames)[value] ?? translated[0] : baseName(translated, locale);
  return ({ ios: "iOS", macos: "macOS", android: "Android", windows: "Windows", linux: "Linux", chrome: "Chrome", edge: "Edge", firefox: "Firefox", safari: "Safari" } as Record<string, string>)[value] ?? feedbackCopy[locale].pages.other;
}
