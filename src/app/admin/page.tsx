import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AdminConsole } from "@/components/admin-console";
import { LocalePackScope } from "@/components/locale-pack-scope";
import { adminAccess } from "@/lib/admin/repository";
import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/repository";
import { authCookieNames } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { locales, type Locale } from "@/lib/i18n";
import { localePack } from "@/lib/locale-packs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Stardust Itinerary", robots: { index: false, follow: false } };

/** The operator's admin page (JOB-069). Anyone else, signed in or not, gets a plain 404. */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const params = await searchParams;
  const locale = locales.includes(params.locale as Locale) ? params.locale as Locale : "en";
  if (!isAuthConfigured()) notFound();
  const config = getAuthConfig();
  const pool = getPool(config);
  const token = (await cookies()).get(authCookieNames.session)?.value;
  const session = token ? await verifySession(pool, config, token) : null;
  if (!session || !(await adminAccess(pool, session))) notFound();
  return <LocalePackScope locale={locale} pack={localePack(locale)}><AdminConsole locale={locale} /></LocalePackScope>;
}
