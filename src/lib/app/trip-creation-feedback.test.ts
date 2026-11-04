import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { submitTripCreation,tripCreationLocalDate } from "./trip-creation-feedback";
import { initialTripCreationFormState, tripCreationFormReducer } from "./trip-creation-form-state";

const input = {name:"Dallas October test",destinationName:"Dallas",startsOn:"2026-10-08",endsOn:"2026-10-31",timeZone:"America/Chicago",defaultCurrency:"usd",defaultLocale:"en",maxMembers:10};
const fetchMock = vi.fn();
describe("trip creation submission feedback",() => {
  beforeEach(() => {vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-08T04:30:00Z"));vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();});
  afterEach(() => {vi.useRealTimers();vi.unstubAllGlobals();});
  it("sends canonical values and accepts only a confirmed creation",async () => {
    fetchMock.mockResolvedValue(Response.json({tripId:"new-trip",memberId:"new-owner"},{status:201}));
    expect(await submitTripCreation(input)).toBeNull();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/trips",expect.objectContaining({method:"POST"}));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({...input,defaultCurrency:"USD"});
  });
  it("rejects the reported Dallas/USA free-text input before a network write",async () => {
    expect(await submitTripCreation({...input,timeZone:"Dallas",defaultCurrency:"USA"})).toEqual({kind:"fields",fields:["timeZone","defaultCurrency"]});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not reject a Dallas-local date just because it is already tomorrow in Tokyo",async () => {
    fetchMock.mockResolvedValue(Response.json({tripId:"trip",memberId:"member"},{status:201}));
    expect(tripCreationLocalDate(new Date(),"Asia/Tokyo")).toBe("2026-10-08");
    expect(tripCreationLocalDate(new Date(),"America/Chicago")).toBe("2026-10-07");
    expect(await submitTripCreation({...input,startsOn:"2026-10-07",endsOn:"2026-10-07"})).toBeNull();
  });
  it("uses destination-local today on submit, not the page's old load date",async () => {
    vi.setSystemTime(new Date("2026-11-01T20:00:00Z"));
    expect(await submitTripCreation(input)).toEqual({kind:"fields",fields:["endsOn"]});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [400,{issues:[{path:["timeZone"],message:"secret internal detail"}]},{kind:"fields",fields:["timeZone"]}],
    [400,{error:"A new trip cannot end before today in its local time zone."},{kind:"fields",fields:["endsOn"]}],
    [400,{issues:[{path:["arbitrary"],message:"secret"}]},{kind:"invalid"}],
    [401,{error:"internal"},{kind:"auth"}],
    [403,{error:"internal"},{kind:"forbidden"}],
    [409,{error:"The daily limit of 10 new trips has been reached."},{kind:"limit"}],
    [409,{error:"unrelated conflict"},{kind:"uncertain"}],
    [500,{error:"secret database exception"},{kind:"uncertain"}],
    [200,{tripId:"trip",memberId:"member"},{kind:"uncertain"}],
    [201,{}, {kind:"uncertain"}],
  ])("maps status %i safely without displaying upstream prose",async (status,body,expected) => {
    fetchMock.mockResolvedValue(Response.json(body,{status:status as number}));
    expect(await submitTripCreation(input)).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("handles proxy HTML and network errors without replaying a possibly successful write",async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>",{status:502}));
    expect(await submitTripCreation(input)).toEqual({kind:"uncertain"});
    fetchMock.mockRejectedValue(new TypeError("Network unavailable"));
    expect(await submitTripCreation(input)).toEqual({kind:"uncertain"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("uses DST-aware destination dates",() => {
    expect(tripCreationLocalDate("2026-10-08T05:30:00Z","America/Chicago")).toBe("2026-10-08");
    expect(tripCreationLocalDate("2026-12-08T05:30:00Z","America/Chicago")).toBe("2026-12-07");
  });
  it("never writes a stale/pending Auto destination even when the form carries an old valid zone",async () => {
    expect(await submitTripCreation(input,initialTripCreationFormState())).toEqual({kind:"fields",fields:["timeZone"]});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows manual time-zone selection without waiting for AI",async () => {
    fetchMock.mockResolvedValue(Response.json({tripId:"trip",memberId:"member"},{status:201}));
    const state = tripCreationFormReducer({...initialTripCreationFormState(),lookup:"pending"},{type:"zoneChosen",value:"America/Chicago"});
    expect(await submitTripCreation(input,state)).toBeNull();
  });
});
