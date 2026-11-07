import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { LocalePackScope } from "@/components/locale-pack-scope";
import { getMessages, isLocale, locales } from "@/lib/i18n";
import { localePack } from "@/lib/locale-packs";

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocalePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  // Only this language's pack goes to the browser (JOB-085).
  return <LocalePackScope locale={locale} pack={localePack(locale)}><AppShell locale={locale} messages={getMessages(locale)} /></LocalePackScope>;
}
