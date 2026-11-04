import type { Locale } from "@/lib/i18n";

const en = {
  now: "Now",
  startNow: "Set start to the current date and time",
  endNow: "Set end to the current date and time",
  optional: "optional",
  unknownEnd: "Leave end time and duration blank if unknown. Clearing either clears both.",
  endAfterStart: "End time must be after start time, or left blank.",
  endDateOutsideTrip: "End time must be within the trip dates, or left blank.",
  durationWholeMinutes: "Enter a positive whole number of minutes, or leave duration blank.",
  noMembers: "No eligible payer or participants are available for this event. Review the event audience before adding an expense.",
  participants: "Choose an eligible payer and at least one participant. Unavailable members cannot be included in this event's expense.",
  description: "Enter an expense description of 1–240 characters.",
  amount: "Enter an expense amount greater than zero.",
  splits: "Enter a valid amount for each selected person. Custom shares must add up exactly to the expense total.",
  currency: "Enter a three-letter currency code, such as JPY or HKD.",
  date: "Enter a valid expense date and time.",
  formInvalid: "Check the required fields and their allowed values. Your input is still here.",
  unavailable: "Unavailable for this event",
  choosePayer: "Choose an eligible payer",
  saveFailed: "Saving could not be confirmed. Your input is still here. Check the latest events, expenses and approval requests before explicitly trying again.",
  forbidden: "You cannot save this change with the current permissions or event audience. Review the selected members and your access. Your input is still here.",
  stale: "This event or proposal has changed. Your input is still here; check the latest version before trying again.",
  signedOut: "Your session is no longer available. Sign in again before saving. Your input is still here.",
};
export type EventEditorMessages = { [K in keyof typeof en]: string };
const zh: EventEditorMessages = {
  now: "而家",
  startNow: "將開始時間設為目前日期及時間",
  endNow: "將結束時間設為目前日期及時間",
  optional: "可選",
  unknownEnd: "未確定結束時間及時長可以留空。清除其中一項會同時清除兩項。",
  endAfterStart: "結束時間必須遲於開始時間，或留空。",
  endDateOutsideTrip: "結束時間必須在旅程日期範圍內，或留空。",
  durationWholeMinutes: "請輸入大於零的整數分鐘，或將時長留空。",
  noMembers: "此活動沒有合資格的付款人或分攤成員。請先檢查活動分享對象，再新增開支。",
  participants: "請選擇合資格的付款人及至少一位分攤成員。無法參與此活動的成員不可列入開支。",
  description: "請輸入 1 至 240 字的開支說明。",
  amount: "請輸入大於零的開支金額。",
  splits: "請輸入每位所選成員的有效金額，自訂分攤總和必須與開支總額完全一致。",
  currency: "請輸入三個英文字母的貨幣代碼，例如 JPY 或 HKD。",
  date: "請輸入有效的開支日期及時間。",
  formInvalid: "請檢查必填欄位及容許的數值。你輸入的資料仍然保留。",
  unavailable: "無法參與此活動",
  choosePayer: "選擇合資格的付款人",
  saveFailed: "未能確認儲存結果，你輸入的資料仍然保留。請先檢查最新活動、開支及審批申請，再決定是否重試。",
  forbidden: "目前的權限或活動分享設定不允許儲存此更改。請檢查所選成員及存取權；你輸入的資料仍然保留。",
  stale: "此活動或提案已經改變。你輸入的資料仍然保留；請先檢查最新版本，再決定是否重試。",
  signedOut: "登入工作階段已失效，請重新登入後再儲存。你輸入的資料仍然保留。",
};
const ja: EventEditorMessages = {
  now: "現在",
  startNow: "開始を現在の日時に設定",
  endNow: "終了を現在の日時に設定",
  optional: "任意",
  unknownEnd: "終了時刻や所要時間が未定なら空欄にできます。片方を消すと両方が空欄になります。",
  endAfterStart: "終了時刻は開始時刻より後にするか、空欄にしてください。",
  endDateOutsideTrip: "終了時刻は旅行期間内にするか、空欄にしてください。",
  durationWholeMinutes: "所要時間は1以上の整数（分）にするか、空欄にしてください。",
  noMembers: "この予定には選択可能な支払者・負担者がいません。費用を追加する前に共有相手を確認してください。",
  participants: "選択可能な支払者と、1人以上の負担者を選んでください。選択できないメンバーは費用に含められません。",
  description: "費用の内容を1～240文字で入力してください。",
  amount: "0より大きい費用額を入力してください。",
  splits: "各メンバーの有効な金額を入力してください。指定した負担額の合計は費用総額と完全に一致する必要があります。",
  currency: "JPYやHKDなど、英字3文字の通貨コードを入力してください。",
  date: "有効な費用の日時を入力してください。",
  formInvalid: "必須項目と入力可能な値を確認してください。入力内容は保持されています。",
  unavailable: "この予定では選択できません",
  choosePayer: "選択可能な支払者を選ぶ",
  saveFailed: "保存結果を確認できませんでした。入力内容は保持されています。最新の予定・費用・承認申請を確認してから、必要に応じて再試行してください。",
  forbidden: "現在の権限または共有設定では保存できません。選択したメンバーとアクセス権を確認してください。入力内容は保持されています。",
  stale: "この予定または提案は変更されています。入力内容は保持されています。最新の状態を確認してから再試行してください。",
  signedOut: "セッションが無効になりました。再度ログインしてから保存してください。入力内容は保持されています。",
};

export function eventEditorMessages(locale: Locale): EventEditorMessages {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}

export function eventEditorFailureMessage(error: unknown, copy: EventEditorMessages): string {
  if (error && typeof error === "object" && "status" in error) {
    if (error.status === 400) return copy.formInvalid;
    if (error.status === 401) return copy.signedOut;
    if (error.status === 403 || error.status === 404) return copy.forbidden;
    if (error.status === 409) return copy.stale;
  }
  return copy.saveFailed;
}
