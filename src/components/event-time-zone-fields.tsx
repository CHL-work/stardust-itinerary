import { flightTimeZoneOptions } from "@/lib/app/airport-time-zones";
import { flightMessages } from "@/lib/app/flight-i18n";
import type { Locale } from "@/lib/i18n";

/** Explicit corrections are optional; automatic location resolution stays the default. */
export function EventTimeZoneFields({ transport, locale, label, start, end, busy, change }: {
  transport: boolean; locale: Locale; label: string; start: string; end: string; busy: boolean;
  change: (field: "start" | "end", value: string) => void;
}) {
  const copy = flightMessages(locale);
  return <>{(transport ? ["start", "end"] as const : ["start"] as const).map(field => {
    const selected = field === "start" ? start : end;
    return <label key={field}>{transport ? copy[field === "start" ? "departureTimeZone" : "arrivalTimeZone"] : label}
      <select value={selected} disabled={busy} onChange={event => change(field, event.target.value)}>
        <option value="">{copy.automaticZone}</option>
        {[...new Set([...flightTimeZoneOptions, selected].filter(Boolean))].map(zone => <option value={zone} key={zone}>{zone}</option>)}
      </select></label>;
  })}</>;
}
