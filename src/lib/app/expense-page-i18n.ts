import type { Locale } from "@/lib/i18n";

const en = {
  title: "Trip expenses", subtitle: "Your costs across the whole trip", history: "Expenses by date",
  myDayTotal: "My spending", currentDay: "Today", count: "{count} expenses", noExpenses: "No expenses for this day.",
  payerAndShare: "Paid by {payer} · my share {amount}", linkedEvent: "Event: {title}", extra: "Extra expense",
  add: "Add expense", edit: "Edit expense", save: "Save expense", approval: "Request approval", cancel: "Cancel",
  posted: "Recorded", draft: "Draft", void: "Void", private: "Private", linkedField: "Linked event (optional)",
  unlinked: "Extra expense (not linked)", individual: "Paid for myself", shared: "Share with others",
  individualHelp: "Record only your own bill. You are the payer and the only person sharing this expense.",
  linkedHelp: "One event can have several separate bills. Each person can add their own payment; do not enter the whole table's total again.",
  splitHelp: "The amount is split equally among the selected people. Every new expense and correction is recorded in the audit history.",
  privateHelp: "Only people who can view this private event may pay or share this expense. An existing private link cannot be removed.",
  saved: "Expense saved and balances updated.", pending: "Expense sent for owner approval. It is not included in spending yet.",
  precision: "Enter a positive amount using the currency's supported precision (whole yen for JPY; up to two decimals for HKD).",
  stale: "This expense has changed. Your input is kept; check the latest version before trying again.",
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
  linkedHelp: "同一活動可以連結多筆獨立開支。每人可各自記錄付款，請勿再次輸入整桌帳單總額。",
  splitHelp: "金額會由所選成員平均分攤。每筆新增或更正的開支均會保留審計紀錄。",
  privateHelp: "只有能查看此私人活動的人可以付款或分攤。已儲存的私人活動連結不能移除。",
  saved: "開支已儲存，結餘已更新。", pending: "開支已提交管理員審批，暫時不計入開支總額。",
  precision: "請按貨幣精度輸入正數金額（日圓須為整數；港幣最多兩位小數）。",
  stale: "此開支已經改變。你輸入的資料仍然保留；請先檢查最新版本，再決定是否重試。",
};
const ja: ExpensePageMessages = {
  title: "旅行の費用", subtitle: "旅行全体であなたが負担する費用", history: "日別の費用",
  myDayTotal: "自分の費用", currentDay: "今日", count: "費用 {count} 件", noExpenses: "この日の費用はまだありません。",
  payerAndShare: "支払者：{payer} · 自分の負担額：{amount}", linkedEvent: "予定：{title}", extra: "追加の費用",
  add: "費用を追加", edit: "費用を編集", save: "費用を保存", approval: "承認を依頼", cancel: "キャンセル",
  posted: "記帳済み", draft: "下書き", void: "無効", private: "非公開", linkedField: "関連する予定（任意）",
  unlinked: "追加の費用（予定との関連なし）", individual: "自分の分を支払った", shared: "ほかの人と分ける",
  individualHelp: "自分の会計分だけを記録します。支払者も負担者も自分だけになります。",
  linkedHelp: "1つの予定に複数の会計を関連付けられます。各自の支払いを別々に記録し、全員の合計を重複して入力しないでください。",
  splitHelp: "選択したメンバーで均等に分けます。費用の追加と修正はすべて監査履歴に記録されます。",
  privateHelp: "この非公開の予定を閲覧できる人だけが支払い・負担できます。保存済みの非公開予定との関連は解除できません。",
  saved: "費用を保存し、残高を更新しました。", pending: "オーナーに承認を依頼しました。承認前の費用は合計に含まれません。",
  precision: "通貨に対応する桁数で正の金額を入力してください（JPYは整数、HKDは小数第2位まで）。",
  stale: "この費用は変更されています。入力内容は保持されています。最新の状態を確認してから再試行してください。",
};

export function expensePageMessages(locale: Locale): ExpensePageMessages {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}
