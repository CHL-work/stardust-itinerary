import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

/** The feedback review panel's copy for the app operator (moved from the component in JOB-084). */
const words = {
  en: { heading: "Feedback review · app operator", detail: "Private reports, reviewed daily and sent as GitHub issues.", refresh: "Load / refresh status", loading: "Loading…", error: "Status unavailable. Try again.", denied: "Only the app operator can review reports.", review: "Daily review", publishing: "GitHub issue delivery", configured: "Configured", missing: "Not configured", pending: "Reports waiting", queued: "Issues queued", uncertain: "Delivery needs review", blocked: "Blocked deliveries", published: "Issues published", last: "Last daily review", never: "Not run yet", empty: "No feedback yet.", config: "Set up on the host. Credentials are never shown here." },
  "zh-HK": { heading: "意見審閱 · 應用程式營運者", detail: "私人回報，每日審閱並發佈為 GitHub 問題單。", refresh: "載入／更新狀態", loading: "載入中…", error: "暫時無法載入，請重試。", denied: "只有應用程式營運者可審閱回報。", review: "每日審閱", publishing: "GitHub 問題單發佈", configured: "已設定", missing: "未設定", pending: "待審回報", queued: "待發佈問題單", uncertain: "需要確認送達狀態", blocked: "發佈受阻", published: "已發佈問題單", last: "最近每日審閱", never: "尚未執行", empty: "暫無回報。", config: "在主機設定；此頁不會顯示憑證。" },
  "ja-JP": { heading: "報告の確認 · アプリ運営者", detail: "非公開の報告を毎日確認し、GitHub Issue として作成します。", refresh: "状態を読み込み・更新", loading: "読み込み中…", error: "読み込めません。再試行してください。", denied: "報告を確認できるのはアプリ運営者のみです。", review: "毎日の確認", publishing: "GitHub Issue の配信", configured: "設定済み", missing: "未設定", pending: "確認待ちの報告", queued: "配信待ちの Issue", uncertain: "配信状態の確認が必要", blocked: "配信停止", published: "作成済み Issue", last: "最後の確認", never: "未実行", empty: "報告はまだありません。", config: "ホストで設定します。認証情報はここに表示されません。" },
};

export function feedbackOperationsCopy(locale: Locale): (typeof words)["en"] {
  return localizedCatalog(locale, "feedbackOperations", words);
}
