import { cookies } from "next/headers";
import Link from "next/link";

import { ClaimTokenCapture } from "@/components/claim-token-capture";
import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import { previewClaim } from "@/lib/auth/repository";
import { authCookieNames } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

export default async function ClaimIntentPage() {
  if (!isAuthConfigured()) {
    return <ClaimProblem message="Authentication is not configured on this local server." />;
  }

  const config = getAuthConfig();
  const rawToken = (await cookies()).get(authCookieNames.claimIntent)?.value;
  if (!rawToken) {
    return <ClaimTokenCapture />;
  }
  const claim = rawToken ? await previewClaim(getPool(config), config, rawToken) : null;
  if (!claim) {
    return <ClaimProblem message="This invitation is invalid, expired, already used, or revoked." />;
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Identity invitation</p>
        <h1>Join {claim.tripName}</h1>
        <p>
          This invitation is assigned to <strong>{claim.memberDisplayName}</strong> as {claim.role}.
          Continue only if that is you. Opening this page did not consume the invitation.
        </p>
        <form action="/api/auth/google/start" method="get">
          <button className="auth-primary" type="submit">Continue with Google</button>
        </form>
        <p className="auth-note">The invitation is consumed only after Google sign-in and confirmation.</p>
      </section>
    </main>
  );
}

function ClaimProblem({ message }: { message: string }) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Identity invitation</p>
        <h1>Invitation unavailable</h1>
        <p>{message}</p>
        <Link className="auth-secondary" href="/auth/sign-in">Sign in instead</Link>
      </section>
    </main>
  );
}
