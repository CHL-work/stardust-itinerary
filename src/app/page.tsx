import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isAuthConfigured } from "@/lib/auth/config";
import { resolveLocalePreference } from "@/lib/locale-preference-server";

export default async function Home() {
  const { locale, session } = await resolveLocalePreference(await cookies());
  if (isAuthConfigured() && !session) redirect(`/trips/new?locale=${locale}`);
  redirect(`/${locale}`);
}
