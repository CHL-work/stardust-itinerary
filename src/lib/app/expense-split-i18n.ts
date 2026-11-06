import type { Locale } from "@/lib/i18n";

const en = {
  title: "Split amounts", equal: "Equal", custom: "Custom amounts", equalHint: "Split equally among the selected people.",
  customHint: "Enter each person's share; they must add up to the total.",
  assigned: "Assigned", remaining: "Remaining", over: "Overallocated", balanced: "Matches the total", incomplete: "Enter an amount for every selected person.",
  totalFirst: "Enter the expense total to check the split.", unavailable: "Unavailable member", share: "Share", error: "Enter each share. Shares must add up to the total.",
};
export type ExpenseSplitMessages = { [K in keyof typeof en]: string };
const zh: ExpenseSplitMessages = {
  title: "分攤金額", equal: "平均分攤", custom: "自訂金額", equalHint: "由已選的人平均分攤。",
  customHint: "輸入每人的金額，總和須等於總額。",
  assigned: "已分配", remaining: "待分配", over: "超額分配", balanced: "與總額一致", incomplete: "請輸入每位所選成員的金額。",
  totalFirst: "請先輸入開支總額以核對分攤。", unavailable: "無法參與的成員", share: "分攤金額", error: "請輸入每人的金額，總和須等於總額。",
};
const ja: ExpenseSplitMessages = {
  title: "負担額", equal: "均等", custom: "金額を指定", equalHint: "選んだ人で均等に割り勘します。",
  customHint: "各自の金額を入力してください。合計は総額と一致させます。",
  assigned: "割り当て済み", remaining: "未割り当て", over: "超過額", balanced: "総額と一致", incomplete: "選択した全メンバーの金額を入力してください。",
  totalFirst: "費用総額を入力すると負担額を確認できます。", unavailable: "選択できないメンバー", share: "負担額", error: "各自の金額を入力してください。合計は総額と一致する必要があります。",
};
export function expenseSplitMessages(locale: Locale): ExpenseSplitMessages {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}
