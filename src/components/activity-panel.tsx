import { Activity, ArrowLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import type { ActivityEntry } from "@/lib/app/activity-types";
import { activityMessages } from "@/lib/app/activity-i18n";
import { formatPaymentMoney } from "@/lib/app/member-payment-format";
import type { Locale } from "@/lib/i18n";
import styles from "./activity-panel.module.css";

export function ActivitySettingsEntry({ locale, isOwner, open }: { locale: Locale; isOwner: boolean; open: () => void }) {
  if (!isOwner) return null;
  const copy = activityMessages(locale);
  return <article className="settings-card"><h2>{copy.title}</h2><p>{copy.settingsHint}</p>
    <button data-feedback-action="navigate" type="button" className="ghost-button" onClick={open}><Activity size={17} aria-hidden="true" />{copy.open}</button></article>;
}
export function ActivityPanel({ entries, locale, timeZone, isOwner, openingId, busy, open, back, refresh }: {
  entries: ActivityEntry[]; locale: Locale; timeZone: string; isOwner: boolean; openingId: string | null; busy: boolean;
  open: (entry: ActivityEntry) => void; back: () => void; refresh: () => void;
}) {
  if (!isOwner) return null;
  const copy = activityMessages(locale);
  const date = (value: string) => new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale,
    { timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  return <section className={`page-panel ${styles.panel}`}>
    <div className={styles.heading}><div><p className="eyebrow">{copy.latest}</p><h2>{copy.title}</h2></div>
      <div className={styles.actions}><button type="button" className="ghost-button" onClick={back}><ArrowLeft size={16} aria-hidden="true" />{copy.back}</button>
        <button type="button" className="ghost-button" disabled={busy} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{copy.refresh}</button></div></div>
    {!entries.length ? <p className="empty-state">{copy.empty}</p> : <div className={styles.list}>{entries.map((entry) => <article key={entry.id} className={styles.card}>
      <header><h3>{copy.categories[entry.category]} · {copy.actions[entry.action]}</h3><p>{entry.actorName ?? copy.system}</p>
        <small>{copy.recordedAt}: <time dateTime={entry.createdAt}>{date(entry.createdAt)}</time></small></header>
      {entry.title ? <h4>{entry.title}</h4> : null}
      {entry.target ? <><p className={styles.hint}>{entry.target.kind === "request" ? copy.requestCurrent : copy.current}</p>
        <dl>{entry.startsAt ? <div><dt>{copy.startsAt}</dt><dd><time dateTime={entry.startsAt}>{date(entry.startsAt)}</time></dd></div> : null}
          {entry.endsAt ? <div><dt>{copy.endsAt}</dt><dd><time dateTime={entry.endsAt}>{date(entry.endsAt)}</time></dd></div> : null}
          {entry.amount ? <div><dt>{copy.amount}</dt><dd>{formatPaymentMoney(entry.amount.amountMinor, entry.amount.currency, locale)}</dd></div> : null}
          {entry.status ? <div><dt>{copy.status}</dt><dd>{copy.statuses[entry.status]}</dd></div> : null}</dl>
        {entry.changedFields.length ? <p>{copy.changed}: {entry.changedFields.map((field) => copy.fields[field]).join(" · ")}</p> : null}
        <button type="button" className="ghost-button" disabled={busy || Boolean(openingId)} aria-busy={openingId === entry.id} onClick={() => open(entry)}>
          <ArrowUpRight size={16} aria-hidden="true" />{openingId === entry.id ? copy.loading : entry.target.kind === "itinerary" ? copy.openEvent : entry.target.kind === "expense" ? copy.openExpense : copy.openRequest}</button>
      </> : entry.targetState === "removed" || entry.targetState === "unavailable" ? <p className={styles.hint}>{entry.targetState === "removed" ? copy.removed : copy.unavailable}</p> : null}
    </article>)}</div>}
  </section>;
}
