import { useSyncExternalStore } from "react";

import { DEFAULT_UI_MODE, normalizeUiMode, UI_MODE_ATTRIBUTE, UI_MODE_STORAGE_KEY, type UiMode } from "@/lib/ui-mode";

const changeEvent = "stardust:ui-mode";

/** The stored device choice; blocked or missing storage means the default layout. */
export function readStoredUiMode(): UiMode {
  try {
    return normalizeUiMode(window.localStorage.getItem(UI_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_MODE;
  }
}

/**
 * The `<html>` attribute set by the bootstrap script is the source of truth after load.
 * If something removed it (e.g. a client re-render of `<html>`), fall back to the stored
 * choice so JavaScript and CSS never disagree for long; `ensureUiModeAttribute` restores it.
 */
export function readUiMode(): UiMode {
  if (typeof document === "undefined") return DEFAULT_UI_MODE;
  const applied = document.documentElement.getAttribute(UI_MODE_ATTRIBUTE);
  return applied === null ? readStoredUiMode() : normalizeUiMode(applied);
}

export function applyUiMode(mode: UiMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(UI_MODE_ATTRIBUTE, mode);
  window.dispatchEvent(new Event(changeEvent));
}

export function ensureUiModeAttribute(): void {
  if (typeof document === "undefined") return;
  if (!document.documentElement.hasAttribute(UI_MODE_ATTRIBUTE)) applyUiMode(readStoredUiMode());
}

/** Persists the choice on this device. Blocked storage still switches the current page. */
export function setUiMode(mode: UiMode): void {
  try {
    window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable; the attribute below still applies for this page.
  }
  applyUiMode(mode);
}

// One shared cross-tab listener, however many components subscribe.
let storageSubscribers = 0;
function syncFromOtherTab(event: StorageEvent) {
  if (event.key !== UI_MODE_STORAGE_KEY) return;
  const next = normalizeUiMode(event.newValue);
  if (next !== readUiMode()) applyUiMode(next);
}

export function subscribeUiMode(onChange: () => void): () => void {
  window.addEventListener(changeEvent, onChange);
  if (storageSubscribers++ === 0) window.addEventListener("storage", syncFromOtherTab);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    if (--storageSubscribers === 0) window.removeEventListener("storage", syncFromOtherTab);
  };
}

export function useUiMode(): UiMode {
  return useSyncExternalStore(subscribeUiMode, readUiMode, () => DEFAULT_UI_MODE);
}
