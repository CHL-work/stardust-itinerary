import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { LocalePackScope } from "@/components/locale-pack-scope";
import { getMessages, isLocale, locales } from "@/lib/i18n";
import { localePack } from "@/lib/locale-packs";
import { isAuthConfigured } from "@/lib/auth/config";
import { resolveLocalePreference } from "@/lib/locale-preference-server";

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
  if (isAuthConfigured()) {
    const { session } = await resolveLocalePreference(await cookies(),locale);
    if (!session) redirect(`/trips/new?locale=${encodeURIComponent(locale)}`);
  }

  // Only this language's pack goes to the browser (JOB-085).
  return <LocalePackScope locale={locale} pack={localePack(locale)}><AppShell locale={locale} messages={getMessages(locale)} /></LocalePackScope>;
}
