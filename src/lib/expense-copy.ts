import type { Locale } from "./i18n";
import { localizedCatalog } from "@/lib/locale-packs";

const en = {
  title: "My expense summary",
  scope: "This trip · all dates · records you can view",
  myShare: "My own trip expenses",
  myShareHelp: "Add the amounts allocated to you in this trip's posted expense records. This includes your portions of private, shared and standalone expenses you can view, even when someone else paid. It is your own cost, not what you still owe. Pending, draft and void expenses, and events without an expense record, add nothing. Each currency is totaled separately, without conversion.",
  paid: "Bills paid by me",
  paidHelp: "Add the full amount of every posted bill recorded with you as payer. Includes your private bills and shared bills you paid for yourself or other people, even if your own portion was zero. This is before anyone repays you. Separate member-to-member repayments are not included here, and this is not a bank-verified cash total.",
  receive: "Still owed to me",
  owe: "I still owe",
  balanced: "No net balance",
  balanceHelp: "This is the balance left after posted member repayments, not your total spending. Balance = bills paid by you − your own expenses + posted repayments sent − posted repayments received. A positive balance is still owed to you; a negative balance is what you still owe. Repayments change this balance, not your own expenses or bill-paid total. Only posted repayments count. Explicit bookkeeping reassignments after member removal are included where applicable.",
  helpLabel: "How this is calculated",
  personalSettlements: "My suggested settlements",
  noPersonalSettlements: "No suggested transfers for you.",
  settlementHint: "Suggestions only. The app does not send money.",
  ownerDetails: "Owner details · visible trip totals",
  ownerScope: "Includes only expenses you can view.",
  visibleTotal: "Visible trip total",
  allSettlements: "All visible suggested settlements",
  noExpenses: "No posted expenses to total yet.",
  noSettlements: "No suggested transfers.",
  viewExpenses: "View all expenses",
  addExpense: "Add expense",
  transfer: "suggested payment to",
} as const;

export type ExpenseSummaryCopy = { [Key in keyof typeof en]: string };

const cantonese: ExpenseSummaryCopy = {
  title: "我的開支總結",
  scope: "本次旅程所有日期 · 只計你有權查看的記錄",
  myShare: "我的個人總開支",
  myShareHelp: "將本次旅程已入帳開支中分配給你的金額相加，包括你有權查看的私人、共享及獨立開支中屬於你的部分，即使由別人付款也會計入。這是你自己的總開支，不是你目前尚欠的款項。待批、草稿及已作廢開支，以及未有開支記錄的活動，都不會計入。各貨幣分開計算，不會換算匯率。",
  paid: "我已支付的帳單總額",
  paidHelp: "將所有已入帳、記錄你為付款人的帳單全額相加，包括你支付的私人帳單及共享帳單，以及代其他人墊付的款項，即使你自己不用分攤也會計入。這是未扣除別人還款前的帳單付款總額；成員之間另外記錄的還款不計在此，亦不是經銀行核實的現金支出總額。",
  receive: "我尚應收回",
  owe: "我仍須支付",
  balanced: "淨結餘為零",
  balanceHelp: "這是計入已入帳成員還款後的尚欠結餘，不是你的總開支。結餘＝我已支付的帳單總額 − 我的個人總開支 ＋ 已付還款 − 已收還款。正數代表你尚應收回，負數代表你仍須支付。還款只影響結餘，不會增加或減少個人開支及帳單付款總額。只有已入帳還款才會計入；如移除成員時曾明確承接帳務，也會按承接結果計算。",
  helpLabel: "如何計算",
  personalSettlements: "我嘅建議結算",
  noPersonalSettlements: "你暫時冇建議轉帳。",
  settlementHint: "只屬建議；應用程式不會轉帳。",
  ownerDetails: "管理員詳情 · 可見旅程總額",
  ownerScope: "只包括你有權查看嘅開支。",
  visibleTotal: "可見旅程總額",
  allSettlements: "所有可見嘅建議結算",
  noExpenses: "暫時冇已入帳開支。",
  noSettlements: "暫時冇建議轉帳。",
  viewExpenses: "查看所有開支",
  addExpense: "新增開支",
  transfer: "建議支付畀",
};

const japanese: ExpenseSummaryCopy = {
  title: "自分の費用・支払い",
  scope: "この旅行の全日程 · 閲覧できる記録のみ",
  myShare: "自分が負担する旅行費用",
  myShareHelp: "この旅行の計上済み費用のうち、自分に割り当てられた金額を合計します。閲覧できる非公開・共有・予定に紐づかない費用の自分の負担分を含み、ほかの人が支払った分も対象です。自分の費用総額であり、未払い額ではありません。承認待ち・下書き・無効の費用や、費用が記録されていない予定は加算しません。通貨ごとに計算し、換算はしません。",
  paid: "自分が支払った会計総額",
  paidHelp: "自分が支払者として記録された計上済み会計の全額を合計します。自分が支払った非公開・共有の会計やほかの人の立替分を含み、自分の負担分がゼロでも対象です。ほかの人からの精算を差し引く前の金額です。別途記録したメンバー間の精算は含まず、銀行確認済みの現金支出総額ではありません。",
  receive: "これから受け取る額",
  owe: "これから支払う額",
  balanced: "差額なし",
  balanceHelp: "計上済みのメンバー間精算を反映した残高で、自分の費用総額ではありません。残高＝自分が支払った会計総額 − 自分の負担額 ＋ 支払済み精算 − 受取済み精算。プラスはこれから受け取る額、マイナスはこれから支払う額です。精算は残高だけを変え、費用や会計総額は変えません。計上済み精算のみ対象です。メンバー削除時に明示的に引き継いだ帳簿上の精算も反映します。",
  helpLabel: "計算方法",
  personalSettlements: "自分の精算案",
  noPersonalSettlements: "自分の送金案はありません。",
  settlementHint: "提案のみです。アプリは送金しません。",
  ownerDetails: "オーナー詳細 · 閲覧可能な旅行合計",
  ownerScope: "閲覧権限のある支出のみ集計します。",
  visibleTotal: "閲覧可能な旅行合計",
  allSettlements: "閲覧可能なすべての精算案",
  noExpenses: "集計できる記録済み支出はまだありません。",
  noSettlements: "送金案はありません。",
  viewExpenses: "すべての支出を見る",
  addExpense: "支出を追加",
  transfer: "から次の相手への送金案：",
};

/** Financial copy deliberately stays neutral in both Cantonese tone packs. */
export function expenseSummaryCopy(locale: Locale): ExpenseSummaryCopy {
  return localizedCatalog(locale, "expense", { en, "zh-HK": cantonese, "ja-JP": japanese });
}
