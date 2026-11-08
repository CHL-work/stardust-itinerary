import { describe, expect, it } from "vitest";
import { projectTimelinePoints, type TimelineSource } from "./timeline";
import { formatTimelinePointTime } from "./timeline-time";
import { flightMessages } from "./flight-i18n";
import { locales } from "@/lib/i18n";

const base: TimelineSource = { id:"synthetic-flight",tripDayId:"day",itemType:"transport",title:"Flight AA123",
  flight:{flightNumber:"AA123"},startsAt:"2030-01-15T16:00:00Z",endsAt:"2030-01-15T18:00:00Z",status:"planned",
  departureLocationName:"Dallas Fort Worth (DFW)",destinationLocationName:"Salt Lake City (SLC)" };
function points(item: TimelineSource=base, zone="Asia/Tokyo") {
  return projectTimelinePoints([item], {tripDays:[{id:"day",date:"2030-01-16"},{id:"summer-day",date:"2030-07-15"}],timeZone:zone});
}

describe("airport-local timeline clock labels",()=>{
  it.each([
    ["2030-01-15", "10:00", "CST", "11:00", "MST"],
    ["2030-07-15", "11:00", "CDT", "12:00", "MDT"],
  ])("shows distinct DFW/SLC zones and DST at %s",(date,departureClock,departureZone,arrivalClock,arrivalZone)=>{
    const [departure,arrival]=points({...base,startsAt:`${date}T16:00:00Z`,endsAt:`${date}T18:00:00Z`});
    const departureText=formatTimelinePointTime(departure,"en","Asia/Tokyo");
    const arrivalText=formatTimelinePointTime(arrival,"en","Asia/Tokyo");
    expect(departureText).toContain(departureClock);expect(departureText).toContain(departureZone);
    expect(arrivalText).toContain(arrivalClock);expect(arrivalText).toContain(arrivalZone);
    expect(departureText).not.toContain(flightMessages("en").tripTimeFallback);
    expect(arrivalText).not.toContain(flightMessages("en").tripTimeFallback);
  });
  it("adds the endpoint calendar date when it differs from the trip's day without regrouping the event",()=>{
    const original={...base,startsAt:"2030-07-15T04:30:00Z",endsAt:"2030-07-15T06:30:00Z"};
    const [departure,arrival]=points(original);
    expect(departure.tripDayId).toBe("summer-day");expect(arrival.tripDayId).toBe("summer-day");
    const departureText=formatTimelinePointTime(departure,"en","Asia/Tokyo");
    const arrivalText=formatTimelinePointTime(arrival,"en","Asia/Tokyo");
    expect(departureText).toContain("Jul 14");expect(departureText).toContain("11:30");expect(departureText).toContain("CDT");
    expect(arrivalText).not.toContain("Jul 14");expect(arrivalText).toContain("12:30");expect(arrivalText).toContain("MDT");
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo",true)).toContain("Jul 15");
    expect(departure.at).toBe(original.startsAt);expect(arrival.at).toBe(original.endsAt);
    expect(departure.item).toBe(original);expect(arrival.item).toBe(original);
  });
  it("marks only an unknown airport endpoint with the localized trip-time fallback",()=>{
    const [departure,arrival]=points({...base,departureLocationName:"An unidentified airport"});
    expect(departure.timeZone).toBe("Asia/Tokyo");expect(departure.timeZoneKnown).toBe(false);
    expect(formatTimelinePointTime(departure,"en","Asia/Tokyo")).toContain("01:00");
    expect(formatTimelinePointTime(departure,"en","Asia/Tokyo")).toContain(flightMessages("en").tripTimeFallback);
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo")).not.toContain(flightMessages("en").tripTimeFallback);
  });
  it.each(locales)("uses a localized fallback and valid Intl formatting in %s",locale=>{
    const [departure]=points({...base,departureLocationName:"Unknown"});
    const value=formatTimelinePointTime(departure,locale,"Asia/Tokyo");
    expect(value).toContain(flightMessages(locale).tripTimeFallback);expect(value).not.toContain("Invalid Date");
  });
  it("keeps generic transport in the trip zone without flight badges or fallback prose",()=>{
    const [departure,arrival]=points({...base,title:"Airport shuttle",flight:null});
    expect(departure.isFlight).toBe(false);expect(arrival.isFlight).toBe(false);
    expect(formatTimelinePointTime(departure,"en","Asia/Tokyo")).toBe("01:00 AM");
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo")).toBe("03:00 AM");
  });
  it("uses safe offline endpoint projections without needing private flight details",()=>{
    const [departure,arrival]=points({...base,title:"Transport",flight:null,
      departureLocationName:"Departure",destinationLocationName:"Arrival",
      flightPresentation:{isFlight:true,departureTimeZone:"America/Chicago",arrivalTimeZone:"America/Denver"}});
    expect(formatTimelinePointTime(departure,"en","Asia/Tokyo")).toContain("CST");
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo")).toContain("MST");
  });
  it("keeps an untimed arrival empty instead of fabricating a clock or timezone warning",()=>{
    const arrival=points({...base,endsAt:null}).find(point=>point.kind==="arrival")!;
    expect(formatTimelinePointTime(arrival,"en","Asia/Tokyo")).toBe("");
  });
});
