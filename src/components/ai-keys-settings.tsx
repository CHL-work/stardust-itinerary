"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AiCredentialSummary, AiKeyProtection, AiKeyUsage } from "@/lib/ai/credentials";
import { aiKeysMessages, type AiKeysCopy } from "@/lib/ai/keys-i18n";
import { InfoTip } from "@/components/info-tip";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";

type Provider = AiCredentialSummary["provider"];
type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
/** `changed` runs after a key is saved or removed, so the page can refresh what AI it offers. */
type Props = { tripId: string; scope: string; locale: Locale; request: Request; changed?: () => void;
  /** Inside an AI tab section, which already shows the title (JOB-093). */
  embedded?: boolean };
type Notice = { provider: Provider; kind: "savedNotice" | "savedCheckingNotice" | "removedNotice" | "rejected" | "failed" | "unavailable" | "limited" | "providerLimited" | "providerUnavailable" | "googleConfiguration" | "invalidProject" };
const statusNotices: ReadonlySet<Notice["kind"]> = new Set(["savedNotice", "savedCheckingNotice", "removedNotice"]);
type GoogleMode = "gemini" | "express" | "vertex";
type KeyDraft = { apiKey: string; vertexProject: string; vertexLocation?: string; googleMode?: GoogleMode };

/** Explicit routing: changing a mode never submits the key to another Google endpoint as fallback. */
export function keyDraftPayload(provider: Provider, draft: KeyDraft) {
  return { provider, apiKey: draft.apiKey.trim(), ...(provider === "google"
    ? draft.googleMode === "express" ? { vertexExpress: true }
      : draft.googleMode === "vertex" ? { vertexProject: draft.vertexProject.trim(), vertexLocation: draft.vertexLocation?.trim() || "global" }
        : {} : {}) };
}

function validVertexDraft(draft: KeyDraft) {
  return draft.googleMode !== "vertex" || (/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(draft.vertexProject.trim())
    && /^[a-z][a-z0-9-]{0,39}$/u.test(draft.vertexLocation?.trim() || "global"));
}

export const aiKeyProviders: readonly Provider[] = ["openai", "anthropic", "google"];

function providerName(copy: AiKeysCopy, provider: Provider): string {
  return copy[`provider_${provider}`];
}

export function savedKeyLine(copy: AiKeysCopy, locale: Locale, key: AiCredentialSummary | undefined): string {
  if (!key) return copy.noKey;
  const date = new Date(key.validatedAt).toLocaleDateString(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { dateStyle: "medium" });
  return formatMessage(key.vertex ? copy.vertexKey : copy.savedKey, { hint: key.hint, date });
}

/** AI tab → API keys. The key remounts the editor before another identity can see its state. */
export function AiKeysSettings(props: Props) {
  return <AiKeysEditor key={props.scope} {...props} />;
}

function AiKeysEditor({ tripId, locale, request, changed, embedded = false }: Props) {
  const copy = aiKeysMessages(locale);
  const url = `/api/trips/${encodeURIComponent(tripId)}/ai/keys`;
  const [keys, setKeys] = useState<AiCredentialSummary[] | null>(null);
  const [usage, setUsage] = useState<AiKeyUsage | null>(null);
  const [protection, setProtection] = useState<AiKeyProtection | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [drafts, setDrafts] = useState<Record<Provider, KeyDraft>>({
    openai: { apiKey: "", vertexProject: "" }, anthropic: { apiKey: "", vertexProject: "" }, google: { apiKey: "", vertexProject: "" },
  });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fetchKeys = useCallback(() => request<{ keys: AiCredentialSummary[]; usage?: AiKeyUsage; protection?: AiKeyProtection | null }>(url),
    [request, url]);
  const selectSavedGoogleMode = (savedKeys: AiCredentialSummary[]) => {
    const google = savedKeys.find((key) => key.provider === "google");
    setDrafts((current) => ({ ...current, google: { ...current.google,
      googleMode: current.google.googleMode ?? (google?.vertexExpress ? "express" : google?.vertex ? "vertex" : "gemini") } }));
  };
  useEffect(() => {
    let active = true;
    fetchKeys().then((body) => {
      if (active) {
        setKeys(body.keys); setUsage(body.usage ?? null); setProtection(body.protection ?? null); setPhase("ready");
        const google = body.keys.find((key) => key.provider === "google");
        setDrafts((current) => ({ ...current, google: { ...current.google,
          googleMode: current.google.googleMode ?? (google?.vertexExpress ? "express" : google?.vertex ? "vertex" : "gemini") } }));
      }
    }, () => { if (active) setPhase("failed"); });
    return () => { active = false; };
  }, [fetchKeys]);
  const reload = () => {
    setPhase("loading");
    fetchKeys().then((body) => { setKeys(body.keys); setUsage(body.usage ?? null); setProtection(body.protection ?? null); setPhase("ready"); selectSavedGoogleMode(body.keys); },
      () => setPhase("failed"));
  };

  const save = (provider: Provider) => async (event: FormEvent) => {
    event.preventDefault();
    const draft = drafts[provider];
    if (!draft.apiKey.trim() || busy) return;
    if (provider === "google" && !validVertexDraft(draft)) { setNotice({ provider, kind: "invalidProject" }); return; }
    setBusy(provider);
    setNotice(null);
    try {
      const body = await request<{ key: AiCredentialSummary; routineCheck?: "running" | "limited" | null }>(url, {
        method: "PUT",
        body: JSON.stringify(keyDraftPayload(provider, draft)),
      });
      setKeys((current) => [...(current ?? []).filter((key) => key.provider !== provider), body.key]);
      // The server tests a saved key for routine checks by itself (JOB-096); the Routine checks section shows how it went.
      setNotice({ provider, kind: body.routineCheck === "running" ? "savedCheckingNotice" : "savedNotice" });
      changed?.();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
      setNotice({ provider, kind: code === "AI_KEY_REJECTED" ? "rejected" : code === "AI_KEYS_UNAVAILABLE" ? "unavailable"
        : code === "AI_KEY_PROVIDER_LIMITED" ? "providerLimited" : code === "AI_KEY_PROVIDER_UNAVAILABLE" ? "providerUnavailable"
        : code === "AI_KEY_CONFIGURATION" ? "googleConfiguration"
        : code === "AI_KEY_CHECKS_LIMITED" ? "limited" : "failed" });
    } finally {
      // The typed key never stays in the page once it has been sent.
      setDrafts((current) => ({ ...current, [provider]: { ...current[provider], apiKey: "" } }));
      setBusy(null);
    }
  };

  const remove = (provider: Provider) => async () => {
    if (busy || !window.confirm(formatMessage(copy.removeConfirm, { provider: providerName(copy, provider) }))) return;
    setBusy(provider);
    setNotice(null);
    try {
      await request(`${url}?provider=${provider}`, { method: "DELETE" });
      setKeys((current) => (current ?? []).filter((key) => key.provider !== provider));
      setNotice({ provider, kind: "removedNotice" });
      changed?.();
    } catch {
      setNotice({ provider, kind: "failed" });
    } finally {
      setBusy(null);
    }
  };

  return <AiKeysView copy={copy} locale={locale} keys={keys} usage={usage} protection={protection} phase={phase} drafts={drafts} busy={busy} notice={notice} embedded={embedded}
    edit={(provider, field, value) => setDrafts((current) => ({ ...current, [provider]: { ...current[provider], [field]: value } }))}
    save={save} remove={remove} reload={reload} />;
}

type ViewProps = {
  copy: AiKeysCopy; locale: Locale; keys: AiCredentialSummary[] | null; usage?: AiKeyUsage | null; phase: "loading" | "ready" | "failed";
  /** Storage for new keys; legacy saved keys may still use an earlier supported backend. */
  protection?: AiKeyProtection | null;
  drafts: Record<Provider, KeyDraft>; busy: Provider | null; notice: Notice | null;
  edit: (provider: Provider, field: "apiKey" | "vertexProject" | "vertexLocation" | "googleMode", value: string) => void;
  save: (provider: Provider) => (event: FormEvent) => void;
  remove: (provider: Provider) => () => void;
  reload: () => void;
  embedded?: boolean;
};

export function AiKeysView({ copy, locale, keys, usage = null, protection = null, phase, drafts, busy, notice, edit, save, remove, reload, embedded = false }: ViewProps) {
  const Container = embedded ? "div" : "article";
  return <Container className={embedded ? "settings-card ai-embedded-settings ai-keys" : "settings-card"} aria-busy={phase === "loading" || busy !== null}>
    {embedded ? null : <h2>{copy.title}</h2>}
    <p>{copy.description}</p>
    <p id="ai-keys-privacy">{protection === "secret_manager" ? copy.privacySecretManager : protection === "kms" ? copy.privacyKms : copy.privacy}<InfoTip label={infoTipLabel(locale)}>{copy.keyAdvice}</InfoTip></p>
    {phase === "loading" ? <p role="status">{copy.loading}</p> : null}
    {phase === "failed" ? <><p role="alert">{copy.loadFailed}</p><button type="button" className="ghost-button" onClick={reload}>{copy.retry}</button></> : null}
    {phase === "ready" ? aiKeyProviders.map((provider) => {
      const saved = keys?.find((key) => key.provider === provider);
      const name = providerName(copy, provider);
      const inputId = `ai-key-${provider}`;
      return <section key={provider} aria-labelledby={`${inputId}-title`}>
        <h3 id={`${inputId}-title`}>{name}</h3>
        <p>{savedKeyLine(copy, locale, saved)}</p>
        {saved && usage ? <p className="muted-copy">{formatMessage(copy.usageLine, { today: usage[provider].today, month: usage[provider].last30Days })}</p> : null}
        {usage && usage[provider].sharedLast30Days > 0
          ? <p className="muted-copy">{formatMessage(copy.sharedUsageLine, { today: usage[provider].sharedToday, month: usage[provider].sharedLast30Days })}</p>
          : null}
        <form data-feedback-action="settings_save" onSubmit={save(provider)}>
          {provider === "google" ? <>
            <label htmlFor={`${inputId}-mode`}>{copy.googleMode}</label>
            <select id={`${inputId}-mode`} value={drafts[provider].googleMode ?? "gemini"} disabled={busy !== null}
              onChange={(event) => edit(provider, "googleMode", event.target.value)}>
              <option value="gemini">{copy.googleModeGemini}</option>
              <option value="express">{copy.googleModeExpress}</option>
              <option value="vertex">{copy.googleModeVertex}</option>
            </select>
            <small>{copy.googleKeyHelp}</small>
          </> : null}
          <label htmlFor={inputId}>{copy.label}</label>
          <input id={inputId} type="password" autoComplete="off" spellCheck={false} aria-describedby="ai-keys-privacy"
            value={drafts[provider].apiKey} disabled={busy !== null} onChange={(event) => edit(provider, "apiKey", event.target.value)} />
          {provider === "google" && drafts[provider].googleMode === "vertex" ? <>
            <label htmlFor={`${inputId}-vertex`}>{copy.vertexProject}</label>
            <input id={`${inputId}-vertex`} type="text" autoComplete="off" spellCheck={false} value={drafts[provider].vertexProject}
              required pattern="[a-z][a-z0-9-]{4,28}[a-z0-9]" placeholder="my-project-123" aria-describedby={`${inputId}-vertex-help`}
              disabled={busy !== null} onChange={(event) => edit(provider, "vertexProject", event.target.value)} />
            <small id={`${inputId}-vertex-help`}>{copy.vertexHelp}</small>
            <label htmlFor={`${inputId}-location`}>{copy.vertexLocation}</label>
            <input id={`${inputId}-location`} type="text" autoComplete="off" spellCheck={false} value={drafts[provider].vertexLocation ?? ""}
              pattern="[a-z][a-z0-9-]{0,39}" placeholder="global" disabled={busy !== null}
              onChange={(event) => edit(provider, "vertexLocation", event.target.value)} />
          </> : null}
          <button className="primary-button fit-button" disabled={busy !== null || !drafts[provider].apiKey.trim()}>
            {busy === provider ? copy.saving : saved ? copy.replace : copy.save}
          </button>
          {saved ? <button type="button" className="ghost-button" disabled={busy !== null} onClick={remove(provider)}>{copy.remove}</button> : null}
        </form>
        {notice?.provider === provider
          ? <p role={statusNotices.has(notice.kind) ? "status" : "alert"}>
            {formatMessage(copy[notice.kind], { provider: name })}</p>
          : null}
      </section>;
    }) : null}
  </Container>;
}
