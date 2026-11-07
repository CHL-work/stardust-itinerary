"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { FeedbackContext, FeedbackOperatorStatus, PrivateFeedbackReport } from "@/lib/feedback/contracts";
import { withStableSession } from "@/lib/auth/client-session";
import { feedbackCopy, feedbackActionLabel } from "@/lib/feedback/i18n";
import { feedbackOperationsCopy } from "@/lib/feedback/operations-i18n";
import { FEEDBACK_CONTEXT_EVENT, getFeedbackContext } from "@/lib/feedback/client-context";
import styles from "./feedback-widget.module.css";

export function FeedbackOperations({ locale }: { locale: Locale }) {
  const copy = feedbackOperationsCopy(locale);
  const reportCopy = feedbackCopy[locale];
  const [data, setData] = useState<{ reports: PrivateFeedbackReport[]; status: FeedbackOperatorStatus } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const [operator, setOperator] = useState(false);
  const generation = useRef(0);
  const boundScope = useRef<FeedbackContext["scope"] | null>(null);
  useEffect(() => {
    let active = true;
    const request = generation.current;
    void withStableSession(() => fetch("/api/feedback/context", { cache: "no-store" })).then(async response => {
      if (!response.ok) return;
      const result = await response.json() as FeedbackContext;
      if (active && request === generation.current) { boundScope.current = result.scope; setOperator(result.isOperator === true); }
    }).catch(() => { /* No privileged UI when authorization cannot be checked. */ });
    const changed = () => {
      const current = getFeedbackContext();
      const prior = boundScope.current;
      if (!current || (prior && (current.tripId !== prior.tripId || current.memberId !== prior.memberId))) {
        ++generation.current; active = false; boundScope.current = null; setOperator(false); setData(null);
      }
    };
    window.addEventListener(FEEDBACK_CONTEXT_EVENT, changed);
    return () => { active = false; window.removeEventListener(FEEDBACK_CONTEXT_EVENT, changed); };
  }, []);
  async function load() {
    const request = ++generation.current;
    setLoading(true); setError(false);
    try {
      const expected = boundScope.current;
      if (!expected) return;
      const response = await withStableSession(() => fetch("/api/feedback/operator", { cache: "no-store" }));
      if (request !== generation.current) return;
      if (response.status === 401 || response.status === 403) { setData(null); setDenied(true); return; }
      if (!response.ok) throw new Error("operator_status_unavailable");
      const result = await response.json();
      const check = await withStableSession(() => fetch("/api/feedback/context", { cache: "no-store" }));
      if (!check.ok) { if (request === generation.current) { setData(null); setOperator(false); } return; }
      const current = await check.json() as FeedbackContext;
      if (request === generation.current && current.isOperator && current.scope.scopeKey === expected.scopeKey) setData(result);
      else if (request === generation.current) { setData(null); setOperator(false); }
    } catch { setData(null); setError(true); } finally { setLoading(false); }
  }
  if (denied || !operator) return null;
  return <details className={styles.operations} onToggle={event => { if (event.currentTarget.open && !data && !loading) void load(); }}>
    <summary>{copy.heading}</summary><p>{copy.detail}</p><p className={styles.help}>{copy.config}</p>
    <button type="button" disabled={loading} onClick={() => void load()}>{loading ? copy.loading : copy.refresh}</button>
    {error && <p role="alert">{copy.error}</p>}
    {data && <><dl className={styles.metrics}>
      <div><dt>{copy.review}</dt><dd>{data.status.configuration.triageConfigured ? copy.configured : copy.missing}</dd></div>
      <div><dt>{copy.publishing}</dt><dd>{data.status.configuration.publishingConfigured ? copy.configured : copy.missing}</dd></div>
      <div><dt>{copy.pending}</dt><dd>{data.status.queue.reports}</dd></div>
      <div><dt>{copy.queued}</dt><dd>{data.status.queue.queuedIssues}</dd></div>
      <div><dt>{copy.uncertain}</dt><dd>{data.status.queue.uncertainIssues}</dd></div>
      <div><dt>{copy.blocked}</dt><dd>{data.status.queue.blockedIssues}</dd></div>
      <div><dt>{copy.published}</dt><dd>{data.status.queue.publishedIssues}</dd></div>
      <div><dt>{copy.last}</dt><dd>{data.status.lastRun ? `${data.status.lastRun.runDate} · Astra / medium` : copy.never}</dd></div>
    </dl>
    {data.reports.length === 0 ? <p>{copy.empty}</p> : data.reports.map(report => <details key={report.id} className={styles.operatorReport}>
      <summary>{report.title} · {reportCopy[report.status]}</summary>
      <p>{reportCopy.receipt}: {report.id}</p><p style={{ whiteSpace: "pre-wrap" }}>{report.description}</p>
      {!report.allowIssuePublication && <p>{reportCopy.private}</p>}
      {report.diagnostics && <ol>{report.diagnostics.breadcrumbs.map((item, index) => <li key={index}>{new Date(item.at).toLocaleString(locale === "zh-HK-lihkg" ? "zh-HK" : locale)} · {reportCopy.pages[item.page]} · {feedbackActionLabel(item.action, locale)}</li>)}</ol>}
    </details>)}
    </>}
  </details>;
}
