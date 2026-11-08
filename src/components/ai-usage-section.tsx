"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AiSection, useAiSectionOpen } from "@/components/ai-section";
import { InfoTip } from "@/components/info-tip";
import { aiTabMessages, type AiTabCopy } from "@/lib/ai/ai-tab-i18n";
import { aiUsageServices, type AiUsagePayer, type AiUsageService, type AiUsageSummary } from "@/lib/ai/usage-types";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";

type Request = <T>(url: string, init?: RequestInit) => Promise<T>;

const serviceLabel: Record<AiUsageService, keyof AiTabCopy> = {
  chat: "serviceChat", routine: "serviceRoutine", tripSetup: "serviceTripSetup", other: "serviceOther",
};
const payerLabel: Record<AiUsagePayer, keyof AiTabCopy> = { mine: "paidMine", free: "paidFree", others: "paidOthers" };

function intlLocale(locale: Locale): string {
  return locale === "zh-HK-lihkg" ? "zh-HK" : locale;
}

export function formatTokens(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

/** Estimated USD: cents for ordinary amounts, and "< $0.01" for a cost too small to show in cents. */
export function formatUsd(value: number, locale: Locale): string {
  const format = (amount: number) => new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return value > 0 && value < 0.005 ? `< ${format(0.01)}` : format(value);
}

function dayLabel(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

const WIDTH = 320;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 118;
const HEIGHT = 136;
const GAP = 2;

function topRounded(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/** Stacked daily tokens by service: thin bars, a 2px gap between segments and bars, a rounded top. */
export function AiUsageChart({ days, locale, copy }: { days: AiUsageSummary["days"]; locale: Locale; copy: AiTabCopy }) {
  const [active, setActive] = useState<number | null>(null);
  const totals = days.map((day) => aiUsageServices.reduce((sum, service) => sum + day.tokens[service], 0));
  const max = Math.max(1, ...totals);
  const slot = WIDTH / Math.max(1, days.length);
  const barWidth = Math.max(1, slot - GAP);
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const shown = active === null ? null : days[active];
  return <div className="ai-usage-chart">
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={copy.usageChart} onMouseLeave={() => setActive(null)}>
      <line className="ai-usage-grid" x1={0} x2={WIDTH} y1={PLOT_TOP} y2={PLOT_TOP} />
      <text className="ai-usage-axis" x={0} y={PLOT_TOP - 5}>{formatTokens(max, locale)}</text>
      <line className="ai-usage-baseline" x1={0} x2={WIDTH} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} />
      {days.map((day, index) => {
        const x = index * slot + GAP / 2;
        let stacked = 0;
        const segments = aiUsageServices.flatMap((service) => {
          const value = day.tokens[service];
          if (value <= 0) return [];
          const height = (value / max) * plotHeight;
          const bottom = PLOT_BOTTOM - stacked;
          stacked += height;
          return [{ service, top: PLOT_BOTTOM - stacked, height: height - (bottom < PLOT_BOTTOM ? GAP : 0) }];
        }).filter((segment) => segment.height > 0);
        return <g key={day.date}>
          {active === index ? <rect className="ai-usage-highlight" x={index * slot} y={PLOT_TOP} width={slot} height={plotHeight} /> : null}
          {segments.map((segment, position) => position === segments.length - 1
            ? <path key={segment.service} className={`ai-usage-bar ai-usage-${segment.service}`} d={topRounded(x, segment.top, barWidth, segment.height, 4)} />
            : <rect key={segment.service} className={`ai-usage-bar ai-usage-${segment.service}`} x={x} y={segment.top} width={barWidth} height={segment.height} />)}
          {/* The hit target is the whole day column, larger than its bar. */}
          <rect className="ai-usage-hit" x={index * slot} y={0} width={slot} height={HEIGHT}
            onMouseEnter={() => setActive(index)} onClick={() => setActive(active === index ? null : index)} />
        </g>;
      })}
      <text className="ai-usage-axis" x={0} y={HEIGHT - 2}>{days.length ? dayLabel(days[0].date, locale) : ""}</text>
      <text className="ai-usage-axis" x={WIDTH} y={HEIGHT - 2} textAnchor="end">{days.length ? dayLabel(days[days.length - 1].date, locale) : ""}</text>
    </svg>
    <p className="ai-usage-tooltip" aria-live="polite">{shown
      ? <><strong>{dayLabel(shown.date, locale)} · {formatTokens(totals[active!], locale)}</strong>
        {aiUsageServices.filter((service) => shown.tokens[service] > 0).map((service) => <span key={service}>
          <i className={`ai-usage-swatch ai-usage-${service}`} aria-hidden="true" />{copy[serviceLabel[service]]} {formatTokens(shown.tokens[service], locale)}</span>)}</>
      : null}</p>
  </div>;
}

export function AiUsageView({ summary, locale, copy }: { summary: AiUsageSummary; locale: Locale; copy: AiTabCopy }) {
  const hasUse = summary.total.tokens > 0 || summary.total.requests > 0;
  return <>
    <p className="ai-usage-total">{formatMessage(copy.usageTotal, { tokens: formatTokens(summary.total.tokens, locale),
      cost: formatUsd(summary.total.costUsd, locale) })}<InfoTip label={infoTipLabel(locale)}>{copy.usageHelp}</InfoTip></p>
    {hasUse ? <>
      <AiUsageChart days={summary.days} locale={locale} copy={copy} />
      <ul className="ai-usage-legend">{aiUsageServices.map((service) => <li key={service}>
        <i className={`ai-usage-swatch ai-usage-${service}`} aria-hidden="true" />{copy[serviceLabel[service]]}</li>)}</ul>
      <table className="ai-usage-table">
        <caption>{copy.byService}</caption>
        <thead><tr><th scope="col">{copy.columnService}</th><th scope="col">{copy.columnTokens}</th><th scope="col">{copy.columnCost}</th></tr></thead>
        <tbody>{summary.services.map((row) => <tr key={row.service}>
          <th scope="row"><i className={`ai-usage-swatch ai-usage-${row.service}`} aria-hidden="true" />{copy[serviceLabel[row.service]]}</th>
          <td>{formatTokens(row.tokens, locale)}</td><td>{formatUsd(row.costUsd, locale)}</td></tr>)}</tbody>
      </table>
      {summary.models.length ? <table className="ai-usage-table">
        <caption>{copy.byModel}</caption>
        <thead><tr><th scope="col">{copy.columnModel}</th><th scope="col">{copy.columnPaidBy}</th><th scope="col">{copy.columnTokens}</th><th scope="col">{copy.columnCost}</th></tr></thead>
        <tbody>{summary.models.map((row) => <tr key={`${row.model}:${row.provider}:${row.payer}`}>
          <th scope="row">{row.model}</th><td>{copy[payerLabel[row.payer]]}</td>
          <td>{formatTokens(row.tokens, locale)}</td><td>{row.costUsd === null ? "—" : formatUsd(row.costUsd, locale)}</td></tr>)}</tbody>
      </table> : null}
    </> : <p className="muted-copy">{copy.usageEmpty}</p>}
  </>;
}

/** AI tab → Usage. Loads when opened, and again when reopened a minute later. */
export function AiUsageSection({ tripId, locale, request }: { tripId: string; locale: Locale; request: Request }) {
  const copy = aiTabMessages(locale);
  const [open, setOpen] = useAiSectionOpen("usage", false);
  const [state, setState] = useState<{ phase: "idle" | "loading" | "ready" | "failed"; summary: AiUsageSummary | null }>({ phase: "idle", summary: null });
  const loadedAt = useRef(0);
  const load = useCallback(() => {
    setState((current) => ({ ...current, phase: "loading" }));
    request<AiUsageSummary>(`/api/trips/${encodeURIComponent(tripId)}/ai/usage`, { cache: "no-store" }).then((summary) => {
      loadedAt.current = Date.now();
      setState({ phase: "ready", summary });
    }, () => setState((current) => ({ ...current, phase: "failed" })));
  }, [request, tripId]);
  useEffect(() => {
    if (!open || state.phase === "loading" || Date.now() - loadedAt.current < 60_000) return;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [open, load, state.phase]);
  return <AiSection id="usage" title={copy.usageSection} open={open} onOpenChange={setOpen}
    summary={state.summary ? formatUsd(state.summary.total.costUsd, locale) : undefined}>
    {state.phase === "loading" && !state.summary ? <p role="status">{copy.usageLoading}</p> : null}
    {state.phase === "failed" ? <p role="alert">{copy.usageFailed} <button type="button" className="ghost-button" onClick={load}>{copy.usageRetry}</button></p> : null}
    {state.summary ? <AiUsageView summary={state.summary} locale={locale} copy={copy} /> : null}
  </AiSection>;
}
