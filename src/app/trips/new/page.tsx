import { cookies } from "next/headers";

import { CreateTripForm } from "@/components/create-trip-form";
import { LocalePackScope } from "@/components/locale-pack-scope";
import { accountCookieName,publicSignupEnabled,verifyAccountOnboarding } from "@/lib/auth/account-session";
import { getAuthConfig,isAuthConfigured } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/repository";
import { authCookieNames } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { locales,type Locale } from "@/lib/i18n";
import { getTripCreationOptions } from "@/lib/app/trip-creation-options";
import { localePack } from "@/lib/locale-packs";
import { canLookupTripDestination } from "@/lib/app/trip-destination-service";

export const dynamic = "force-dynamic";
export default async function NewTripPage({ searchParams }:{searchParams:Promise<{locale?:string}>}) {
  const params = await searchParams;
  const locale = locales.includes(params.locale as Locale) ? params.locale as Locale : "zh-HK-lihkg";
  let authenticated = false;
  let lookupEntitled = false;
  if (isAuthConfigured()) {
    const config = getAuthConfig();
    const jar = await cookies();
    const pool = getPool(config);
    const token = jar.get(authCookieNames.session)?.value;
    const session = token ? await verifySession(pool,config,token) : null;
    const principal = session ?? await verifyAccountOnboarding(pool,config,jar.get(accountCookieName)?.value);
    authenticated = Boolean(principal);
    if (principal) lookupEntitled = await canLookupTripDestination(pool,config,principal.userId).catch(() => false);
  }
  // Serialize this language's ICU-derived labels (browser ICU versions cannot change hydration), and only this
  // language's pack; choosing another language reloads the page with its own (JOB-085).
  return <LocalePackScope locale={locale} pack={localePack(locale)}><CreateTripForm locale={locale} now={new Date().toISOString()} options={getTripCreationOptions(locale)} authenticated={authenticated} signupEnabled={publicSignupEnabled()} lookupEntitled={lookupEntitled}/></LocalePackScope>;
}
