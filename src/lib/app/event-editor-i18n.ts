import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

const en = {
  now: "Now",
  startNow: "Set start to the current date and time",
  endNow: "Set end to the current date and time",
  optional: "optional",
  unknownEnd: "Leave end time and duration blank if unknown. Clearing either clears both.",
  endAfterStart: "End time must be after start time, or left blank.",
  endDateOutsideTrip: "End time must be within the trip dates, or left blank.",
  durationWholeMinutes: "Enter a positive whole number of minutes, or leave duration blank.",
  noMembers: "No one who can see this event can pay or share.",
  participants: "Choose a payer and at least one person to share.",
  description: "Enter an expense description of 1–240 characters.",
  amount: "Enter an expense amount greater than zero.",
  splits: "Enter each share. Shares must add up to the total.",
  currency: "Enter a three-letter currency code, such as JPY or HKD.",
  date: "Enter a valid expense date and time.",
  formInvalid: "Check the required fields and their allowed values. Your input is still here.",
  unavailable: "Unavailable for this event",
  choosePayer: "Choose an eligible payer",
  saveFailed: "Could not confirm the save. Check the latest version, then try again.",
  forbidden: "You cannot save this with your current access. Your input is still here.",
  stale: "This changed. Check the latest version, then try again.",
  signedOut: "You are signed out. Sign in again to save; your input is kept.",
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
  noMembers: "可查看此活動的成員中，沒有人可付款或分攤。",
  participants: "請選擇付款人及至少一位分攤者。",
  description: "請輸入 1 至 240 字的開支說明。",
  amount: "請輸入大於零的開支金額。",
  splits: "請輸入每人的金額，總和須等於總額。",
  currency: "請輸入三個英文字母的貨幣代碼，例如 JPY 或 HKD。",
  date: "請輸入有效的開支日期及時間。",
  formInvalid: "請檢查必填欄位及容許的數值。你輸入的資料仍然保留。",
  unavailable: "無法參與此活動",
  choosePayer: "選擇合資格的付款人",
  saveFailed: "未能確認是否已儲存。請查看最新版本後再試。",
  forbidden: "以你目前的權限無法儲存。你輸入的內容仍然保留。",
  stale: "內容已更改。請查看最新版本後再試。",
  signedOut: "你已登出。請重新登入再儲存，輸入內容會保留。",
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
  noMembers: "この予定を見られるメンバーに、支払い・割り勘できる人がいません。",
  participants: "支払者と、割り勘する人を1人以上選んでください。",
  description: "費用の内容を1～240文字で入力してください。",
  amount: "0より大きい費用額を入力してください。",
  splits: "各自の金額を入力してください。合計は総額と一致する必要があります。",
  currency: "JPYやHKDなど、英字3文字の通貨コードを入力してください。",
  date: "有効な費用の日時を入力してください。",
  formInvalid: "必須項目と入力可能な値を確認してください。入力内容は保持されています。",
  unavailable: "この予定では選択できません",
  choosePayer: "選択可能な支払者を選ぶ",
  saveFailed: "保存を確認できませんでした。最新の状態を確認してから再試行してください。",
  forbidden: "現在の権限では保存できません。入力内容は残っています。",
  stale: "内容が変更されました。最新の状態を確認してから再試行してください。",
  signedOut: "ログアウトしています。再ログインして保存してください。入力内容は残ります。",
};

export function eventEditorMessages(locale: Locale): EventEditorMessages {
  return localizedCatalog(locale, "eventEditor", { en, "zh-HK": zh, "ja-JP": ja });
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
