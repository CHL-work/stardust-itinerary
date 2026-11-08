"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AiSection, useAiSectionOpen } from "@/components/ai-section";
import { InfoTip } from "@/components/info-tip";
import { aiTabMessages, type AiTabCopy } from "@/lib/ai/ai-tab-i18n";
import { aiEfforts, isAiEffort, isSelectableModel, routineDefaultModels, type AiEffort } from "@/lib/ai/effort";
import { ownKeyModels } from "@/lib/ai/own-key-model";
import type { AiPreferences, AiPreferencesPatch } from "@/lib/ai/preferences-types";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import type { SelectableOwnerModel } from "@/lib/app/types";
import { formatMessage, type Locale } from "@/lib/i18n";

type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
export type AiPreferencesNotice = "routineSearchUnavailable" | "routineKeyRejected" | "routineCheckFailed" | "routineLimited" | "saveFailed" | "saveConflict";
export type AiPreferencesState = {
  phase: "loading" | "ready" | "failed";
  preferences: AiPreferences | null;
  saving: boolean;
  /** A live web search check of the user's key is running (turning routine checks on). */
  checking: boolean;
  notice: AiPreferencesNotice | null;
};

const effortLabel: Record<AiEffort, keyof AiTabCopy> = { low: "effortLow", medium: "effortMedium", high: "effortHigh" };

export function preferencesNotice(error: unknown): AiPreferencesNotice {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
  const status = error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : null;
  return code === "ROUTINE_SEARCH_UNAVAILABLE" ? "routineSearchUnavailable" : code === "ROUTINE_KEY_REJECTED" ? "routineKeyRejected"
    : code === "ROUTINE_CHECK_FAILED" ? "routineCheckFailed" : code === "ROUTINE_CHECKS_LIMITED" ? "routineLimited"
      : status === 409 ? "saveConflict" : "saveFailed";
}

/** The account's AI preferences, shared by the chat effort picker and the routine checks section. */
export function useAiPreferences(tripId: string, request: Request, refreshToken: string | number = 0) {
  const [state, setState] = useState<AiPreferencesState>({ phase: "loading", preferences: null, saving: false, checking: false, notice: null });
  const current = useRef(state);
  useEffect(() => { current.current = state; }, [state]);
  const url = `/api/trips/${encodeURIComponent(tripId)}/ai/preferences`;
  const load = useCallback(() => request<AiPreferences>(url, { cache: "no-store" }).then(
    (preferences) => setState((previous) => ({ ...previous, phase: "ready", preferences })),
    () => setState((previous) => ({ ...previous, phase: previous.preferences ? "ready" : "failed" })),
  ), [request, url]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshToken]);
  const save = useCallback(async (patch: Omit<AiPreferencesPatch, "expectedRevision">) => {
    const preferences = current.current.preferences;
    if (!preferences || current.current.saving) return;
    setState((previous) => ({ ...previous, saving: true, checking: Boolean(patch.routine?.enabled), notice: null }));
    try {
      const next = await request<AiPreferences>(url, { method: "PATCH", body: JSON.stringify({ ...patch, expectedRevision: preferences.revision }) });
      setState((previous) => ({ ...previous, preferences: next, saving: false, checking: false }));
    } catch (error) {
      const notice = preferencesNotice(error);
      setState((previous) => ({ ...previous, saving: false, checking: false, notice }));
      if (notice === "saveConflict") void load();
    }
  }, [load, request, url]);
  return { state, save, reload: load };
}

/** The chat effort picker under the composer: "Default" keeps each model's tuned effort. */
export function ChatEffortSelect({ locale, state, save }: { locale: Locale; state: AiPreferencesState; save: (patch: Omit<AiPreferencesPatch, "expectedRevision">) => void }) {
  const copy = aiTabMessages(locale);
  if (!state.preferences || state.preferences.providers.length === 0) return null;
  return <label className="ai-effort-field">{copy.chatEffort}
    <select className="model-select" data-feedback-action="settings_save" value={state.preferences.chatEffort ?? ""} disabled={state.saving}
      onChange={(event) => save({ chatEffort: isAiEffort(event.target.value) ? event.target.value : null })}>
      <option value="">{copy.effortDefault}</option>
      {aiEfforts.map((effort) => <option key={effort} value={effort}>{copy[effortLabel[effort]]}</option>)}
    </select>
  </label>;
}

function lastCheckTime(instant: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(instant));
}

export function AiRoutineView({ locale, timeZone, state, save }: {
  locale: Locale; timeZone: string; state: AiPreferencesState; save: (patch: Omit<AiPreferencesPatch, "expectedRevision">) => void;
}) {
  const copy = aiTabMessages(locale);
  const preferences = state.preferences;
  if (!preferences) return null;
  const models = ownKeyModels(preferences.providers).filter(isSelectableModel);
  const firstProvider = (["openai", "anthropic", "google"] as const).find((provider) => preferences.providers.includes(provider));
  const model: SelectableOwnerModel | null = preferences.routine.model && models.includes(preferences.routine.model)
    ? preferences.routine.model : firstProvider ? routineDefaultModels[firstProvider] : null;
  const routine = preferences.routine;
  const disabled = state.saving || !model;
  // Changing the model or effort while on re-saves "on"; a new model is checked before it takes effect.
  const change = (next: { enabled?: boolean; model?: SelectableOwnerModel; effort?: AiEffort }) => {
    if (!model) return;
    save({ routine: { enabled: next.enabled ?? routine.enabled, model: next.model ?? model, effort: next.effort ?? routine.effort } });
  };
  return <div className="settings-card ai-embedded-settings ai-routine" aria-busy={state.saving}>
    <p className="ai-routine-intro">{models.length ? null : copy.routineNeedsKey}
      <InfoTip label={infoTipLabel(locale)}>{copy.routineHelp}</InfoTip></p>
    <label className="check-field ai-routine-toggle">
      <input type="checkbox" data-feedback-action="settings_save" checked={routine.enabled} disabled={disabled}
        onChange={(event) => change({ enabled: event.target.checked })} />{copy.routineToggle}</label>
    {models.length ? <div className="ai-routine-fields">
      <label>{copy.routineModel}<select value={model ?? ""} disabled={disabled}
        onChange={(event) => { if (isSelectableModel(event.target.value)) change({ model: event.target.value }); }}>
        {models.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>{copy.routineEffort}<select value={routine.effort} disabled={disabled}
        onChange={(event) => { if (isAiEffort(event.target.value)) change({ effort: event.target.value }); }}>
        {aiEfforts.map((effort) => <option key={effort} value={effort}>{copy[effortLabel[effort]]}</option>)}</select></label>
    </div> : null}
    {state.checking ? <p role="status">{copy.routineChecking}</p>
      : routine.enabled && !routine.active ? <p role="status">{copy.routineKeyChanged}</p>
        : routine.enabled ? <p className="muted-copy" role="status">{routine.lastCheckAt
          ? formatMessage(copy.routineStatus, { time: lastCheckTime(routine.lastCheckAt, locale, timeZone), count: routine.checksToday })
          : copy.routineStatusNone}</p> : null}
    {state.notice ? <p role="alert">{copy[state.notice]}</p> : null}
  </div>;
}

/** AI tab → Routine checks, closed until the user opens it. */
export function AiRoutineSection({ locale, timeZone, state, save }: {
  locale: Locale; timeZone: string; state: AiPreferencesState; save: (patch: Omit<AiPreferencesPatch, "expectedRevision">) => void;
}) {
  const copy = aiTabMessages(locale);
  const [open, setOpen] = useAiSectionOpen("routine", false);
  const enabled = state.preferences?.routine.enabled ?? false;
  return <AiSection id="routine" title={copy.routineSection} open={open} onOpenChange={setOpen}
    summary={state.preferences ? (enabled ? copy.summaryOn : copy.summaryOff) : undefined}>
    {state.phase === "loading" && !state.preferences ? <p role="status">{copy.loading}</p> : null}
    {state.phase === "failed" ? <p role="alert">{copy.loadFailed}</p> : null}
    <AiRoutineView locale={locale} timeZone={timeZone} state={state} save={save} />
  </AiSection>;
}
