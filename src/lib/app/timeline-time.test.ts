import { describe, expect, it } from "vitest";
import { projectTimelinePoints, type TimelineSource } from "./timeline";
import { formatEventLocalTime, formatTimelinePointTime } from "./timeline-time";
import { flightMessages } from "./flight-i18n";
import { locales } from "@/lib/i18n";

const base: TimelineSource = { id:"synthetic-flight",tripDayId:"day",itemType:"transport",title:"Flight AA123",
  flight:{flightNumber:"AA123"},startsAt:"2030-01-15T16:00:00Z",endsAt:"2030-01-15T18:00:00Z",status:"planned",
  departureLocationName:"Dallas Fort Worth (DFW)",destinationLocationName:"Salt Lake City (SLC)" };
function points(item: TimelineSource=base, zone="Asia/Tokyo") {
  return projectTimelinePoints([item], {tripDays:[{id:"day",date:"2030-01-16"},{id:"summer-day",date:"2030-07-15"}],timeZone:zone});
}
/** D-109: a clock never carries a zone name such as "GMT+9", "UTC", "CST" or the trip-time fallback. */
function expectNoZoneName(text: string) {
  expect(text).not.toMatch(/GMT|UTC|\b[A-Z]{3,4}\b/u);
  for (const locale of locales) expect(text).not.toContain(flightMessages(locale).tripTimeFallback);
}

describe("airport-local timeline clocks without zone names (D-102, D-109)",()=>{
  it.each([
    ["2030-01-15", "10:00", "11:00"],
    ["2030-07-15", "11:00", "12:00"],
  ])("shows distinct DFW/SLC local clocks, with DST, at %s",(date,departureClock,arrivalClock)=>{
    const [departure,arrival]=points({...base,startsAt:`${date}T16:00:00Z`,endsAt:`${date}T18:00:00Z`});
    const departureText=formatTimelinePointTime(departure,"en","Asia/Tokyo");
    const arrivalText=formatTimelinePointTime(arrival,"en","Asia/Tokyo");
    expect(departureText).toContain(departureClock);expect(arrivalText).toContain(arrivalClock);
    expectNoZoneName(departureText);expectNoZoneName(arrivalText);
  });
  it("adds the endpoint calendar date when it differs from the trip's day without regrouping the event",()=>{
    const original={...base,startsAt:"2030-07-15T04:30:00Z",endsAt:"2030-07-15T06:30:00Z"};
    const [departure,arrival]=points(original);
    expect(departure.tripDayId).toBe("summer-day");expect(arrival.tripDayId).toBe("summer-day");
    const departureText=formatTimelinePointTime(departure,"en","Asia/Tokyo");
    const arrivalText=formatTimelinePointTime(arrival,"en","Asia/Tokyo");
    expect(departureText).toBe("Jul 14, 11:30 PM");
    expect(arrivalText).not.toContain("Jul 14");expect(arrivalText).toContain("12:30");
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo",true)).toContain("Jul 15");
    expect(departure.at).toBe(original.startsAt);expect(arrival.at).toBe(original.endsAt);
    expect(departure.item).toBe(original);expect(arrival.item).toBe(original);
  });
  it("shows an unknown airport endpoint on the trip's clock, unlabeled",()=>{
    const [departure,arrival]=points({...base,departureLocationName:"An unidentified airport"});
    expect(departure.timeZone).toBe("Asia/Tokyo");expect(departure.timeZoneKnown).toBe(false);
    expect(formatTimelinePointTime(departure,"en","Asia/Tokyo")).toContain("01:00");
    expectNoZoneName(formatTimelinePointTime(departure,"en","Asia/Tokyo"));
    expectNoZoneName(formatTimelinePointTime(arrival,"en","Asia/Tokyo"));
  });
  it.each(locales)("formats a valid clock with no zone name in %s",locale=>{
    const [departure]=points({...base,departureLocationName:"Unknown"});
    const value=formatTimelinePointTime(departure,locale,"Asia/Tokyo");
    expect(value).not.toContain("Invalid Date");expectNoZoneName(value);
  });
  it("uses local endpoint clocks for nonflight transport without flight badges",()=>{
    const [departure,arrival]=points({...base,title:"Airport shuttle",flight:null,
      timeZones:{start:"America/Chicago",end:"America/Denver"}});
    expect(departure.isFlight).toBe(false);expect(arrival.isFlight).toBe(false);
    // The local date (Jan 15) differs from the Tokyo trip date, so it is shown.
    expect(formatTimelinePointTime(departure,"en","Asia/Tokyo")).toBe("Jan 15, 10:00 AM");
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo")).toBe("Jan 15, 11:00 AM");
  });
  it("uses safe offline endpoint projections without needing private flight details",()=>{
    const [departure,arrival]=points({...base,title:"Transport",flight:null,
      departureLocationName:"Departure",destinationLocationName:"Arrival",
      flightPresentation:{isFlight:true,departureTimeZone:"America/Chicago",arrivalTimeZone:"America/Denver"}});
    expect(formatTimelinePointTime(departure,"en","Asia/Tokyo")).toBe("Jan 15, 10:00 AM");
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo")).toBe("Jan 15, 11:00 AM");
  });
  it("keeps an untimed arrival empty instead of fabricating a clock or timezone warning",()=>{
    const arrival=points({...base,endsAt:null}).find(point=>point.kind==="arrival")!;
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo")).toBe("");
  });
});

describe("every event uses its location clock", () => {
  it.each(["meal", "lodging", "activity", "note"])("shows %s in Salt Lake City time in a Dallas trip", (itemType) => {
    const item = { ...base, itemType, flight: null, locationName: "Synthetic venue, Salt Lake City, Utah",
      timeZones: { start: "America/Denver" }, startsAt: "2030-07-15T21:00:00Z", endsAt: "2030-07-17T17:00:00Z" };
    const [point] = points(item, "America/Chicago");
    expect(point.timeZone).toBe("America/Denver");
    expect(formatTimelinePointTime(point, "en", "America/Chicago")).toBe("03:00 PM");
    expect(formatEventLocalTime(item, item.endsAt, "en", "America/Chicago", "end", true)).toBe("Jul 17, 11:00 AM");
    expect(point.at).toBe(item.startsAt);
  });
  it("shows a preceding event-local date without reassigning the canonical trip group", () => {
    const item = { ...base, itemType: "meal", flight: null, startsAt: "2030-07-15T05:30:00Z", endsAt: null,
      timeZones: { start: "America/Denver" } };
    const [point] = points(item, "America/Chicago");
    expect(point.tripDayId).toBe("summer-day");
    expect(formatTimelinePointTime(point, "en", "America/Chicago")).toBe("Jul 14, 11:30 PM");
  });
  it("shows an unresolved nonflight location on the trip's clock, unlabeled", () => {
    const [point] = points({ ...base, itemType: "meal", flight: null, locationName: "Synthetic unnamed venue" }, "America/Chicago");
    expect(point.timeZoneKnown).toBe(false);
    expect(formatTimelinePointTime(point, "en", "America/Chicago")).toBe("10:00 AM");
  });
});
