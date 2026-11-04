"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AiCredentialSummary } from "@/lib/ai/credentials";
import { aiKeysMessages, type AiKeysCopy } from "@/lib/ai/keys-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";

type Provider = AiCredentialSummary["provider"];
type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
/** `changed` runs after a key is saved or removed, so the page can refresh what AI it offers. */
type Props = { tripId: string; scope: string; locale: Locale; request: Request; changed?: () => void };
type Notice = { provider: Provider; kind: "savedNotice" | "removedNotice" | "rejected" | "failed" | "unavailable" | "limited" };

export const aiKeyProviders: readonly Provider[] = ["openai", "anthropic", "google"];

function providerName(copy: AiKeysCopy, provider: Provider): string {
  return copy[`provider_${provider}`];
}

export function savedKeyLine(copy: AiKeysCopy, locale: Locale, key: AiCredentialSummary | undefined): string {
  if (!key) return copy.noKey;
  const date = new Date(key.validatedAt).toLocaleDateString(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { dateStyle: "medium" });
  return formatMessage(key.vertex ? copy.vertexKey : copy.savedKey, { hint: key.hint, date });
}

/** Settings → AI keys. The key remounts the editor before another identity can see its state. */
export function AiKeysSettings(props: Props) {
  return <AiKeysEditor key={props.scope} {...props} />;
}

function AiKeysEditor({ tripId, locale, request, changed }: Props) {
  const copy = aiKeysMessages(locale);
  const url = `/api/trips/${encodeURIComponent(tripId)}/ai/keys`;
  const [keys, setKeys] = useState<AiCredentialSummary[] | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [drafts, setDrafts] = useState<Record<Provider, { apiKey: string; vertexProject: string }>>({
    openai: { apiKey: "", vertexProject: "" }, anthropic: { apiKey: "", vertexProject: "" }, google: { apiKey: "", vertexProject: "" },
  });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fetchKeys = useCallback(() => request<{ keys: AiCredentialSummary[] }>(url), [request, url]);
  useEffect(() => {
    let active = true;
    fetchKeys().then((body) => { if (active) { setKeys(body.keys); setPhase("ready"); } },
      () => { if (active) setPhase("failed"); });
    return () => { active = false; };
  }, [fetchKeys]);
  const reload = () => {
    setPhase("loading");
    fetchKeys().then((body) => { setKeys(body.keys); setPhase("ready"); }, () => setPhase("failed"));
  };

  const save = (provider: Provider) => async (event: FormEvent) => {
    event.preventDefault();
    const draft = drafts[provider];
    if (!draft.apiKey.trim() || busy) return;
    setBusy(provider);
    setNotice(null);
    try {
      const body = await request<{ key: AiCredentialSummary }>(url, {
        method: "PUT",
        body: JSON.stringify({ provider, apiKey: draft.apiKey.trim(),
          ...(provider === "google" && draft.vertexProject.trim() ? { vertexProject: draft.vertexProject.trim() } : {}) }),
      });
      setKeys((current) => [...(current ?? []).filter((key) => key.provider !== provider), body.key]);
      setNotice({ provider, kind: "savedNotice" });
      changed?.();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
      setNotice({ provider, kind: code === "AI_KEY_REJECTED" ? "rejected" : code === "AI_KEYS_UNAVAILABLE" ? "unavailable"
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

  return <AiKeysView copy={copy} locale={locale} keys={keys} phase={phase} drafts={drafts} busy={busy} notice={notice}
    edit={(provider, field, value) => setDrafts((current) => ({ ...current, [provider]: { ...current[provider], [field]: value } }))}
    save={save} remove={remove} reload={reload} />;
}

type ViewProps = {
  copy: AiKeysCopy; locale: Locale; keys: AiCredentialSummary[] | null; phase: "loading" | "ready" | "failed";
  drafts: Record<Provider, { apiKey: string; vertexProject: string }>; busy: Provider | null; notice: Notice | null;
  edit: (provider: Provider, field: "apiKey" | "vertexProject", value: string) => void;
  save: (provider: Provider) => (event: FormEvent) => void;
  remove: (provider: Provider) => () => void;
  reload: () => void;
};

export function AiKeysView({ copy, locale, keys, phase, drafts, busy, notice, edit, save, remove, reload }: ViewProps) {
  return <article className="settings-card" aria-busy={phase === "loading" || busy !== null}>
    <h2>{copy.title}</h2>
    <p>{copy.description}</p>
    <p id="ai-keys-privacy">{copy.privacy}</p>
    {phase === "loading" ? <p role="status">{copy.loading}</p> : null}
    {phase === "failed" ? <><p role="alert">{copy.loadFailed}</p><button type="button" className="ghost-button" onClick={reload}>{copy.retry}</button></> : null}
    {phase === "ready" ? aiKeyProviders.map((provider) => {
      const saved = keys?.find((key) => key.provider === provider);
      const name = providerName(copy, provider);
      const inputId = `ai-key-${provider}`;
      return <section key={provider} aria-labelledby={`${inputId}-title`}>
        <h3 id={`${inputId}-title`}>{name}</h3>
        <p>{savedKeyLine(copy, locale, saved)}</p>
        <form data-feedback-action="settings_save" onSubmit={save(provider)}>
          <label htmlFor={inputId}>{copy.label}</label>
          <input id={inputId} type="password" autoComplete="off" spellCheck={false} aria-describedby="ai-keys-privacy"
            value={drafts[provider].apiKey} disabled={busy !== null} onChange={(event) => edit(provider, "apiKey", event.target.value)} />
          {provider === "google" ? <>
            <label htmlFor={`${inputId}-vertex`}>{copy.vertexProject}</label>
            <input id={`${inputId}-vertex`} type="text" autoComplete="off" spellCheck={false} value={drafts[provider].vertexProject}
              disabled={busy !== null} onChange={(event) => edit(provider, "vertexProject", event.target.value)} />
            <small>{copy.vertexHelp}</small>
          </> : null}
          <button className="primary-button fit-button" disabled={busy !== null || !drafts[provider].apiKey.trim()}>
            {busy === provider ? copy.saving : saved ? copy.replace : copy.save}
          </button>
          {saved ? <button type="button" className="ghost-button" disabled={busy !== null} onClick={remove(provider)}>{copy.remove}</button> : null}
        </form>
        {notice?.provider === provider
          ? <p role={notice.kind === "savedNotice" || notice.kind === "removedNotice" ? "status" : "alert"}>
            {formatMessage(copy[notice.kind], { provider: name })}</p>
          : null}
      </section>;
    }) : null}
  </article>;
}
