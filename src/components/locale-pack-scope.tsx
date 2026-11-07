"use client";

import type { ReactNode } from "react";

import { installLocalePack, type LocalePack } from "@/lib/locale-packs";

/**
 * Installs the page's language pack before anything below it renders (JOB-085, D-097). Browser code carries no
 * pack, so a page in an added language sends its own pack here; the four original locales send none. The
 * server already has every pack, so on the server this only renders the children.
 */
export function LocalePackScope({ locale, pack, children }: { locale: string; pack: LocalePack | null; children: ReactNode }) {
  if (pack) installLocalePack(locale, pack);
  return children;
}
