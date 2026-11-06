import type { Locale } from "@/lib/i18n";

// JOB-048 layout controls are display/accessibility surfaces: both Cantonese modes stay neutral.
const en = {
  toggleToClassic: "Classic layout", toggleToNew: "New layout",
  toggleToClassicLabel: "Switch to the classic layout", toggleToNewLabel: "Switch to the new layout",
  settingsTitle: "Screen layout",
  settingsDescription: "Choose how Stardust looks on this device.",
  optionNew: "New layout", optionNewHint: "Larger text and clearer cards. Follows your device's light or dark setting.",
  optionClassic: "Classic layout", optionClassicHint: "The original dark Stardust design.",
  current: "In use",
  navLabel: "Main sections",
  navToday: "Today", navItinerary: "Itinerary", navExpenses: "Expenses", navAi: "AI", navRequests: "Approvals", navSettings: "Settings",
  navRequestsWaiting: "Approvals, {count} waiting",
  daysLabel: "Trip days", todayChip: "Today", showDay: "Show {date}",
  dayOf: "Day {day} of {total}", startsInOne: "Starts tomorrow", startsInMany: "Starts in {count} days", tripEnded: "Trip ended",
  membersOne: "{count} member", membersMany: "{count} members",
  tripNavLabel: "Your other trips", previousTrip: "Previous trip", nextTrip: "Next trip",
  previousTripLabel: "Go to the previous trip: {name}, {dates}", nextTripLabel: "Go to the next trip: {name}, {dates}",
};
type Copy = { [K in keyof typeof en]: string };
const zh: Copy = {
  toggleToClassic: "經典版面", toggleToNew: "新版面",
  toggleToClassicLabel: "切換至經典版面", toggleToNewLabel: "切換至新版面",
  settingsTitle: "畫面版面",
  settingsDescription: "選擇此裝置上的顯示方式。",
  optionNew: "新版面", optionNewHint: "字體更大、卡片更清晰，並跟隨裝置的淺色或深色模式。",
  optionClassic: "經典版面", optionClassicHint: "原本的深色星塵設計。",
  current: "使用中",
  navLabel: "主要分頁",
  navToday: "今日", navItinerary: "行程", navExpenses: "開支", navAi: "AI", navRequests: "審批", navSettings: "設定",
  navRequestsWaiting: "審批，{count} 項待處理",
  daysLabel: "旅程日期", todayChip: "今日", showDay: "查看 {date}",
  dayOf: "第 {day} 日（共 {total} 日）", startsInOne: "明日出發", startsInMany: "{count} 日後出發", tripEnded: "旅程已結束",
  membersOne: "{count} 位成員", membersMany: "{count} 位成員",
  tripNavLabel: "你的其他旅程", previousTrip: "上一個旅程", nextTrip: "下一個旅程",
  previousTripLabel: "前往上一個旅程：{name}，{dates}", nextTripLabel: "前往下一個旅程：{name}，{dates}",
};
const ja: Copy = {
  toggleToClassic: "クラシック表示", toggleToNew: "新しい表示",
  toggleToClassicLabel: "クラシック表示に切り替える", toggleToNewLabel: "新しい表示に切り替える",
  settingsTitle: "画面のレイアウト",
  settingsDescription: "この端末での表示方法を選びます。",
  optionNew: "新しい表示", optionNewHint: "大きめの文字と見やすいカード。端末のライト／ダーク設定に合わせます。",
  optionClassic: "クラシック表示", optionClassicHint: "これまでのダークなスターダストのデザインです。",
  current: "使用中",
  navLabel: "メインメニュー",
  navToday: "今日", navItinerary: "旅程", navExpenses: "費用", navAi: "AI", navRequests: "承認", navSettings: "設定",
  navRequestsWaiting: "承認（{count} 件待ち）",
  daysLabel: "旅行の日付", todayChip: "今日", showDay: "{date} を表示",
  dayOf: "{day}日目（全{total}日）", startsInOne: "明日出発", startsInMany: "{count}日後に出発", tripEnded: "旅行は終了しました",
  membersOne: "メンバー {count} 人", membersMany: "メンバー {count} 人",
  tripNavLabel: "ほかの旅行", previousTrip: "前の旅行", nextTrip: "次の旅行",
  previousTripLabel: "前の旅行へ移動：{name}、{dates}", nextTripLabel: "次の旅行へ移動：{name}、{dates}",
};
export type UiRefreshCopy = Copy;
export function uiRefreshMessages(locale: Locale): Copy {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}
