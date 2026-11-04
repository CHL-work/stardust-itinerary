"use client";

import { LayoutTemplate, Sparkles } from "lucide-react";

import { uiRefreshMessages } from "@/lib/app/ui-refresh-i18n";
import type { Locale } from "@/lib/i18n";
import type { UiMode } from "@/lib/ui-mode";
import { setUiMode, useUiMode } from "@/lib/ui-mode-store";

/** Always offers the other layout, so it is reachable from both the new and the classic UI. */
export function UiModeToggleButton({ mode, locale, onSwitch }: {
  mode: UiMode; locale: Locale; onSwitch: (next: UiMode) => void;
}) {
  const copy = uiRefreshMessages(locale);
  const next: UiMode = mode === "new" ? "classic" : "new";
  const Icon = next === "classic" ? LayoutTemplate : Sparkles;
  const label = next === "classic" ? copy.toggleToClassicLabel : copy.toggleToNewLabel;
  return <button type="button" data-feedback-action="settings_save" className="ui-mode-toggle" data-ui-target={next}
    aria-label={label} title={label} onClick={() => onSwitch(next)}>
    <Icon size={17} aria-hidden="true" />
    <span className="ui-mode-toggle-label">{next === "classic" ? copy.toggleToClassic : copy.toggleToNew}</span>
  </button>;
}

export function UiModeToggle({ locale }: { locale: Locale }) {
  const mode = useUiMode();
  return <UiModeToggleButton mode={mode} locale={locale} onSwitch={setUiMode} />;
}

export function UiModeSettingsCardView({ mode, locale, choose }: {
  mode: UiMode; locale: Locale; choose: (mode: UiMode) => void;
}) {
  const copy = uiRefreshMessages(locale);
  const options: Array<{ value: UiMode; title: string; hint: string }> = [
    { value: "new", title: copy.optionNew, hint: copy.optionNewHint },
    { value: "classic", title: copy.optionClassic, hint: copy.optionClassicHint },
  ];
  return <article className="settings-card ui-mode-settings-card">
    <h2 id="ui-mode-settings-title">{copy.settingsTitle}</h2>
    <p>{copy.settingsDescription}</p>
    <div className="ui-mode-options" role="group" aria-labelledby="ui-mode-settings-title">
      {options.map((option) => <button type="button" key={option.value} data-feedback-action="settings_save"
        className={mode === option.value ? "ui-mode-option is-selected" : "ui-mode-option"} data-ui-option={option.value}
        aria-pressed={mode === option.value} onClick={() => choose(option.value)}>
        <span className="ui-mode-option-title"><strong>{option.title}</strong>{mode === option.value ? <small>{copy.current}</small> : null}</span>
        <span className="ui-mode-option-hint">{option.hint}</span>
      </button>)}
    </div>
  </article>;
}

export function UiModeSettingsCard({ locale }: { locale: Locale }) {
  const mode = useUiMode();
  return <UiModeSettingsCardView mode={mode} locale={locale} choose={setUiMode} />;
}
