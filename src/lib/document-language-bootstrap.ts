import { documentLanguage, locales } from "@/lib/i18n";

// URL locale segment -> document language (the LIHKG tone pack is Hong Kong Cantonese text).
const documentLanguages: Record<string, string> = Object.fromEntries(locales.map((locale) => [locale, documentLanguage(locale)]));

/**
 * Runs in `<head>` before first paint and sets `<html lang>` from the locale route, so per-script font
 * stacks are right on first paint (DocumentLanguage keeps it in sync after hydration). There is one
 * layout since JOB-081: the server renders `<html data-ui="new">`, and this script never changes it.
 */
export const documentLanguageBootstrapScript = `(function(){try{var l=${JSON.stringify(documentLanguages)}[location.pathname.split("/")[1]];if(l)document.documentElement.lang=l;}catch(e){}})();`;
