import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CreateTripForm } from "@/components/create-trip-form";
import { LocalePackScope } from "@/components/locale-pack-scope";
import { publicSignupEnabled } from "@/lib/auth/account-session";
import { getAuthConfig,isAuthConfigured } from "@/lib/auth/config";
import { getPool } from "@/lib/db/pool";
import { getTripCreationOptions } from "@/lib/app/trip-creation-options";
import { localePack } from "@/lib/locale-packs";
import { canLookupTripDestination } from "@/lib/app/trip-destination-service";
import { guestModeEnabled } from "@/lib/app/guest";
import { isGuestSession } from "@/lib/auth/guest-identity";
import { resolveLocalePreference } from "@/lib/locale-preference-server";

export const dynamic = "force-dynamic";
export default async function NewTripPage({ searchParams }:{searchParams:Promise<{locale?:string}>}) {
  const params = await searchParams;
  const jar = await cookies();
  const { locale,session,account } = await resolveLocalePreference(jar,params.locale);
  const principal = session ?? account;
  const authenticated = Boolean(principal);
  let lookupEntitled = false;
  const guest = Boolean(principal && isGuestSession(principal));
  if (session && guest) redirect(`/${locale}`);
  if (principal && isAuthConfigured()) {
    const config = getAuthConfig();
    const pool = getPool(config);
    lookupEntitled = await canLookupTripDestination(pool,config,principal.userId).catch(() => false);
  }
  // Serialize this language's ICU-derived labels (browser ICU versions cannot change hydration), and only this
  // language's pack; choosing another language reloads the page with its own (JOB-085).
  return <LocalePackScope locale={locale} pack={localePack(locale)}><CreateTripForm locale={locale} now={new Date().toISOString()} options={getTripCreationOptions(locale)} authenticated={authenticated} signupEnabled={publicSignupEnabled()} lookupEntitled={lookupEntitled} guest={guest} guestEnabled={isAuthConfigured() && guestModeEnabled()} guestSiteKey={process.env.TURNSTILE_SITE_KEY?.trim() || null}/></LocalePackScope>;
}
