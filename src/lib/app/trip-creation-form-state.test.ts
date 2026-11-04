import { describe, expect, it } from "vitest";
import { canSubmitTripCreation, initialTripCreationFormState, tripCreationFormReducer as reduce } from "./trip-creation-form-state";
import type { DestinationLookupResponse } from "./trip-destination-contract";

const resolved:DestinationLookupResponse = {status:"resolved",reason:null,countryCode:"JP",countryLabels:null,
  timeZone:"Asia/Tokyo",timeZoneCandidates:[],countryTimeZones:["Asia/Tokyo"],currency:"JPY",currencyCandidates:["JPY"],unsupportedLocalCurrency:null,
  requestId:"request",lookupId:"lookup",source:"ai"};
const pending = () => reduce(initialTripCreationFormState(),{type:"lookupStarted",generation:1});
const finish = (state = pending(), response = resolved) => reduce(state,{type:"lookupSucceeded",generation:1,destination:"Japan",response});

describe("destination default form state",() => {
  it("starts Auto unresolved even for a country, and cannot silently submit Tokyo",() => {
    const state = initialTripCreationFormState();
    expect(state.zone).toBe(""); expect(state.lookup).toBe("idle");
    expect(state.currency).toBe("JPY"); expect(canSubmitTripCreation(state)).toBe(false);
  });
  it("uses a completed lookup without submitting a trip",() => {
    expect(canSubmitTripCreation(pending())).toBe(false);
    const state = finish();
    expect(state).toMatchObject({zone:"Asia/Tokyo",zoneSource:"lookup",currency:"JPY",resolvedFor:"japan",lookupId:"lookup"});
    expect(canSubmitTripCreation(state)).toBe(true);
  });
  it("invalidates an old destination immediately while typing, before blur",() => {
    const state = reduce(finish(),{type:"destinationChanged",value:"Dallas"});
    expect(state).toMatchObject({zone:"",currency:"",lookupId:null,lookup:"idle",resolvedFor:null});
    expect(canSubmitTripCreation(state)).toBe(false);
  });
  it("ignores a late response after typing another destination or starting another generation",() => {
    const changed = reduce(pending(),{type:"destinationChanged",value:"Dallas"});
    expect(finish(changed)).toEqual(changed);
    expect(reduce(changed,{type:"lookupFailed",generation:1})).toEqual(changed);
    const again = reduce(pending(),{type:"lookupStarted",generation:2});
    expect(finish(again)).toEqual(again);
  });
  it("requires both destination and generation to match, without rejecting harmless spelling normalization",() => {
    expect(finish(reduce(pending(),{type:"destinationChanged",value:"  ＪＡＰＡＮ  "})).zone).toBe("Asia/Tokyo");
    expect(reduce(pending(),{type:"lookupSucceeded",generation:1,destination:"Dallas",response:resolved})).toEqual(pending());
  });
  it("preserves manual zone and currency across destination changes and lookup completion",() => {
    let state = reduce(pending(),{type:"zoneChosen",value:"America/Chicago"});
    state = reduce(state,{type:"currencyChosen",value:"USD"});
    expect(canSubmitTripCreation(state)).toBe(true);
    state = finish(state);
    expect(state).toMatchObject({zone:"America/Chicago",currency:"USD",zoneSource:"manual",currencySource:"manual"});
    state = reduce(state,{type:"destinationChanged",value:"Hong Kong"});
    expect(state).toMatchObject({zone:"America/Chicago",currency:"USD",lookupId:null});
    expect(canSubmitTripCreation(state)).toBe(true);
  });
  it("offers a suggestion without overwriting manual currency",() => {
    const state = finish(reduce(pending(),{type:"currencyChosen",value:"HKD"}));
    expect(state.currency).toBe("HKD");
    expect(reduce(state,{type:"useSuggestedCurrency"})).toMatchObject({currency:"JPY",currencySource:"lookup"});
  });
  it.each(["ambiguous","unknown","unavailable"] as const)("does not silently resolve %s",(status) => {
    const state = finish(pending(),{...resolved,status,timeZone:null,currency:null});
    expect(state.zone).toBe(""); expect(canSubmitTripCreation(state)).toBe(false);
  });
  it("requires explicit supported currency when local currency is unsupported",() => {
    let state = finish(pending(),{...resolved,currency:null,currencyCandidates:[],unsupportedLocalCurrency:"IDR"});
    expect(canSubmitTripCreation(state)).toBe(false);
    state = reduce(state,{type:"currencyChosen",value:"USD"});
    expect(canSubmitTripCreation(state)).toBe(true);
  });
  it("keeps manual choices after a timeout, while automatic stale values stay blocked",() => {
    let state = reduce(pending(),{type:"zoneChosen",value:"UTC"});
    state = reduce(state,{type:"currencyChosen",value:"EUR"});
    state = reduce(state,{type:"lookupFailed",generation:1});
    expect(canSubmitTripCreation(state)).toBe(true);
    expect(reduce(pending(),{type:"lookupFailed",generation:1}).zone).toBe("");
  });
  it("changing a manual zone back to Auto reuses only the current validated response",() => {
    const manual = reduce(finish(),{type:"zoneChosen",value:"America/Chicago"});
    const state = reduce(manual,{type:"zoneChosen",value:""});
    expect(state).toMatchObject({zone:"Asia/Tokyo",zoneSource:"lookup"}); expect(canSubmitTripCreation(state)).toBe(true);
    const changed = reduce(manual,{type:"destinationChanged",value:"Dallas"});
    expect(reduce(changed,{type:"zoneChosen",value:""}).zone).toBe("");
  });
});
