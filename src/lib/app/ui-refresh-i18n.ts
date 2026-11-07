import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

// Layout controls (JOB-048) are display/accessibility surfaces: both Cantonese modes stay neutral.
const en = {
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
  return localizedCatalog(locale, "uiRefresh", { en, "zh-HK": zh, "ja-JP": ja });
}
