import type { Locale } from "@/lib/i18n";

const en = {
  editShort: "Edit", approveShort: "Approve", rejectShort: "Reject",
  removedLink: "Removed event · retained expense link",
  myShare: "My share", proposedShare: "My proposed share", paidMyShare: "My share · paid by me",
  total: "Full bill", payer: "Paid by {name}", proposedPayer: "Payer: {name}", splits: "Who shares this bill",
  draft: "Draft", pending: "Draft · pending approval", void: "Void", excluded: "Not included in spending until approved.",
  remove: "Remove", removeConfirm: "Remove this cancelled event? This cannot be undone.",
  removed: "Cancelled event removed from trip views. Linked expenses and history were kept.",
  removalFailed: "The event could not be removed. Refresh and check its current status before retrying.",
  stale: "This item has changed. Refresh and review the latest version first.",
  draftApproved: "Draft approved and included in spending.", draftRejected: "Draft rejected and marked void. It is not included in spending.",
};
type Copy = { [K in keyof typeof en]: string };
const zh: Copy = {
  editShort: "編輯", approveShort: "批准", rejectShort: "拒絕",
  removedLink: "活動已移除 · 保留開支連結",
  myShare: "我的分攤", proposedShare: "我預計分攤", paidMyShare: "我的分攤 · 已由我付款",
  total: "全單總額", payer: "付款人：{name}", proposedPayer: "預計付款人：{name}", splits: "查看各人分攤",
  draft: "草稿", pending: "草稿 · 待審批", void: "已作廢", excluded: "批准前不計入開支總額。",
  remove: "移除", removeConfirm: "要移除此已取消的活動嗎？此操作無法復原。",
  removed: "已從旅程移除已取消活動。連結開支及歷史紀錄已保留。",
  removalFailed: "未能移除活動。請重新整理並檢查目前狀態，再決定是否重試。",
  stale: "此項目已經改變。請重新整理並檢查最新版本。",
  draftApproved: "草稿已批准並計入開支總額。", draftRejected: "草稿已拒絕並標記為作廢，不計入開支總額。",
};
const ja: Copy = {
  editShort: "編集", approveShort: "承認", rejectShort: "却下",
  removedLink: "削除済みの予定 · 費用の関連は保持",
  myShare: "自分の負担額", proposedShare: "自分の負担予定額", paidMyShare: "自分の負担額 · 自分が支払済み",
  total: "会計の総額", payer: "支払者：{name}", proposedPayer: "支払予定者：{name}", splits: "各メンバーの負担額",
  draft: "下書き", pending: "下書き · 承認待ち", void: "無効", excluded: "承認されるまで費用合計に含まれません。",
  remove: "削除", removeConfirm: "このキャンセル済みの予定を削除しますか？元に戻せません。",
  removed: "キャンセル済みの予定を旅行から削除しました。関連費用と履歴は保持されています。",
  removalFailed: "予定を削除できませんでした。更新して現在の状態を確認してから再試行してください。",
  stale: "この項目は変更されています。更新して最新の内容を確認してください。",
  draftApproved: "下書きを承認し、費用合計に含めました。", draftRejected: "下書きを却下し、無効にしました。費用合計には含まれません。",
};
export function mobileCardsMessages(locale: Locale): Copy {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}
