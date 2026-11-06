"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquareWarning, X } from "lucide-react";
import { withStableSession } from "@/lib/auth/client-session";
import { locales, type Locale } from "@/lib/i18n";
import { InfoTip } from "@/components/info-tip";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import { clearFeedbackContext, coarseFeedbackEnvironment, FEEDBACK_CONTEXT_EVENT, feedbackPageForPath, feedbackTrail, getFeedbackContext, verifyFeedbackContext } from "@/lib/feedback/client-context";
import type { FeedbackContext, FeedbackDiagnostics, FeedbackReceipt, FeedbackSubmission, FeedbackSubmissionResult } from "@/lib/feedback/contracts";
import { feedbackActionLabel, feedbackCopy, feedbackEnvironmentLabel } from "@/lib/feedback/i18n";
import styles from "./feedback-widget.module.css";

const scopeKey = (scope: Pick<FeedbackContext["scope"], "tripId" | "memberId"> | null) => scope ? `${scope.tripId}:${scope.memberId}` : null;
const verifiedScopeKey = (scope: FeedbackContext["scope"] | null) => scope ? `${scopeKey(scope)}:${scope.scopeKey}` : null;
function localeForPath(path: string): Locale {
  const candidate = path.split("/")[1];
  return locales.includes(candidate as Locale) ? candidate as Locale : "zh-HK-lihkg";
}

/** Global entry, with an ephemeral, bounded diagnostic trail. No background report uploads. */
export function FeedbackWidget() {
  const pathname = usePathname();
  const locale = localeForPath(pathname ?? "");
  const copy = feedbackCopy[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const verified = useRef<FeedbackContext | null>(null);
  const sequence = useRef(0);
  const historyRequest = useRef(0);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const [checking, setChecking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"bug" | "feedback">("bug");
  const [includeActions, setIncludeActions] = useState(true);
  const [diagnostics, setDiagnostics] = useState<FeedbackDiagnostics | null>(null);
  const [pending, setPending] = useState<FeedbackSubmission | null>(null);
  const [receipt, setReceipt] = useState<FeedbackReceipt | null>(null);
  const [recent, setRecent] = useState<FeedbackReceipt[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<"error" | "rate" | "scope" | "unavailable" | "policy" | null>(null);

  const resetDraft = useCallback(() => {
    setTitle(""); setDescription(""); setKind("bug"); setPending(null); setReceipt(null); setNotice(null);
    setIncludeActions(true);
  }, []);

  const readContext = useCallback(async () => {
    const request = ++sequence.current;
    setChecking(true);
    try {
      const response = await withStableSession(() => fetch("/api/feedback/context", { cache: "no-store" }));
      if (request !== sequence.current) return null;
      if (response.status === 401 || response.status === 403) {
        verified.current = null; clearFeedbackContext(); setContext(null); setRecent([]); resetDraft(); setUnavailable(false);
        return null;
      }
      if (!response.ok) throw new Error("context_unavailable");
      const next = await response.json() as FeedbackContext;
      if (request !== sequence.current) return null;
      if (!next.scope?.tripId || !next.scope.memberId) throw new Error("context_unavailable");
      const changed = verifiedScopeKey(verified.current?.scope ?? null) !== verifiedScopeKey(next.scope);
      if (verified.current && changed) {
        verified.current = null; clearFeedbackContext();
        resetDraft(); setRecent([]); setNotice("scope");
      }
      verified.current = next;
      const existing = getFeedbackContext();
      verifyFeedbackContext({ ...next.scope, locale, page: existing?.page ?? feedbackPageForPath(pathname ?? "") });
      setContext(next); setUnavailable(false);
      return next;
    } catch {
      if (request === sequence.current) { setUnavailable(true); setContext(null); }
      return null;
    } finally { if (request === sequence.current) setChecking(false); }
  }, [locale, pathname, resetDraft]);

  const capture = useCallback((): FeedbackDiagnostics => ({
    page: getFeedbackContext()?.page ?? feedbackPageForPath(pathname ?? ""), locale,
    ...coarseFeedbackEnvironment(navigator.userAgent, window.innerWidth, navigator.onLine), breadcrumbs: feedbackTrail.snapshot(),
  }), [locale, pathname]);

  useEffect(() => {
    const initial = window.setTimeout(() => void readContext(), 0);
    let lastFocusCheck = 0;
    const refresh = () => { if (document.visibilityState === "visible" && Date.now() - lastFocusCheck > 10_000) { lastFocusCheck = Date.now(); void readContext(); } };
    const changed = () => {
      const next = getFeedbackContext();
      if (verified.current && scopeKey(next) !== scopeKey(verified.current.scope)) {
        ++sequence.current; verified.current = null; setContext(null); setRecent([]); resetDraft(); setNotice("scope");
      }
    };
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-feedback-private]")) return;
      const target = event.target.closest("button,a,summary");
      const action = target?.getAttribute("data-feedback-action");
      if (action === "logout") clearFeedbackContext();
      else if (action) feedbackTrail.record(action);
      else if (target) feedbackTrail.record("button");
    };
    const submit = (event: Event) => {
      if (event.target instanceof HTMLFormElement) {
        const action = event.target.getAttribute("data-feedback-action");
        if (action) feedbackTrail.record(action);
      }
    };
    const change = (event: Event) => {
      if (event.target instanceof HTMLSelectElement || (event.target instanceof HTMLInputElement && ["checkbox", "radio"].includes(event.target.type))) {
        const action = event.target.getAttribute("data-feedback-action");
        if (action) feedbackTrail.record(action);
      }
    };
    const error = () => feedbackTrail.record("client_error");
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    window.addEventListener(FEEDBACK_CONTEXT_EVENT, changed);
    document.addEventListener("click", click, true); document.addEventListener("submit", submit, true); document.addEventListener("change", change, true);
    window.addEventListener("error", error); window.addEventListener("unhandledrejection", error);
    return () => {
      window.clearTimeout(initial);
      // A monotonic request generation, not a DOM ref: invalidate stale asynchronous responses.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++sequence.current;
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(FEEDBACK_CONTEXT_EVENT, changed);
      document.removeEventListener("click", click, true); document.removeEventListener("submit", submit, true); document.removeEventListener("change", change, true);
      window.removeEventListener("error", error); window.removeEventListener("unhandledrejection", error);
    };
  }, [readContext, resetDraft]);

  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); else if (!open) dialog.current?.close(); }, [open]);

  async function show() {
    const request = ++historyRequest.current;
    setOpen(true); feedbackTrail.record("feedback_open"); setDiagnostics(capture());
    const current = await readContext();
    if (!current || request !== historyRequest.current) return;
    setDiagnostics(capture());
    try {
      const response = await withStableSession(() => fetch("/api/feedback", { cache: "no-store" }));
      if (response.ok) {
        const data = await response.json() as { reports: FeedbackReceipt[] };
        if (request === historyRequest.current && verifiedScopeKey(verified.current?.scope ?? null) === verifiedScopeKey(current.scope)) setRecent(Array.isArray(data.reports) ? data.reports : []);
      }
    } catch { /* Existing report delivery does not depend on the history list. */ }
  }

  async function send() {
    if (sending || !verified.current) return;
    const originalScope = verifiedScopeKey(verified.current.scope);
    setSending(true); setNotice(null);
    try {
      const current = await readContext();
      if (!current) { setNotice("unavailable"); return; }
      if (verifiedScopeKey(current.scope) !== originalScope) { setNotice("scope"); return; }
      const payload: FeedbackSubmission = pending ?? {
        clientRequestId: crypto.randomUUID(), scope: current.scope, title: title.trim(), description: description.trim(), kind, allowIssuePublication: true,
        ...(includeActions && diagnostics ? { diagnostics } : {}),
      };
      setPending(payload);
      const response = await withStableSession(() => fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" }));
      if (verifiedScopeKey(verified.current?.scope ?? null) !== originalScope) return;
      if (response.status === 428) { setNotice("policy"); return; }
      if (response.status === 401 || response.status === 403 || response.status === 409) {
        clearFeedbackContext(); verified.current = null; setContext(null); resetDraft(); setNotice("scope"); return;
      }
      if (response.status === 429) { setNotice("rate"); return; }
      if (!response.ok) throw new Error("delivery_unconfirmed");
      const result = await response.json() as FeedbackSubmissionResult;
      if (verifiedScopeKey(verified.current?.scope ?? null) !== originalScope) return;
      setReceipt(result.report); setRecent(items => [result.report, ...items.filter(item => item.id !== result.report.id)].slice(0, 20));
      setPending(null); setTitle(""); setDescription(""); feedbackTrail.record("feedback_submit");
    } catch { if (verifiedScopeKey(verified.current?.scope ?? null) === originalScope) setNotice("error"); } finally { setSending(false); }
  }

  return <>
    <button type="button" data-feedback-private className={styles.launcher} onClick={() => void show()} title={copy.open} aria-label={copy.open}><MessageSquareWarning aria-hidden="true" size={21} /></button>
    <dialog ref={dialog} data-feedback-private className={styles.dialog} aria-labelledby="feedback-heading" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header className={styles.header}><h2 id="feedback-heading">{copy.heading}</h2><button type="button" onClick={() => setOpen(false)} aria-label={copy.close}><X aria-hidden="true" size={22} /></button></header>
      {checking && <p role="status">{copy.loading}</p>}
      {notice && <p role="alert" className={styles.notice}>{copy[notice]}</p>}
      {!context ? <p>{unavailable ? copy.unavailable : !checking ? copy.login : null}{!checking && !unavailable && <> <a href={`/auth/sign-in?locale=${encodeURIComponent(locale)}`}>{copy.signin}</a></>}{unavailable && <button type="button" disabled={checking} onClick={() => void readContext()}>{copy.retry}</button>}</p> : receipt ? <section role="status" className={styles.success}><h3>{copy.saved}</h3><p>{copy.receipt}: <code>{receipt.id}</code></p><p>{copy[receipt.status]}</p><button type="button" onClick={resetDraft}>{copy.reset}</button></section> : <form onSubmit={event => { event.preventDefault(); void send(); }}>
        <fieldset disabled={sending || Boolean(pending)} className={styles.fields}>
          <label>{copy.kind}<select value={kind} onChange={event => setKind(event.target.value as "bug" | "feedback")}><option value="bug">{copy.bug}</option><option value="feedback">{copy.feedback}</option></select></label>
          <label>{copy.title}<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>{copy.description}<textarea required maxLength={6000} rows={6} value={description} onChange={event => setDescription(event.target.value)} placeholder={copy.placeholder} /></label>
          <label className={styles.check}><input type="checkbox" checked={includeActions} onChange={event => setIncludeActions(event.target.checked)} /><span>{copy.diagnostics}</span></label>
          <p className={styles.help}>{copy.privacy}<InfoTip label={infoTipLabel(locale)}>{copy.disclosure}</InfoTip></p>
          {includeActions && diagnostics && <details className={styles.preview}><summary>{copy.preview} ({diagnostics.breadcrumbs.length})</summary><p>{[diagnostics.formFactor, diagnostics.osFamily, diagnostics.browserFamily].map(value => feedbackEnvironmentLabel(value, locale)).join(" · ")}</p>{diagnostics.breadcrumbs.length ? <ol>{diagnostics.breadcrumbs.map((item, index) => <li key={`${item.at}-${index}`}><time dateTime={item.at}>{new Date(item.at).toLocaleTimeString(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time> {copy.pages[item.page]} · {feedbackActionLabel(item.action, locale)}</li>)}</ol> : <p>{copy.empty}</p>}</details>}
        </fieldset>
        <button type="submit" disabled={sending || checking || (!pending && (!title.trim() || !description.trim()))} className={styles.send}>{sending ? copy.sending : pending ? copy.retry : copy.send}</button>
      </form>}
      {context && recent.length > 0 && <details className={styles.history}><summary>{copy.recent}</summary><ul>{recent.map(item => <li key={item.id}><strong>{item.title}</strong><small>{copy[item.status]} · {new Date(item.createdAt).toLocaleDateString(locale === "zh-HK-lihkg" ? "zh-HK" : locale)}{!item.allowIssuePublication ? ` · ${copy.private}` : ""}</small></li>)}</ul></details>}
    </dialog>
  </>;
}
