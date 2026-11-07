import type { Locale } from "@/lib/i18n";

/** The language each locale's AI-written prose uses, as named to the model. */
export const aiLanguageNames: Record<Locale, string> = {
  en: "English",
  "zh-HK": "neutral Hong Kong Cantonese",
  "zh-HK-lihkg": "neutral Hong Kong Cantonese",
  "ja-JP": "Japanese",
  "zh-CN": "Simplified Chinese as used in mainland China",
  "zh-TW": "Traditional Chinese as used in Taiwan",
  es: "Spanish",
  "pt-BR": "Brazilian Portuguese",
  fr: "French",
  de: "German",
  ru: "Russian",
  id: "Indonesian",
};
