import { flightArrivalDetail, flightDepartureDetail, type FlightDetails } from "@/lib/app/flight";
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
