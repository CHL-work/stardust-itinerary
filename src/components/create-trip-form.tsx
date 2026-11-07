"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { localeNames, locales, type Locale } from "@/lib/i18n";
import type { TripCreationOptions } from "@/lib/app/trip-creation-options";
import { submitTripCreation, tripCreationLocalDate, type TripCreationFailure, type TripCreationField } from "@/lib/app/trip-creation-feedback";
import { canSubmitTripCreation, initialTripCreationFormState, normalizedFormDestination, tripCreationFormReducer, type TripCreationFormAction } from "@/lib/app/trip-creation-form-state";
import type { DestinationLookupResponse } from "@/lib/app/trip-destination-contract";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import { createTripCopy } from "@/lib/app/create-trip-i18n";
import { InfoTip } from "@/components/info-tip";

export { createTripCopy } from "@/lib/app/create-trip-i18n";

export function CreateTripForm({ locale:initialLocale,now,optionsByLocale,authenticated,signupEnabled,lookupEntitled = false }:{locale:Locale;now:string;optionsByLocale:Record<Locale,TripCreationOptions>;authenticated:boolean;signupEnabled:boolean;lookupEntitled?:boolean}) {
  const [locale,setLocale] = useState(initialLocale);
  const [busy,setBusy] = useState(false);
  const [failure,setFailure] = useState<TripCreationFailure | null>(null);
  const [state,setState] = useState(initialTripCreationFormState);
  const stateRef = useRef(state);
  const lookupAbort = useRef<AbortController | null>(null);
  const [manualOpen,setManualOpen] = useState(!lookupEntitled);
  const [allZones,setAllZones] = useState(false);
  const initialToday = tripCreationLocalDate(now,"Asia/Tokyo");
  const [startsOn,setStartsOn] = useState(initialToday);
  const inFlight = useRef(false);
  const router = useRouter();
  const copy = createTripCopy(locale);
  const options = optionsByLocale[locale];
  // An unresolved Auto value must never be passed to Intl or silently saved as Tokyo.
  const today = state.zone ? tripCreationLocalDate(now,state.zone) : "";
  const ready = canSubmitTripCreation(state);
  const zoneLabel = options.timeZones.find((option) => option.value === state.zone)?.label ?? state.zone;
  const zoneOptions = !allZones && state.response?.countryTimeZones.length
    ? options.timeZones.filter((option) => state.response!.countryTimeZones.includes(option.value) || option.value === state.zone)
    : options.timeZones;
  const lookupStatus = failure?.kind === "auth" || failure?.kind === "forbidden" ? copy[failure.kind]
    : !lookupEntitled ? copy.lookupUnavailable : state.lookup === "pending" ? copy.lookupBusy
    : state.lookup === "resolved" && state.zone ? copy.announceResolved.replace("{zone}",zoneLabel).replace("{currency}",state.currency || copy.zoneChoose)
    : state.lookup === "ambiguous" ? copy.zoneAmbiguous
    : state.response?.reason === "private_text" ? copy.lookupPrivate
    : ["rate_limited","quota","busy"].includes(state.response?.reason ?? "") ? copy.lookupLimited
    : state.lookup === "unknown" || state.lookup === "unavailable" ? copy.lookupUnavailable : copy.zonePending;
  const fieldCopy:Record<TripCreationField,string> = {name:copy.nameError,destinationName:copy.destinationError,startsOn:copy.startError,endsOn:copy.endError,timeZone:copy.zoneError,defaultCurrency:copy.currencyError,maxMembers:copy.capacityError};
  const fieldLabels:Record<TripCreationField,string> = {name:copy.name,destinationName:copy.destination,startsOn:copy.start,endsOn:copy.end,timeZone:copy.zone,defaultCurrency:copy.currency,maxMembers:copy.capacity};
  const invalid = (field:TripCreationField) => failure?.kind === "fields" && failure.fields.includes(field);
  const fieldProps = (field:TripCreationField) => ({"aria-label":fieldLabels[field],"aria-invalid":invalid(field) || undefined,"aria-describedby":invalid(field) ? `create-trip-${field}-error` : undefined});
  const fieldError = (field:TripCreationField) => invalid(field) ? <small id={`create-trip-${field}-error`} className="trip-creation-field-error">{fieldCopy[field]}</small> : null;
  // Keep event handlers in sync even when blur and submit happen in the same tick.
  function send(action:TripCreationFormAction) {
    stateRef.current = tripCreationFormReducer(stateRef.current,action);
    setState(stateRef.current);
  }
  useEffect(() => () => lookupAbort.current?.abort(),[]);
  async function findDefaults(force = false) {
    const current = stateRef.current;
    const destination = current.destination.trim();
    if (!lookupEntitled || destination.length < 2 || destination.length > 160 || inFlight.current) return;
    if (current.lookup === "pending" || (!force && current.resolvedFor === normalizedFormDestination(destination))) return;
    lookupAbort.current?.abort();
    const abort = new AbortController();
    lookupAbort.current = abort;
    const generation = current.generation + 1;
    const requestId = crypto.randomUUID();
    send({type:"lookupStarted",generation});
    setFailure(null);
    const timeout = window.setTimeout(() => abort.abort(),25_000);
    try {
      const response = await fetch("/api/trips/destination-defaults",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({destination,locale,requestId}),signal:abort.signal});
      if (response.status === 401 || response.status === 403) {
        send({type:"lookupFailed",generation});
        if (stateRef.current.generation === generation) {setFailure({kind:response.status === 401 ? "auth" : "forbidden"}); setManualOpen(true);}
        return;
      }
      const result:DestinationLookupResponse = await response.json();
      if (!response.ok || result.requestId !== requestId || !["resolved","ambiguous","unknown","unavailable"].includes(result.status)
        || !Array.isArray(result.countryTimeZones) || !Array.isArray(result.timeZoneCandidates) || !Array.isArray(result.currencyCandidates)
        || (result.timeZone !== null && !options.timeZones.some((option) => option.value === result.timeZone))
        || (result.currency !== null && !options.currencies.some((option) => option.value === result.currency))) throw new Error("Invalid lookup response");
      send({type:"lookupSucceeded",generation,destination,response:result});
      if (stateRef.current.generation === generation && result.status !== "resolved") setManualOpen(true);
    } catch {
      send({type:"lookupFailed",generation});
      if (stateRef.current.generation === generation) setManualOpen(true);
    } finally {
      window.clearTimeout(timeout);
      if (lookupAbort.current === abort) lookupAbort.current = null;
    }
  }
  function focusFailure(form:HTMLFormElement, result:TripCreationFailure) {
    if (result.kind !== "fields") return;
    if (result.fields.includes("timeZone")) setManualOpen(true);
    window.requestAnimationFrame(() => {
      const field = form.elements.namedItem(result.fields[0]);
      if (field instanceof HTMLElement) field.focus();
    });
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!canSubmitTripCreation(stateRef.current)) {
      const result:TripCreationFailure = {kind:"fields",fields:[!stateRef.current.zone || stateRef.current.currency ? "timeZone" : "defaultCurrency"]};
      setFailure(result); focusFailure(form,result); return;
    }
    inFlight.current = true;
    setBusy(true); setFailure(null);
    const result = await submitTripCreation({ name:data.get("name"),destinationName:data.get("destinationName"),
          startsOn:data.get("startsOn"),endsOn:data.get("endsOn"),timeZone:data.get("timeZone"),
          defaultCurrency:data.get("defaultCurrency"),maxMembers:Number(data.get("maxMembers")),defaultLocale:locale,
          ...(stateRef.current.lookupId ? {destinationLookupId:stateRef.current.lookupId} : {}) },stateRef.current);
    if (result) { setFailure(result); setBusy(false); inFlight.current = false; focusFailure(form,result); return; }
    lookupAbort.current?.abort();
    router.push(`/${locale}`);
    router.refresh();
  }
  return <main className="auth-page"><section className="auth-panel trip-creation-panel">
    <label>{copy.language}<select aria-label={copy.language} disabled={busy} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
      {locales.map((value) => <option key={value} value={value}>{localeNames[value]}</option>)}
    </select></label>
    <h1>{copy.title}</h1>
    {authenticated ? <><p>{copy.intro}</p><form onSubmit={submit} noValidate>
      <fieldset disabled={busy} style={{border:0,padding:0,display:"grid",gap:"1rem"}}>
        <label>{copy.name}<input name="name" required maxLength={160} {...fieldProps("name")}/>{fieldError("name")}</label>
        <label>{copy.destination}<input name="destinationName" required maxLength={160} value={state.destination} {...fieldProps("destinationName")}
          onChange={(event) => { if (normalizedFormDestination(event.target.value) !== normalizedFormDestination(stateRef.current.destination)) lookupAbort.current?.abort(); send({type:"destinationChanged",value:event.target.value}); setAllZones(false); }}
          onBlur={() => void findDefaults()} onKeyDown={(event) => { if (event.key === "Enter") {event.preventDefault(); void findDefaults();} }}/>{fieldError("destinationName")}</label>
        {lookupEntitled ? <div className="trip-defaults-lookup"><button type="button" data-feedback-action="settings_save" className="auth-secondary" disabled={state.lookup === "pending" || state.destination.trim().length < 2} onClick={() => void findDefaults(true)}>{state.response ? copy.retry : copy.find}</button><InfoTip label={infoTipLabel(locale)}>{copy.aiDisclosure}</InfoTip></div> : null}
        <section className="trip-defaults-zone" aria-label={copy.zone}>
          <p><small>{state.zoneSource === "manual" ? copy.zoneManual : state.zone ? copy.zoneDetected : copy.zone}</small><br/><strong>{state.zone ? zoneLabel : lookupEntitled ? copy.auto : copy.zoneChoose}</strong></p>
          <p className="trip-defaults-status" role="status" aria-live="polite">{lookupStatus}</p>
          <details open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)}>
            <summary className="auth-secondary">{copy.zoneChange}</summary>
            {state.lookup === "ambiguous" && state.response?.timeZoneCandidates.length ? <fieldset className="trip-zone-candidates"><legend>{copy.oneZone}</legend>
              {state.response.timeZoneCandidates.map((candidate) => <label className="permission-toggle" key={candidate.value}><input type="radio" name="timeZoneCandidate" value={candidate.value} checked={state.zone === candidate.value} onChange={() => send({type:"zoneChosen",value:candidate.value})}/><span>{candidate.label[locale]}</span></label>)}
            </fieldset> : null}
            <label>{copy.zone}<select name="timeZone" required value={state.zone} onChange={(event) => {send({type:"zoneChosen",value:event.target.value}); if (!event.target.value && !stateRef.current.zone) void findDefaults(true);}} {...fieldProps("timeZone")}>
              <option value="">{lookupEntitled ? copy.auto : copy.zoneChoose}</option>
              {zoneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select><small>{copy.zoneHint}</small>{fieldError("timeZone")}</label>
            {!allZones && state.response?.countryTimeZones.length ? <button type="button" className="auth-secondary" onClick={() => setAllZones(true)}>{copy.zoneOther}</button> : null}
          </details>
        </section>
        <label>{copy.start}<input name="startsOn" type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} {...fieldProps("startsOn")}/>{fieldError("startsOn")}</label>
        <label>{copy.end}<input name="endsOn" type="date" required min={startsOn > today ? startsOn : today} defaultValue={initialToday} {...fieldProps("endsOn")}/>{fieldError("endsOn")}</label>
        <label>{copy.currency}<select name="defaultCurrency" required value={state.currency} onChange={(event) => send({type:"currencyChosen",value:event.target.value})} {...fieldProps("defaultCurrency")}>
          <option value="">{copy.zoneChoose}</option>
          {options.currencies.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select><small>{state.response?.unsupportedLocalCurrency ? copy.currencyUnsupported.replace("{code}",state.response.unsupportedLocalCurrency)
          : state.response?.currencyCandidates.some((code) => code !== state.response?.currency) ? copy.currencyMultiple
          : state.currencySource === "lookup" && state.currency ? copy.currencySuggested : copy.currencyCheck} {copy.currencyHint}</small>{fieldError("defaultCurrency")}</label>
        {state.currencySource === "manual" && state.response?.currency && state.currency !== state.response.currency ? <button type="button" className="auth-secondary" onClick={() => send({type:"useSuggestedCurrency"})}>{copy.currencyUseSuggested.replace("{code}",state.response.currency)}</button> : null}
        <label>{copy.capacity}<input name="maxMembers" type="number" required min={1} max={20} defaultValue={10} {...fieldProps("maxMembers")}/>{fieldError("maxMembers")}</label>
        <button className="auth-primary" type="submit" aria-disabled={!ready || busy}>{busy ? copy.busy : copy.create}</button>
      </fieldset>
      {busy ? <p role="status">{copy.busy}</p> : null}
      {failure ? <p role="alert">{failure.kind === "fields" || failure.kind === "invalid" ? copy.error : copy[failure.kind]}</p> : null}
      {failure?.kind === "auth" ? <Link className="auth-secondary" href="/auth/sign-in">{copy.signin}</Link> : null}
    </form></> : <><p>{signupEnabled ? copy.required : copy.closed}</p><form action="/api/auth/google/start" method="get"><button className="auth-primary" type="submit">{copy.signin}</button></form></>}
    <a className="auth-secondary" href={`/${locale}`}>{copy.back}</a>
  </section></main>;
}
