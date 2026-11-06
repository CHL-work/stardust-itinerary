"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type {
  AdminAccount, AdminAccountDetail, AdminAccountFilter, AdminAccountPage, AdminAiCounts, AdminOverview,
} from "@/lib/admin/contracts";
import { adminCopy, refusalScopeLabel, type AdminCopy } from "@/lib/admin/i18n";
import { withStableSession } from "@/lib/auth/client-session";
import { formatMessage, type Locale } from "@/lib/i18n";
import styles from "./admin-console.module.css";

/**
 * The operator's admin page (JOB-069): totals, the sign-up cap and the account list with each
 * account's activity and a suspend switch. It shows metadata and counts only.
 */
type Phase = "loading" | "ready" | "failed";
type DetailState = AdminAccountDetail | "loading" | "failed";

const providerNames: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Gemini", kilo: "Kilo (free)" };
const filters: { value: AdminAccountFilter; label: keyof AdminCopy }[] = [
  { value: "all", label: "filterAll" }, { value: "google", label: "filterGoogle" },
  { value: "guest", label: "filterGuest" }, { value: "suspended", label: "filterSuspended" },
];

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await withStableSession(() => fetch(url, {
    cache: "no-store", credentials: "same-origin", ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  }));
  if (!response.ok) throw new Error(`admin_request_${response.status}`);
  return await response.json() as T;
}

function useFormatters(locale: Locale) {
  const intlLocale = locale === "zh-HK-lihkg" ? "zh-HK" : locale;
  const number = new Intl.NumberFormat(intlLocale);
  const dateTime = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" });
  const date = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" });
  const utcDay = new Intl.DateTimeFormat(intlLocale, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
  return {
    n: (value: number) => number.format(value),
    when: (value: string) => dateTime.format(new Date(value)),
    day: (value: string) => date.format(new Date(value)),
    utcDay: (value: string) => utcDay.format(new Date(`${value}T00:00:00Z`)),
  };
}

type Formatters = ReturnType<typeof useFormatters>;

function aiLine(template: string, counts: AdminAiCounts, f: Formatters): string {
  return formatMessage(template, { own: f.n(counts.own), shared: f.n(counts.shared), operator: f.n(counts.operator), free: f.n(counts.free) });
}

export function AdminConsole({ locale }: { locale: Locale }) {
  const copy = adminCopy(locale);
  const f = useFormatters(locale);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewPhase, setOverviewPhase] = useState<Phase>("loading");
  const [filter, setFilter] = useState<AdminAccountFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<AdminAccountPage | null>(null);
  const [listPhase, setListPhase] = useState<Phase>("loading");
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const listRequest = useRef(0);

  // State changes only in the callbacks: the page keeps showing what it has until fresh data arrives.
  const loadOverview = useCallback(() => {
    readJson<AdminOverview>("/api/admin/overview")
      .then((body) => { setOverview(body); setOverviewPhase("ready"); }, () => setOverviewPhase("failed"));
  }, []);

  const loadAccounts = useCallback((offset: number) => {
    const request = ++listRequest.current;
    const params = new URLSearchParams({ filter, q: query, offset: String(offset) });
    readJson<AdminAccountPage>(`/api/admin/accounts?${params}`).then((body) => {
      if (request !== listRequest.current) return;
      setPage((current) => offset === 0 || !current ? body
        : { ...body, accounts: [...current.accounts, ...body.accounts.filter((row) => !current.accounts.some((seen) => seen.userId === row.userId))] });
      setListPhase("ready");
    }, () => { if (request === listRequest.current) setListPhase("failed"); });
  }, [filter, query]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadAccounts(0); }, [loadAccounts]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const refresh = () => {
    setDetails({});
    setOverviewPhase("loading");
    setListPhase("loading");
    loadOverview();
    loadAccounts(0);
  };

  const toggleDetails = (userId: string) => {
    if (details[userId] && details[userId] !== "failed") {
      setDetails((current) => { const next = { ...current }; delete next[userId]; return next; });
      return;
    }
    setDetails((current) => ({ ...current, [userId]: "loading" }));
    readJson<AdminAccountDetail>(`/api/admin/accounts/${encodeURIComponent(userId)}`)
      .then((body) => setDetails((current) => ({ ...current, [userId]: body })),
        () => setDetails((current) => ({ ...current, [userId]: "failed" })));
  };

  const replaceAccount = (updated: AdminAccount) => setPage((current) => current
    ? { ...current, accounts: current.accounts.map((row) => row.userId === updated.userId ? updated : row) } : current);

  const setSuspended = async (target: AdminAccount, suspended: boolean) => {
    setBusy(target.userId);
    setFailure(null);
    try {
      const body = await readJson<{ account: AdminAccount }>(`/api/admin/accounts/${encodeURIComponent(target.userId)}/suspension`, {
        method: "PUT", body: JSON.stringify({ suspended }),
      });
      replaceAccount(body.account);
      setConfirming(null);
      if (details[target.userId]) {
        readJson<AdminAccountDetail>(`/api/admin/accounts/${encodeURIComponent(target.userId)}`)
          .then((detail) => setDetails((current) => ({ ...current, [target.userId]: detail })), () => {});
      }
      loadOverview();
    } catch {
      setFailure(target.userId);
    } finally {
      setBusy(null);
    }
  };

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Stardust</p>
        <h1>{copy.title}</h1>
        <p className={styles.intro}>{copy.intro}</p>
      </div>
      <div className={styles.headerActions}>
        <button type="button" className={styles.secondary} onClick={refresh}>{copy.refresh}</button>
        <a className={styles.secondary} href={`/${locale}`}>{copy.back}</a>
      </div>
    </header>

    <section className={styles.section} aria-labelledby="admin-overview">
      <h2 id="admin-overview">{copy.overview}</h2>
      {overviewPhase === "loading" && !overview ? <p role="status">{copy.loading}</p> : null}
      {overviewPhase === "failed" ? <p role="alert">{copy.loadFailed} <button type="button" className={styles.link}
        onClick={() => { setOverviewPhase("loading"); loadOverview(); }}>{copy.retry}</button></p> : null}
      {overview ? <OverviewView copy={copy} f={f} overview={overview} /> : null}
    </section>

    {overview ? <SignupLimit copy={copy} f={f} signup={overview.signup} changed={loadOverview} /> : null}

    <section className={styles.section} aria-labelledby="admin-accounts">
      <h2 id="admin-accounts">{copy.accounts}</h2>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>{copy.search}</span>
          <input type="search" value={search} placeholder={copy.search} maxLength={120} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className={styles.filters} role="group" aria-label={copy.accounts}>
          {filters.map((option) => <button type="button" key={option.value} aria-pressed={filter === option.value}
            className={filter === option.value ? styles.chipActive : styles.chip} onClick={() => setFilter(option.value)}>{copy[option.label]}</button>)}
        </div>
      </div>
      {listPhase === "loading" ? <p role="status">{copy.loading}</p> : null}
      {listPhase === "failed" ? <p role="alert">{copy.loadFailed} <button type="button" className={styles.link}
        onClick={() => { setListPhase("loading"); loadAccounts(0); }}>{copy.retry}</button></p> : null}
      {listPhase === "ready" && page ? <>
        <p className={styles.muted}>{formatMessage(copy.shown, { shown: f.n(page.accounts.length), total: f.n(page.total) })}</p>
        {page.accounts.length === 0 ? <p>{copy.none}</p> : null}
        <ul className={styles.accountList}>
          {page.accounts.map((account) => <AccountCard key={account.userId} copy={copy} f={f} account={account}
            detail={details[account.userId]} confirming={confirming === account.userId} busy={busy === account.userId}
            failed={failure === account.userId} toggleDetails={() => toggleDetails(account.userId)}
            askSuspend={() => { setFailure(null); setConfirming(account.userId); }} cancel={() => setConfirming(null)}
            setSuspended={(suspended) => void setSuspended(account, suspended)} />)}
        </ul>
        {page.nextOffset !== null ? <button type="button" className={styles.secondary} onClick={() => loadAccounts(page.nextOffset!)}>{copy.loadMore}</button> : null}
      </> : null}
    </section>
  </main>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className={styles.stat}><span className={styles.statLabel}>{label}</span><strong>{value}</strong>{detail ? <span className={styles.muted}>{detail}</span> : null}</div>;
}

function OverviewView({ copy, f, overview }: { copy: AdminCopy; f: Formatters; overview: AdminOverview }) {
  const ai = overview.ai;
  const total = (counts: AdminAiCounts) => counts.own + counts.shared + counts.operator + counts.free;
  return <>
    <div className={styles.stats}>
      <Stat label={copy.accounts} value={f.n(overview.accounts.google)} detail={formatMessage(copy.newWeek, { count: f.n(overview.accounts.new7d) })} />
      <Stat label={copy.active} value={f.n(overview.active.week)}
        detail={formatMessage(copy.activeDetail, { day: f.n(overview.active.day), week: f.n(overview.active.week), month: f.n(overview.active.month) })} />
      <Stat label={copy.guestsNow} value={f.n(overview.accounts.guestsActive)} />
      <Stat label={copy.suspended} value={f.n(overview.accounts.suspended)} />
      <Stat label={copy.trips} value={f.n(overview.trips.active)} detail={formatMessage(copy.tripsWeek, { count: f.n(overview.trips.created7d) })} />
      <Stat label={copy.aiRequests} value={f.n(total(ai.week))}
        detail={formatMessage(copy.aiWindows, { today: f.n(total(ai.today)), week: f.n(total(ai.week)), month: f.n(total(ai.month)) })} />
    </div>
    <div className={styles.panels}>
      <div className={styles.panel}>
        <h3>{copy.paidBy}</h3>
        <dl className={styles.pairs}>
          <dt>{copy.paidOwn}</dt><dd>{f.n(ai.week.own)}</dd>
          <dt>{copy.paidShared}</dt><dd>{f.n(ai.week.shared)}</dd>
          <dt>{copy.paidOperator}</dt><dd>{f.n(ai.week.operator)}</dd>
          <dt>{copy.paidFree}</dt><dd>{f.n(ai.week.free)}</dd>
          <dt>{copy.aiRefused}</dt><dd>{f.n(ai.refusedWeek)}</dd>
          <dt>{copy.aiFailed}</dt><dd>{f.n(ai.failedWeek)}</dd>
        </dl>
      </div>
      <div className={styles.panel}>
        <h3>{copy.providers}</h3>
        {ai.providersWeek.length ? <dl className={styles.pairs}>{ai.providersWeek.map((row) => <div key={row.provider} className={styles.pair}>
          <dt>{providerNames[row.provider] ?? row.provider}</dt><dd>{f.n(row.count)}</dd></div>)}</dl> : <p className={styles.muted}>0</p>}
      </div>
      <div className={styles.panel}>
        <h3>{copy.refusals}</h3>
        {overview.refusalsWeek.length ? <dl className={styles.pairs}>{overview.refusalsWeek.map((row) => <div key={row.scope} className={styles.pair}>
          <dt>{refusalScopeLabel(copy, row.scope)}</dt><dd>{f.n(row.count)}</dd></div>)}</dl> : <p className={styles.muted}>{copy.noRefusals}</p>}
      </div>
    </div>
    <h3>{copy.lastDays}</h3>
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={copy.lastDays}>
      <table className={styles.table}>
        <thead><tr><th scope="col">{copy.colDate}</th><th scope="col">{copy.colSignups}</th><th scope="col">{copy.colGuests}</th>
          <th scope="col">{copy.colTrips}</th><th scope="col">{copy.colAi}</th><th scope="col">{copy.colAiRefused}</th><th scope="col">{copy.colRefused}</th></tr></thead>
        <tbody>{[...overview.days].reverse().map((day) => <tr key={day.day}>
          <th scope="row">{f.utcDay(day.day)}</th><td>{f.n(day.signups)}</td><td>{f.n(day.guests)}</td><td>{f.n(day.trips)}</td>
          <td>{f.n(day.ai)}</td><td>{f.n(day.aiRefused)}</td><td>{f.n(day.refused)}</td></tr>)}</tbody>
      </table>
    </div>
  </>;
}

function SignupLimit({ copy, f, signup, changed }: { copy: AdminCopy; f: Formatters; signup: AdminOverview["signup"]; changed: () => void }) {
  const [draft, setDraft] = useState(signup.dailyLimit === null ? "" : String(signup.dailyLimit));
  const [state, setState] = useState<"idle" | "busy" | "saved" | "failed">("idle");
  const save = async (dailyLimit: number | null) => {
    setState("busy");
    setDraft(dailyLimit === null ? "" : String(dailyLimit));
    try {
      await readJson("/api/admin/signup-limit", { method: "PUT", body: JSON.stringify({ dailyLimit }) });
      setState("saved");
      changed();
    } catch {
      setState("failed");
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 0 || value > 100_000) { setState("failed"); return; }
    void save(value);
  };
  const status = signup.dailyLimit === 0 ? copy.signupPaused : signup.dailyLimit === null
    ? formatMessage(copy.signupTodayUncapped, { today: f.n(signup.today) })
    : formatMessage(copy.signupToday, { today: f.n(signup.today), limit: f.n(signup.dailyLimit) });
  return <section className={styles.section} aria-labelledby="admin-signup">
    <h2 id="admin-signup">{copy.signup}</h2>
    <p className={styles.muted}>{copy.signupHelp}</p>
    {!signup.enabled ? <p className={styles.notice}>{copy.signupOff}</p> : null}
    <p><strong>{status}</strong></p>
    <form className={styles.limitForm} onSubmit={submit}>
      <label>{copy.signupLimitLabel}
        <input type="number" inputMode="numeric" min={0} max={100000} step={1} required value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button type="submit" className={styles.primary} disabled={state === "busy"}>{copy.save}</button>
      <button type="button" className={styles.secondary} disabled={state === "busy" || signup.dailyLimit === 0} onClick={() => void save(0)}>{copy.pause}</button>
      <button type="button" className={styles.secondary} disabled={state === "busy" || signup.dailyLimit === null} onClick={() => void save(null)}>{copy.removeCap}</button>
    </form>
    <p role="status" className={styles.muted}>{state === "saved" ? copy.saved : state === "failed" ? copy.actionFailed : ""}</p>
  </section>;
}

type CardProps = {
  copy: AdminCopy; f: Formatters; account: AdminAccount; detail: DetailState | undefined; confirming: boolean; busy: boolean; failed: boolean;
  toggleDetails: () => void; askSuspend: () => void; cancel: () => void; setSuspended: (suspended: boolean) => void;
};

function AccountCard({ copy, f, account, detail, confirming, busy, failed, toggleDetails, askSuspend, cancel, setSuspended }: CardProps) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);
  const detailId = `admin-detail-${account.userId}`;
  const status = account.suspendedAt ? formatMessage(copy.statusSuspended, { date: f.day(account.suspendedAt) })
    : account.guestExpiresAt ? formatMessage(copy.guestUntil, { date: f.when(account.guestExpiresAt) }) : copy.statusActive;
  return <li className={account.suspendedAt ? styles.cardSuspended : styles.card}>
    <div className={styles.cardHead}>
      <div className={styles.identity}>
        <strong>{account.displayName}</strong>
        <span className={styles.muted}>{account.email ?? copy.guest}</span>
      </div>
      <div className={styles.badges}>
        {account.isOperator ? <span className={styles.badge}>{copy.you}</span> : null}
        {account.kind === "guest" ? <span className={styles.badge}>{copy.guest}</span> : null}
        <span className={account.suspendedAt ? styles.badgeWarning : styles.badge}>{status}</span>
      </div>
    </div>
    <ul className={styles.meta}>
      <li>{formatMessage(copy.joined, { date: f.day(account.createdAt) })}</li>
      <li>{account.lastActiveAt ? formatMessage(copy.lastActive, { date: f.when(account.lastActiveAt) }) : copy.neverActive}</li>
      <li>{formatMessage(copy.tripsOwned, { owned: f.n(account.tripsOwned), joined: f.n(account.tripsJoined) })}</li>
      <li>{account.keys.length ? formatMessage(copy.keys, { providers: account.keys.map((key) => providerNames[key] ?? key).join(", ") }) : copy.noKeys}</li>
      <li>{aiLine(copy.aiWeek, account.aiWeek, f)}</li>
      <li>{formatMessage(copy.refusedWeek, { count: f.n(account.refusedWeek) })}</li>
    </ul>
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} aria-expanded={Boolean(detail && detail !== "failed")} aria-controls={detailId}
        onClick={toggleDetails}>{detail && detail !== "failed" ? copy.hideDetails : copy.details}</button>
      {account.isOperator ? <span className={styles.muted}>{copy.ownAccount}</span>
        : account.suspendedAt ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => setSuspended(false)}>{copy.restore}</button>
        : !confirming ? <button type="button" className={styles.danger} disabled={busy} onClick={askSuspend}>{copy.suspend}</button> : null}
    </div>
    {confirming ? <div className={styles.confirm} role="group" aria-label={copy.suspend}>
      <p>{formatMessage(copy.confirmSuspend, { name: account.displayName })}</p>
      <div className={styles.actions}>
        <button ref={confirmButton} type="button" className={styles.danger} disabled={busy} onClick={() => setSuspended(true)}>{copy.suspend}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={cancel}>{copy.cancel}</button>
      </div>
    </div> : null}
    {failed ? <p role="alert" className={styles.error}>{copy.actionFailed}</p> : null}
    <div id={detailId}>
      {detail === "loading" ? <p role="status">{copy.loading}</p> : null}
      {detail === "failed" ? <p role="alert" className={styles.error}>{copy.loadFailed}</p> : null}
      {detail && typeof detail === "object" ? <AccountDetailView copy={copy} f={f} detail={detail} /> : null}
    </div>
  </li>;
}

function AccountDetailView({ copy, f, detail }: { copy: AdminCopy; f: Formatters; detail: AdminAccountDetail }) {
  const stateLabel = { active: copy.stateActive, expired: copy.stateExpired, revoked: copy.stateRevoked };
  const roleLabel = (role: string) => role === "owner" ? copy.role_owner : role === "editor" ? copy.role_editor : role === "viewer" ? copy.role_viewer : role;
  return <div className={styles.detail}>
    <div>
      <h3>{copy.activity}</h3>
      {detail.days.length ? <ul className={styles.dayList}>{detail.days.map((day) => <li key={day.day}>
        <strong>{f.utcDay(day.day)}</strong>
        <span>{aiLine(copy.activityAi, day.ai, f)}</span>
        {day.aiRefused ? <span>{formatMessage(copy.activityAiRefused, { count: f.n(day.aiRefused) })}</span> : null}
        {day.refused ? <span>{formatMessage(copy.activityRefused, { count: f.n(day.refused) })}</span> : null}
        {day.tripsCreated ? <span>{formatMessage(copy.activityTrips, { count: f.n(day.tripsCreated) })}</span> : null}
      </li>)}</ul> : <p className={styles.muted}>{copy.noActivity}</p>}
    </div>
    <div>
      <h3>{copy.sessions}</h3>
      {detail.sessions.length ? <ul className={styles.plainList}>{detail.sessions.map((session, index) => <li key={`${session.createdAt}:${index}`}>
        <strong>{session.deviceLabel}</strong> · {stateLabel[session.state]}
        <span className={styles.muted}>{formatMessage(copy.sessionLine, { created: f.when(session.createdAt), seen: f.when(session.lastSeenAt) })}</span>
      </li>)}</ul> : <p className={styles.muted}>{copy.noSessions}</p>}
    </div>
    <div>
      <h3>{copy.tripList}</h3>
      {detail.trips.length ? <ul className={styles.plainList}>{detail.trips.map((trip, index) => <li key={`${trip.createdAt}:${index}`}>
        {formatMessage(copy.tripLine, { role: roleLabel(trip.role), members: f.n(trip.members), events: f.n(trip.events), date: f.day(trip.createdAt) })}
        {trip.guest ? <span className={styles.badge}>{copy.tripGuest}</span> : null}
        {trip.deleted ? <span className={styles.badge}>{copy.tripDeleted}</span> : null}
      </li>)}</ul> : <p className={styles.muted}>{copy.noTrips}</p>}
    </div>
    <div>
      <h3>{copy.recentActions}</h3>
      {detail.recentActions.length ? <ul className={styles.plainList}>{detail.recentActions.map((action, index) => <li key={`${action.at}:${index}`}>
        <code>{action.entity} · {action.action}</code> <span className={styles.muted}>{f.when(action.at)}</span>
      </li>)}</ul> : <p className={styles.muted}>{copy.noActions}</p>}
    </div>
    {detail.operatorActions.length ? <div>
      <h3>{copy.adminActions}</h3>
      <ul className={styles.plainList}>{detail.operatorActions.map((action, index) => <li key={`${action.at}:${index}`}>
        {action.action === "account.suspended" ? copy.action_suspended : copy.action_unsuspended} <span className={styles.muted}>{f.when(action.at)}</span>
      </li>)}</ul>
    </div> : null}
  </div>;
}
