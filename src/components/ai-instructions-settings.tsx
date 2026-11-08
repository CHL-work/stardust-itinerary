"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { aiInstructionsMessages } from "@/lib/ai/instructions-i18n";
import { formatMessage, type Locale } from "@/lib/i18n";
import { AI_INSTRUCTIONS_MAX_CHARACTERS, createAiInstructionsController, emptyAiInstructionsState,
  type AiInstructionsRequest, type AiInstructionsState } from "@/components/ai-instructions-state";
import styles from "./ai-instructions-settings.module.css";

type Props = { tripId: string; scope: string; locale: Locale; request: AiInstructionsRequest; onDirtyChange?: (dirty: boolean) => void;
  /** Inside an AI tab section, which already shows the title (JOB-093). */
  embedded?: boolean };

/** The key remounts the editor before a different identity can see its draft. */
export function AiInstructionsSettings(props: Props) {
  return <AiInstructionsEditor key={props.scope} {...props} />;
}

function AiInstructionsEditor({ tripId, locale, request, onDirtyChange, embedded = false }: Props) {
  const copy = aiInstructionsMessages(locale);
  const [state, setState] = useState<AiInstructionsState>(emptyAiInstructionsState);
  const controller = useRef<ReturnType<typeof createAiInstructionsController> | null>(null);
  const dirty = state.saved !== null && state.draft !== state.saved.instructions;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const current = createAiInstructionsController(tripId, request, setState);
    controller.current = current;
    void current.load();
    return () => { current.dispose(); controller.current = null; };
  }, [tripId, request]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  const save = (event: FormEvent) => { event.preventDefault(); void controller.current?.save(); };
  const reload = () => { if (!dirty || window.confirm(copy.reloadConfirm)) void controller.current?.load(); };
  const clear = () => { if (window.confirm(copy.clearConfirm)) void controller.current?.clear(); };
  const ready = state.phase === "ready";
  const blocked = state.notice === "conflict";
  const Container = embedded ? "div" : "article";
  return <Container className={embedded ? `settings-card ai-embedded-settings ${styles.card}` : `settings-card ${styles.card}`} aria-busy={state.phase === "loading" || state.phase === "saving"}>
    {embedded ? null : <h2>{copy.title}</h2>}
    <p>{copy.description}</p>
    <p id="ai-instructions-privacy">{copy.privacy}</p>
    <form data-feedback-action="settings_save" className={styles.form} onSubmit={save}>
      <label>{copy.label}<textarea rows={7} maxLength={AI_INSTRUCTIONS_MAX_CHARACTERS} value={state.draft}
        disabled={!ready} aria-describedby="ai-instructions-privacy ai-instructions-count" placeholder={copy.placeholder}
        onChange={(event) => controller.current?.edit(event.target.value)} /></label>
      <small id="ai-instructions-count">{formatMessage(copy.count, { count: state.draft.length })}</small>
      {dirty ? <small>{copy.unsaved}</small> : null}
      <div className={styles.actions}>
        <button className="primary-button fit-button" disabled={!ready || blocked || !dirty}>{state.phase === "saving" ? copy.saving : copy.save}</button>
        <button type="button" className="ghost-button" disabled={!ready || blocked || !state.saved?.instructions} onClick={clear}>{copy.clear}</button>
      </div>
    </form>
    {state.phase === "loading" ? <p role="status">{copy.loading}</p> : null}
    {state.notice ? <p role={state.notice === "saved" || state.notice === "cleared" ? "status" : "alert"}>{copy[state.notice]}</p> : null}
    {state.phase === "failed" || blocked ? <button type="button" className="ghost-button" onClick={reload}>{copy.reload}</button> : null}
  </Container>;
}
