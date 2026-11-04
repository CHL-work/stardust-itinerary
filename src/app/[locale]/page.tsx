import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getMessages, isLocale, locales } from "@/lib/i18n";

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

  return <AppShell locale={locale} messages={getMessages(locale)} />;
}
