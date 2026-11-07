"use client";

import { Check, ChevronDown, Languages } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { documentLanguage, localeNames as localeLabels, menuLocales, type Locale } from "@/lib/i18n";

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
          <Link
            data-feedback-action="locale_change"
            className={item === locale ? "language-option is-active" : "language-option"}
            href={`/${item}`}
            key={item}
            hrefLang={documentLanguage(item)}
            lang={documentLanguage(item)}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span>{localeLabels[item]}</span>
            {item === locale ? <Check size={15} /> : null}
          </Link>
        ))}
      </nav> : null}
    </div>
  );
}
