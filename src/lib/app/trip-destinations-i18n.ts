import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

/** The destination list in trip creation and trip settings (JOB-098). Notes stay one line; the rest is behind "?". */
const en = {
  title: "Destinations",
  hint: "Add each place, and the days you're there if you know them.",
  help: "The first destination names the trip. On the days you set for a place, events without their own location use its clock, and the AI plans those days there.",
  place: "Place",
  timeZone: "Time zone",
  from: "From",
  to: "To",
  dates: "Days there (optional)",
  add: "Add a destination",
  remove: "Remove",
  moveUp: "Move up",
  moveDown: "Move down",
  datesOutside: "Each destination's dates must be within the trip dates.",
  datesIncomplete: "Give both dates for a destination, or neither.",
  limit: "Up to 12 destinations.",
};
export type TripDestinationsCopy = { [K in keyof typeof en]: string };

const cantonese: TripDestinationsCopy = {
  title: "目的地",
  hint: "加入每個地方；知道的話，再加上喺嗰度的日子。",
  help: "第一個目的地就係旅程名稱。喺你為某個地方設定的日子，冇自己地點的活動會用嗰度的時間，AI 亦會喺嗰幾日幫你安排喺嗰度。",
  place: "地點",
  timeZone: "時區",
  from: "由",
  to: "至",
  dates: "停留日子（選填）",
  add: "加入目的地",
  remove: "移除",
  moveUp: "上移",
  moveDown: "下移",
  datesOutside: "每個目的地的日期都要喺旅程日期之內。",
  datesIncomplete: "目的地的日期請兩個都填，或者兩個都留空。",
  limit: "最多 12 個目的地。",
};

const japanese: TripDestinationsCopy = {
  title: "目的地",
  hint: "各地を追加し、分かれば滞在する日も入れます。",
  help: "最初の目的地が旅行の名前になります。設定した日は、場所のない予定がその目的地の時刻を使い、AIもその日をその場所で計画します。",
  place: "場所",
  timeZone: "タイムゾーン",
  from: "開始日",
  to: "終了日",
  dates: "滞在日（任意）",
  add: "目的地を追加",
  remove: "削除",
  moveUp: "上へ移動",
  moveDown: "下へ移動",
  datesOutside: "各目的地の日付は旅行の日付の範囲内にしてください。",
  datesIncomplete: "目的地の日付は両方入力するか、両方とも空欄にしてください。",
  limit: "目的地は12か所までです。",
};

export function tripDestinationsMessages(locale: Locale): TripDestinationsCopy {
  return localizedCatalog(locale, "tripDestinations", { en, "zh-HK": cantonese, "ja-JP": japanese });
}
