import { cookies } from "next/headers";
import Link from "next/link";

import { JoinTokenCapture } from "@/components/join-token-capture";
import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import { previewJoinLink } from "@/lib/auth/repository";
import { authCookieNames } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

export default async function JoinIntentPage() {
  if (!isAuthConfigured()) {
    return <JoinProblem message="Authentication is not configured on this local server." />;
  }

  const config = getAuthConfig();
  const rawToken = (await cookies()).get(authCookieNames.joinIntent)?.value;
  if (!rawToken) {
    return <JoinTokenCapture />;
  }
  const invitation = await previewJoinLink(getPool(config), config, rawToken);
  if (!invitation) {
    return <JoinProblem message="This invitation was disabled, has filled up, or is no longer available." />;
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Trip invitation</p>
        <h1>Join {invitation.tripName}</h1>
        <p>
          {invitation.remainingSeats} of {invitation.maxMembers} places remain. Sign in with the
          Google account you want linked to your trip membership.
        </p>
        <form action="/api/auth/google/start" method="get">
          <button className="auth-primary" type="submit">Continue with Google</button>
        </form>
        <p className="auth-note">
          Google sign-in is required. Calendar access is separate and is not requested here.
        </p>
      </section>
    </main>
  );
}

function JoinProblem({ message }: { message: string }) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Trip invitation</p>
        <h1>Invitation unavailable</h1>
        <p>{message}</p>
        <Link className="auth-secondary" href="/auth/sign-in">Sign in instead</Link>
      </section>
    </main>
  );
}
