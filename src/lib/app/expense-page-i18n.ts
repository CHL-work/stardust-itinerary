import type { Locale } from "@/lib/i18n";

const en = {
  title: "Trip expenses", subtitle: "Your costs across the whole trip", history: "Expenses by date",
  myDayTotal: "My spending", currentDay: "Today", count: "{count} expenses", noExpenses: "No expenses for this day.",
  payerAndShare: "Paid by {payer} · my share {amount}", linkedEvent: "Event: {title}", extra: "Extra expense",
  add: "Add expense", edit: "Edit expense", save: "Save expense", approval: "Request approval", cancel: "Cancel",
  posted: "Recorded", draft: "Draft", void: "Void", private: "Private", linkedField: "Linked event (optional)",
  unlinked: "Extra expense (not linked)", individual: "Paid for myself", shared: "Share with others",
  individualHelp: "Record only your own bill. You are the payer and the only person sharing this expense.",
  linkedHelp: "Each person can add their own bill for an event.",
  splitHelp: "Split equally among the selected people.",
  privateHelp: "Only people who can see this private event can pay or share.",
  saved: "Expense saved and balances updated.", pending: "Expense sent for owner approval. It is not included in spending yet.",
  precision: "Enter a positive amount (whole yen for JPY, up to 2 decimals for HKD).",
  stale: "This expense changed. Check the latest version, then try again.",
};
export type ExpensePageMessages = { [K in keyof typeof en]: string };
const zh: ExpensePageMessages = {
  title: "旅程開支", subtitle: "整個旅程中你負擔的費用", history: "每日開支",
  myDayTotal: "我的開支", currentDay: "今日", count: "{count} 筆開支", noExpenses: "此日暫時沒有開支。",
  payerAndShare: "付款人：{payer} · 我的分攤：{amount}", linkedEvent: "活動：{title}", extra: "額外開支",
  add: "新增開支", edit: "編輯開支", save: "儲存開支", approval: "提交審批", cancel: "取消",
  posted: "已記帳", draft: "草稿", void: "已作廢", private: "私人", linkedField: "連結活動（可選）",
  unlinked: "額外開支（不連結活動）", individual: "自己付款及負擔", shared: "與其他人分攤",
  individualHelp: "只記錄你自己的帳單；付款人及分攤成員都只有你。",
  linkedHelp: "每人可為同一活動加入自己的開支。",
  splitHelp: "由已選的人平均分攤。",
  privateHelp: "只有可查看此私人活動的人可以付款或分攤。",
  saved: "開支已儲存，結餘已更新。", pending: "開支已提交管理員審批，暫時不計入開支總額。",
  precision: "請輸入正數金額（日圓須為整數，港元最多兩位小數）。",
  stale: "此開支已更改。請查看最新版本後再試。",
};
const ja: ExpensePageMessages = {
  title: "旅行の費用", subtitle: "旅行全体であなたが負担する費用", history: "日別の費用",
  myDayTotal: "自分の費用", currentDay: "今日", count: "費用 {count} 件", noExpenses: "この日の費用はまだありません。",
  payerAndShare: "支払者：{payer} · 自分の負担額：{amount}", linkedEvent: "予定：{title}", extra: "追加の費用",
  add: "費用を追加", edit: "費用を編集", save: "費用を保存", approval: "承認を依頼", cancel: "キャンセル",
  posted: "記帳済み", draft: "下書き", void: "無効", private: "非公開", linkedField: "関連する予定（任意）",
  unlinked: "追加の費用（予定との関連なし）", individual: "自分の分を支払った", shared: "ほかの人と分ける",
  individualHelp: "自分の会計分だけを記録します。支払者も負担者も自分だけになります。",
  linkedHelp: "1つの予定に、各自が自分の支払いを追加できます。",
  splitHelp: "選んだ人で均等に割り勘します。",
  privateHelp: "この非公開の予定を見られる人だけが支払い・割り勘できます。",
  saved: "費用を保存し、残高を更新しました。", pending: "オーナーに承認を依頼しました。承認前の費用は合計に含まれません。",
  precision: "正の金額を入力してください（円は整数、香港ドルは小数第2位まで）。",
  stale: "この費用は変更されました。最新の状態を確認してから再試行してください。",
};

export function expensePageMessages(locale: Locale): ExpensePageMessages {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}
