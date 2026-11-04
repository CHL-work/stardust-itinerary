import type { DestinationLookupResponse } from "./trip-destination-contract";

export type TripCreationFormState = {
  destination: string;
  resolvedFor: string | null;
  lookup: "idle" | "pending" | DestinationLookupResponse["status"];
  generation: number;
  zone: string;
  zoneSource: "lookup" | "manual" | null;
  currency: string;
  currencySource: "initial" | "lookup" | "manual";
  response: DestinationLookupResponse | null;
  lookupId: string | null;
};

export const normalizedFormDestination = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

/** Auto deliberately has no zone until an explicit AI lookup completes. */
export function initialTripCreationFormState(): TripCreationFormState {
  return { destination: "Japan", resolvedFor: null, lookup: "idle", generation: 0,
    zone: "", zoneSource: null, currency: "JPY", currencySource: "initial", response: null, lookupId: null };
}

export type TripCreationFormAction =
  | { type: "destinationChanged"; value: string }
  | { type: "lookupStarted"; generation: number }
  | { type: "lookupSucceeded"; generation: number; destination: string; response: DestinationLookupResponse }
  | { type: "lookupFailed"; generation: number }
  | { type: "zoneChosen"; value: string }
  | { type: "currencyChosen"; value: string }
  | { type: "useSuggestedCurrency" };

export function tripCreationFormReducer(state: TripCreationFormState, action: TripCreationFormAction): TripCreationFormState {
  switch (action.type) {
    case "destinationChanged": {
      if (normalizedFormDestination(action.value) === normalizedFormDestination(state.destination)) return { ...state, destination: action.value };
      return { ...state, destination: action.value, generation: state.generation + 1, resolvedFor: null,
        lookup: "idle", response: null, lookupId: null,
        zone: state.zoneSource === "manual" ? state.zone : "", zoneSource: state.zoneSource === "manual" ? "manual" : null,
        currency: state.currencySource === "manual" ? state.currency : "",
        currencySource: state.currencySource === "manual" ? "manual" : "initial" };
    }
    case "lookupStarted":
      return { ...state, generation: action.generation, lookup: "pending", lookupId: null };
    case "lookupSucceeded": {
      if (action.generation !== state.generation || normalizedFormDestination(action.destination) !== normalizedFormDestination(state.destination)) return state;
      const response = action.response;
      return { ...state, lookup: response.status, resolvedFor: normalizedFormDestination(action.destination), response,
        lookupId: response.lookupId,
        zone: state.zoneSource === "manual" ? state.zone : response.status === "resolved" ? response.timeZone ?? "" : "",
        zoneSource: state.zoneSource === "manual" ? "manual" : response.status === "resolved" && response.timeZone ? "lookup" : null,
        currency: state.currencySource === "manual" ? state.currency : response.currency ?? "",
        currencySource: state.currencySource === "manual" ? "manual" : "lookup" };
    }
    case "lookupFailed":
      return action.generation !== state.generation ? state : { ...state, lookup: "unavailable", response: null, lookupId: null,
        zone: state.zoneSource === "manual" ? state.zone : "", zoneSource: state.zoneSource === "manual" ? "manual" : null,
        currency: state.currencySource === "manual" ? state.currency : "", resolvedFor: null };
    case "zoneChosen":
      if (!action.value && state.lookup === "resolved" && state.resolvedFor === normalizedFormDestination(state.destination) && state.response?.timeZone) {
        return { ...state, zone: state.response.timeZone, zoneSource: "lookup" };
      }
      return { ...state, zone: action.value, zoneSource: action.value ? "manual" : null };
    case "currencyChosen":
      return { ...state, currency: action.value, currencySource: "manual" };
    case "useSuggestedCurrency":
      return state.response?.currency ? { ...state, currency: state.response.currency, currencySource: "lookup" } : state;
  }
}

/** Manual selection can proceed even while the optional lookup is unavailable or pending. */
export function canSubmitTripCreation(state: TripCreationFormState): boolean {
  return Boolean(state.zone && state.currency && (state.zoneSource === "manual"
    || (state.lookup === "resolved" && state.resolvedFor === normalizedFormDestination(state.destination))));
}
