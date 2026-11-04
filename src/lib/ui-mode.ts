/**
 * Device-local display preference for the JOB-048 layout toggle.
 *
 * The value only selects presentation (`<html data-ui>`). It never changes
 * data, permissions or requests, so it is safe in browser storage and is not
 * purged on sign-out.
 */
export const uiModes = ["new", "classic"] as const;
export type UiMode = (typeof uiModes)[number];

export const UI_MODE_STORAGE_KEY = "stardust.ui-mode.v1";
export const UI_MODE_ATTRIBUTE = "data-ui";
export const DEFAULT_UI_MODE: UiMode = "new";

export function normalizeUiMode(value: unknown): UiMode {
  return value === "classic" ? "classic" : DEFAULT_UI_MODE;
}

// URL locale segment -> document language (the LIHKG tone pack is Hong Kong Cantonese text).
const documentLanguages: Record<string, string> = { en: "en", "zh-HK": "zh-HK", "zh-HK-lihkg": "zh-HK", "ja-JP": "ja-JP" };

/**
 * Runs in `<head>` before first paint so the stored layout is applied without
 * a flash. Storage can be blocked (private mode, disabled site data); the new
 * layout is then used. It also sets `<html lang>` from the locale route early,
 * so per-script font stacks are right on first paint (DocumentLanguage keeps it
 * in sync after hydration).
 */
export const uiModeBootstrapScript = `(function(){var d=document.documentElement,m=${JSON.stringify(DEFAULT_UI_MODE)};try{if(window.localStorage.getItem(${JSON.stringify(UI_MODE_STORAGE_KEY)})==="classic")m="classic";}catch(e){}d.setAttribute(${JSON.stringify(UI_MODE_ATTRIBUTE)},m);try{var l=${JSON.stringify(documentLanguages)}[location.pathname.split("/")[1]];if(l)d.lang=l;}catch(e){}})();`;
