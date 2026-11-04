import Image from "next/image";
import Link from "next/link";

import { GuestSignIn } from "@/components/guest-sign-in";
import { guestModeEnabled } from "@/lib/app/guest";
import { isAuthConfigured } from "@/lib/auth/config";
import { publicSignupEnabled } from "@/lib/auth/account-session";

export const dynamic = "force-dynamic";

const signInErrors: Record<string, string> = {
  unbound: "This Google account is not bound to a trip member. Ask the owner to create an invitation link, then sign in through that link.",
  disabled: "This trip membership is disabled. Ask the owner to enable it in Settings, then sign in again. You do not need a new invitation link.",
  claim: "This invitation is invalid, expired, already used, or revoked. Ask the owner for a new invitation link.",
  join: "This trip invitation is unavailable, the trip is full, or this account was disabled or removed. Ask the owner to check the member list.",
  rate_limit: "Too many sign-in attempts were made. Wait a few minutes and try again.",
  expired: "That one-time Google sign-in transaction has expired. Start a new sign-in below.",
  oauth: "Google sign-in could not be completed. Try again or ask the owner to check the OAuth configuration.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const configured = isAuthConfigured();
  const signupEnabled = publicSignupEnabled();
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage = errorCode ? signInErrors[errorCode] ?? signInErrors.oauth : null;
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Image className="auth-logo" src="/stardust-mark.png" alt="Stardust Itinerary emblem" width={96} height={96} priority />
        <p className="eyebrow">Stardust identity</p>
        <h1>Sign in to your trip</h1>
        <p>{signupEnabled
          ? "Sign in with Google to open your trip or create a new one. Creating a trip does not include host-funded AI access."
          : "Use the Google account already bound to your owner or member identity."}</p>
        {errorMessage ? <p className="auth-warning">{errorMessage}</p> : null}
        {configured ? (
          <form action="/api/auth/google/start" method="get">
            <button className="auth-primary" type="submit">Continue with Google</button>
          </form>
        ) : (
          <p className="auth-warning">
            Local authentication is disabled until the database and Google development credentials are configured.
          </p>
        )}
        {configured && guestModeEnabled() ? <GuestSignIn siteKey={process.env.TURNSTILE_SITE_KEY?.trim() || null} /> : null}
        <Link className="auth-secondary" href="/">Return to demo preview</Link>
      </section>
    </main>
  );
}
