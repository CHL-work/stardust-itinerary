import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";
const english = {
  event: "Event", expense: "Expense", create: "Add", update: "Update", cancel: "Cancel", restore: "Restore", void: "Void", change: "Change",
  date: "Date", starts: "Starts", ends: "Ends", departure: "Departure", arrival: "Arrival", untimed: "Time not set",
  location: "Location", notes: "Notes", audience: "Shared with", tripVisible: "Visible to the trip", locked: "Owner locked",
  total: "Total", payer: "Paid by", shares: "Expense shares", linkedExpense: "Linked expense", linkedEvent: "Linked to an event",
  memberUnavailable: "Former or unavailable member", submitted: "Submitted", source: "Source", proposalVersion: "Proposal version", baseRevision: "Based on revision",
  owner: "Owner", member: "Member", ai: "AI", import: "Import", reason: "Reason", reviewNote: "Review note",
  unavailable: "Details are incomplete, so this cannot be approved here.",
  memberRemoved: "A linked member was removed, so this cannot be reviewed.",
  historical: "Saved request details — later changes to the event or expense are not shown here.",
};
export type ApprovalMessages = { [K in keyof typeof english]: string };
const cantonese: ApprovalMessages = {
  event: "活動", expense: "開支", create: "新增", update: "更新", cancel: "取消", restore: "恢復", void: "作廢", change: "變更",
  date: "日期", starts: "開始", ends: "結束", departure: "出發", arrival: "抵達", untimed: "未設定時間",
  location: "地點", notes: "備註", audience: "分享對象", tripVisible: "全團可見", locked: "管理員已鎖定",
  total: "總額", payer: "付款人", shares: "分帳金額", linkedExpense: "相關開支", linkedEvent: "已連結至活動",
  memberUnavailable: "已離團或無法取得的成員", submitted: "提交時間", source: "來源", proposalVersion: "提案版本", baseRevision: "基於資料版本",
  owner: "管理員", member: "成員", ai: "AI", import: "匯入", reason: "原因", reviewNote: "審批備註",
  unavailable: "資料不完整，無法在此審批。",
  memberRemoved: "相關成員已被移除，因此無法審批。",
  historical: "這是提交時的申請資料，不包括活動或開支之後的變更。",
};
const japanese: ApprovalMessages = {
  event: "予定", expense: "費用", create: "追加", update: "更新", cancel: "キャンセル", restore: "復元", void: "無効化", change: "変更",
  date: "日付", starts: "開始", ends: "終了", departure: "出発", arrival: "到着", untimed: "時刻未設定",
  location: "場所", notes: "メモ", audience: "共有するメンバー", tripVisible: "旅行の全員に公開", locked: "管理者がロック中",
  total: "合計", payer: "支払った人", shares: "各自の負担額", linkedExpense: "関連費用", linkedEvent: "予定に関連付け済み",
  memberUnavailable: "退会済みまたは確認できないメンバー", submitted: "送信日時", source: "作成元", proposalVersion: "提案バージョン", baseRevision: "元のデータバージョン",
  owner: "管理者", member: "メンバー", ai: "AI", import: "インポート", reason: "理由", reviewNote: "確認メモ",
  unavailable: "詳細が不完全なため、ここでは承認できません。",
  memberRemoved: "関係するメンバーが削除されたため、承認できません。",
  historical: "送信時の申請内容です。その後の予定・費用の変更は表示されません。",
};
export function approvalMessages(locale: Locale): ApprovalMessages {
  return localizedCatalog(locale, "approval", { en: english, "zh-HK": cantonese, "ja-JP": japanese });
}
