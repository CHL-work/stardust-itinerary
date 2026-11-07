import { flightArrivalDetail, flightDepartureDetail, type FlightChange, type FlightDetails } from "@/lib/app/flight";
import { formatMessage, type Locale } from "@/lib/i18n";

// Flight details (JOB-082) are transport facts: both Cantonese modes stay neutral.
const en = {
  fields: "Flight",
  number: "Flight number",
  airline: "Airline",
  departureTerminal: "Departure terminal",
  gate: "Gate",
  arrivalTerminal: "Arrival terminal",
  invalidNumber: "Enter a flight number such as JL123, or leave it blank.",
  gateValue: "Gate {gate}",
  changedShort: "Changed",
  changedLabel: "Flight time changed",
  cancelledLabel: "Flight cancelled",
  departureMoved: "Departure moved from {from} to {to}.",
  arrivalNow: "Arrival is now {time}.",
  cancelledNote: "The airline lists this flight as cancelled. The event is kept.",
  checkedAt: "Checked {time}.",
};
export type FlightMessages = { [K in keyof typeof en]: string };
const zh: FlightMessages = {
  fields: "航班",
  number: "航班編號",
  airline: "航空公司",
  departureTerminal: "出發客運大樓",
  gate: "登機閘口",
  arrivalTerminal: "抵達客運大樓",
  invalidNumber: "請輸入航班編號，例如 JL123，或者留空。",
  gateValue: "{gate} 號閘口",
  changedShort: "已更改",
  changedLabel: "航班時間已更改",
  cancelledLabel: "航班已取消",
  departureMoved: "出發時間由 {from} 改為 {to}。",
  arrivalNow: "抵達時間現為 {time}。",
  cancelledNote: "航空公司顯示此航班已取消，活動會保留。",
  checkedAt: "查核時間：{time}。",
};
const ja: FlightMessages = {
  fields: "フライト",
  number: "便名",
  airline: "航空会社",
  departureTerminal: "出発ターミナル",
  gate: "搭乗口",
  arrivalTerminal: "到着ターミナル",
  invalidNumber: "JL123 のような便名を入力するか、空欄にしてください。",
  gateValue: "{gate}番搭乗口",
  changedShort: "変更",
  changedLabel: "フライトの時刻が変わりました",
  cancelledLabel: "フライトは欠航です",
  departureMoved: "出発が {from} から {to} に変わりました。",
  arrivalNow: "到着は {time} です。",
  cancelledNote: "航空会社はこの便を欠航としています。予定は残してあります。",
  checkedAt: "{time} に確認。",
};

export function flightMessages(locale: Locale): FlightMessages {
  return locale === "en" ? en : locale === "ja-JP" ? ja : zh;
}

/**
 * A flight's endpoint as shown on a card (D-094): the departure airport with its gate and terminal,
 * else its terminal, else the airline; the arrival airport with its terminal. Other points, and
 * events without flight details, keep their location name.
 */
export function flightPointLocation(
  kind: "event" | "departure" | "arrival",
  locationName: string | null,
  flight: FlightDetails | null | undefined,
  locale: Locale,
): string | null {
  if (!flight || kind === "event") return locationName;
  const copy = flightMessages(locale);
  const parts: string[] = [];
  // A terminal the airport name already includes, such as "Haneda Airport Terminal 2", is not repeated.
  const named = (locationName ?? "").normalize("NFKC").toLocaleLowerCase();
  const addTerminal = (terminal: string | null) => {
    if (terminal && !named.includes(terminal.normalize("NFKC").toLocaleLowerCase())) parts.push(terminal);
  };
  if (kind === "departure") {
    const detail = flightDepartureDetail(flight);
    if (detail?.kind === "gate") {
      addTerminal(detail.terminal);
      parts.push(formatMessage(copy.gateValue, { gate: detail.gate }));
    } else if (detail?.kind === "terminal") {
      addTerminal(detail.terminal);
    } else if (detail?.kind === "airline") {
      parts.push(detail.airline);
    }
  } else {
    addTerminal(flightArrivalDetail(flight));
  }
  const shown = [locationName?.trim(), ...parts].filter((part): part is string => Boolean(part));
  return shown.length ? shown.join(" · ") : locationName;
}

function shortDateTime(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, {
    timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

/** The brief note behind a flight change badge (JOB-083): what moved, or the cancellation, and when it was checked. */
export function flightChangeNote(change: FlightChange, locale: Locale, timeZone: string): string {
  const copy = flightMessages(locale);
  const time = (iso: string) => shortDateTime(iso, locale, timeZone);
  const sentences: string[] = [];
  if (change.kind === "cancelled") {
    sentences.push(copy.cancelledNote);
  } else {
    if (change.previousStartsAt && change.startsAt) {
      sentences.push(formatMessage(copy.departureMoved, { from: time(change.previousStartsAt), to: time(change.startsAt) }));
    }
    if (change.endsAt && change.endsAt !== change.previousEndsAt) sentences.push(formatMessage(copy.arrivalNow, { time: time(change.endsAt) }));
  }
  sentences.push(formatMessage(copy.checkedAt, { time: time(change.checkedAt) }));
  return sentences.join(" ");
}
