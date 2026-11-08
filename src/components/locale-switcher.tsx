"use client";

import { Check, ChevronDown, Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { documentLanguage, getMessages, localeNames as localeLabels, menuLocales, type Locale } from "@/lib/i18n";
import { saveLocalePreference } from "@/lib/locale-preference-client";

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  async function chooseLanguage(next: Locale) {
    if (saving) return;
    setSaving(true); setFailed(false);
    if (!await saveLocalePreference(next)) {
      setSaving(false); setFailed(true); return;
    }
    setOpen(false); setSaving(false);
    router.push(`/${next}`);
  }

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  return (
    <div className="language-menu" ref={menuRef}>
      <button
        data-feedback-action="dialog_open"
        type="button"
        className="language-trigger"
        aria-label="Change language"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Languages size={17} />
        <span>{localeLabels[locale]}</span>
        <ChevronDown className={open ? "language-chevron is-open" : "language-chevron"} size={14} />
      </button>
      {open ? <nav className="language-options" aria-label="Language" role="menu">
        {menuLocales.map((item) => (
          <button
            type="button"
            disabled={saving}
            data-feedback-action="locale_change"
            className={item === locale ? "language-option is-active" : "language-option"}
            key={item}
            lang={documentLanguage(item)}
            role="menuitem"
            onClick={() => void chooseLanguage(item)}
          >
            <span>{localeLabels[item]}</span>
            {item === locale ? <Check size={15} /> : null}
          </button>
        ))}
      </nav> : null}
      {failed ? <small role="alert">{getMessages(locale).languageSaveFailed}</small> : null}
    </div>
  );
}
