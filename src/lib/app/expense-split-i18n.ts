import type { Locale } from "@/lib/i18n";

const en = {
  title: "Split amounts", equal: "Equal", custom: "Custom amounts", equalHint: "Split equally across the selected people. Any smallest-unit remainder is assigned automatically.",
  customHint: "Enter each selected person's share. Zero is allowed; the shares must match the total exactly.",
  assigned: "Assigned", remaining: "Remaining", over: "Overallocated", balanced: "Matches the total", incomplete: "Enter an amount for every selected person.",
  totalFirst: "Enter the expense total to check the split.", unavailable: "Unavailable member", share: "Share", error: "Enter a valid amount for each selected person. Custom shares must add up exactly to the expense total.",
};
export type ExpenseSplitMessages = { [K in keyof typeof en]: string };
const zh: ExpenseSplitMessages = {
  title: "分攤金額", equal: "平均分攤", custom: "自訂金額", equalHint: "由所選成員平均分攤，最小貨幣單位的餘數會自動分配。",
  customHint: "輸入每位所選成員的分攤金額，可以是零；分攤總和必須與開支總額完全一致。",
  assigned: "已分配", remaining: "待分配", over: "超額分配", balanced: "與總額一致", incomplete: "請輸入每位所選成員的金額。",
  totalFirst: "請先輸入開支總額以核對分攤。", unavailable: "無法參與的成員", share: "分攤金額", error: "請輸入每位所選成員的有效金額，自訂分攤總和必須與開支總額完全一致。",
};
const ja: ExpenseSplitMessages = {
  title: "負担額", equal: "均等", custom: "金額を指定", equalHint: "選択したメンバーで均等に分けます。最小通貨単位の端数は自動で割り当てられます。",
  customHint: "各メンバーの負担額を入力してください。0も指定できます。負担額の合計は費用総額と一致する必要があります。",
  assigned: "割り当て済み", remaining: "未割り当て", over: "超過額", balanced: "総額と一致", incomplete: "選択した全メンバーの金額を入力してください。",
  totalFirst: "費用総額を入力すると負担額を確認できます。", unavailable: "選択できないメンバー", share: "負担額", error: "各メンバーの有効な金額を入力してください。指定した負担額の合計は費用総額と完全に一致する必要があります。",
};
export function expenseSplitMessages(locale: Locale): ExpenseSplitMessages {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}
