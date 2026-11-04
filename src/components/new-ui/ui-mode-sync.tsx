"use client";

import { useEffect } from "react";

import { ensureUiModeAttribute, useUiMode } from "@/lib/ui-mode-store";
import { UI_MODE_ATTRIBUTE } from "@/lib/ui-mode";

export const classicThemeColor = "#171225";
export const newLightThemeColor = "#f5f3fa";
export const newDarkThemeColor = "#14121b";

/**
 * Owns the browser chrome color for the chosen layout. React hoists these meta tags into
 * <head>, so they survive client navigations instead of a Next-owned tag being mutated.
 * Also restores `<html data-ui>` if anything removes it after the bootstrap ran.
 */
export function UiModeSync() {
  const mode = useUiMode();
  useEffect(() => {
    ensureUiModeAttribute();
    const observer = new MutationObserver(ensureUiModeAttribute);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [UI_MODE_ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);
  if (mode === "classic") return <meta name="theme-color" content={classicThemeColor} />;
  return <>
    <meta name="theme-color" media="(prefers-color-scheme: light)" content={newLightThemeColor} />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content={newDarkThemeColor} />
  </>;
}
