"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { locales, type Locale } from "@/lib/i18n";
import type { TripCreationOptions } from "@/lib/app/trip-creation-options";
import { submitTripCreation, tripCreationLocalDate, type TripCreationFailure, type TripCreationField } from "@/lib/app/trip-creation-feedback";
import { canSubmitTripCreation, initialTripCreationFormState, normalizedFormDestination, tripCreationFormReducer, type TripCreationFormAction } from "@/lib/app/trip-creation-form-state";
import type { DestinationLookupResponse } from "@/lib/app/trip-destination-contract";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import { InfoTip } from "@/components/info-tip";

const en = { title:"Create your trip",intro:"You will own this trip.",
  name:"Trip name",destination:"Destination",start:"Start date",end:"End date",zone:"Time zone",currency:"Currency",capacity:"Maximum members (including owners)",
  language:"Language",create:"Create trip",busy:"Creating trip…",error:"Check the trip details, then try again.",
  auth:"Your sign-in has expired. Sign in with Google again before creating the trip.",limit:"You have reached 10 new trips today (UTC). Try again after midnight UTC.",forbidden:"Trip creation is not available with this sign-in. Return to the app or sign in again.",uncertain:"We could not confirm whether the trip was created. Check your trip list before trying again to avoid duplicates.",
  nameError:"Enter a trip name (1–160 characters).",destinationError:"Enter a destination (1–160 characters).",startError:"Choose a valid start date.",endError:"Choose an end date on or after the start and today at the destination. A trip can span at most 366 dates.",zoneError:"Choose a time zone from the list.",currencyError:"Choose a supported currency from the list.",capacityError:"Choose 1–20 members, including owners.",zoneHint:"Choose the destination’s time zone. Daylight saving is handled automatically.",currencyHint:"Select the currency, not the country: US dollars are USD.",
  auto:"Auto (AI lookup)",zoneChange:"Change time zone",zoneDetected:"Time zone from destination",zoneManual:"Time zone you selected",zoneChoose:"Choose…",find:"Find defaults",retry:"Find again",lookupBusy:"Finding the time zone and currency… You can choose manually without waiting.",lookupUnavailable:"Automatic lookup is unavailable. Choose the time zone and currency below.",lookupLimited:"Automatic lookup is busy or has reached its limit. Try again later, or choose manually now.",lookupPrivate:"Enter only a public destination, such as a city or country. Choose the defaults manually for private details.",zonePending:"Find defaults for this destination, or choose the time zone manually.",zoneAmbiguous:"This destination has several possible time zones. Choose the main one for your trip.",oneZone:"A trip uses one time zone for its schedule.",zoneOther:"Other time zone…",currencySuggested:"Suggested from the destination. You can choose a different currency.",currencyMultiple:"More than one currency is common here. Check your selection.",currencyUnsupported:"The local currency ({code}) is not supported for expenses yet. Choose the currency your group will record.",currencyCheck:"Check the currency for this destination.",currencyUseSuggested:"Use {code} (suggested)",announceResolved:"Time zone: {zone}. Currency: {currency}.",aiDisclosure:"When you finish editing the destination or select Find defaults, its text is sent to the host’s AI and the lookup is logged. No trip is created until you select Create trip.",
  signin:"Continue with Google",required:"Sign in with Google to create a trip.",closed:"Public signup is not enabled. Existing trip members may sign in and create another trip.",back:"Back" };
const hk:typeof en = { title:"建立新旅程",intro:"你會成為呢個旅程嘅擁有人。",
  name:"旅程名稱",destination:"目的地",start:"開始日期",end:"結束日期",zone:"時區",currency:"貨幣",capacity:"成員上限（包括擁有人）",language:"語言",create:"建立旅程",busy:"正在建立旅程…",
  error:"請檢查旅程資料，再試一次。",auth:"登入已過期。請重新以 Google 登入，再建立旅程。",limit:"你今日（UTC）已建立 10 個旅程，請於 UTC 午夜後再試。",forbidden:"目前的登入狀態無法建立旅程。請返回應用程式或重新登入。",uncertain:"未能確認旅程是否已建立。請先檢查旅程列表，再決定是否重試，以免重複建立。",
  nameError:"請輸入旅程名稱（1–160 字元）。",destinationError:"請輸入目的地（1–160 字元）。",startError:"請選擇有效的開始日期。",endError:"結束日期不得早於開始日期及目的地的今天；旅程最多涵蓋 366 日。",zoneError:"請從列表選擇時區。",currencyError:"請從列表選擇支援的貨幣。",capacityError:"請選擇 1–20 位成員，包括擁有人。",zoneHint:"請選擇目的地時區，系統會自動處理夏令時間。",currencyHint:"請選擇貨幣，而非國家；美元的代碼是 USD。",signin:"以 Google 繼續",required:"請先用 Google 登入，再建立旅程。",
  auto:"自動（AI 查詢）",zoneChange:"更改時區",zoneDetected:"目的地時區",zoneManual:"你選擇的時區",zoneChoose:"請選擇…",find:"查找預設值",retry:"再查一次",lookupBusy:"正在查找時區及貨幣…你亦可立即自行選擇。",lookupUnavailable:"暫時未能自動查詢，請在下方選擇時區及貨幣。",lookupLimited:"自動查詢忙碌或已達上限。你可稍後重試，或立即自行選擇。",lookupPrivate:"請只輸入城市或國家等公開目的地。涉及私人資料時，請自行選擇預設值。",zonePending:"請查找此目的地的預設值，或自行選擇時區。",zoneAmbiguous:"此目的地可能涵蓋多個時區，請選擇旅程的主要時區。",oneZone:"每個旅程只用一個時區排程。",zoneOther:"其他時區…",currencySuggested:"已按目的地建議，你可以改選其他貨幣。",currencyMultiple:"當地常用多於一種貨幣，請確認所選貨幣。",currencyUnsupported:"暫時未支援以當地貨幣（{code}）記帳，請選擇團隊記帳用的貨幣。",currencyCheck:"請確認此目的地的貨幣。",currencyUseSuggested:"使用 {code}（建議）",announceResolved:"時區：{zone}。貨幣：{currency}。",aiDisclosure:"完成編輯目的地或按「查找預設值」時，系統會將目的地文字傳送至主機的 AI，並記錄查詢。只有按「建立旅程」後才會建立旅程。",
  closed:"目前未開放公開註冊。現有旅程成員可以登入後建立另一個旅程。",back:"返回" };
const ja:typeof en = { title:"旅行を作成",intro:"この旅行のオーナーになります。",
  name:"旅行名",destination:"目的地",start:"開始日",end:"終了日",zone:"タイムゾーン",currency:"通貨",capacity:"人数上限（オーナーを含む）",language:"言語",create:"旅行を作成",busy:"作成中…",
  error:"旅行の入力内容を確認し、もう一度お試しください。",auth:"ログインの有効期限が切れました。Googleで再ログインしてから旅行を作成してください。",limit:"本日（UTC）の作成上限10件に達しました。UTCの午前0時以降にお試しください。",forbidden:"現在のログイン状態では旅行を作成できません。アプリに戻るか、再ログインしてください。",uncertain:"旅行が作成されたか確認できません。重複を避けるため、再試行の前に旅行一覧を確認してください。",
  nameError:"旅行名を1～160文字で入力してください。",destinationError:"目的地を1～160文字で入力してください。",startError:"有効な開始日を選択してください。",endError:"終了日は開始日および目的地の今日以降にしてください。旅行期間は最大366日です。",zoneError:"一覧からタイムゾーンを選択してください。",currencyError:"一覧から対応する通貨を選択してください。",capacityError:"オーナーを含め1～20人を選択してください。",zoneHint:"目的地のタイムゾーンを選択してください。夏時間は自動で適用されます。",currencyHint:"国名ではなく通貨を選んでください。米ドルはUSDです。",signin:"Googleで続行",required:"旅行を作成するにはGoogleでログインしてください。",
  auto:"自動（AIで確認）",zoneChange:"タイムゾーンを変更",zoneDetected:"目的地のタイムゾーン",zoneManual:"選択したタイムゾーン",zoneChoose:"選択してください…",find:"初期値を確認",retry:"再検索",lookupBusy:"タイムゾーンと通貨を確認中…待たずに手動でも選択できます。",lookupUnavailable:"自動確認を利用できません。下からタイムゾーンと通貨を選択してください。",lookupLimited:"自動確認が混み合っているか、上限に達しました。後で再試行するか、今すぐ手動で選択してください。",lookupPrivate:"都市や国など公開の目的地だけを入力してください。個人情報を含む場合は手動で選択してください。",zonePending:"目的地の初期値を確認するか、タイムゾーンを手動で選択してください。",zoneAmbiguous:"この目的地には複数のタイムゾーンが考えられます。主な滞在地を選択してください。",oneZone:"旅行の予定は1つのタイムゾーンで管理します。",zoneOther:"その他のタイムゾーン…",currencySuggested:"目的地から提案しています。別の通貨も選べます。",currencyMultiple:"複数の通貨が使われています。選択内容を確認してください。",currencyUnsupported:"現地通貨（{code}）は費用記録に対応していません。グループが記録する通貨を選択してください。",currencyCheck:"この目的地の通貨を確認してください。",currencyUseSuggested:"{code} を使う（提案）",announceResolved:"タイムゾーン：{zone}。通貨：{currency}。",aiDisclosure:"目的地の編集を終えるか「初期値を確認」を押すと、目的地の文字列をホストのAIに送信し、検索を記録します。「旅行を作成」を押すまで旅行は作成されません。",
  closed:"一般登録はまだ有効ではありません。既存の旅行メンバーはログインして別の旅行を作成できます。",back:"戻る" };
export function createTripCopy(locale:Locale):typeof en { return locale === "en" ? en : locale === "ja-JP" ? ja : hk; }

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
      {locales.map((value) => <option key={value} value={value}>{value === "en" ? "English" : value === "ja-JP" ? "日本語" : value === "zh-HK-lihkg" ? "廣東話(辛辣)" : "廣東話"}</option>)}
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
