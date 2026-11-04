"use client";

import Link from "next/link";
import { useState } from "react";

type CaptureState = "idle" | "working" | "invalid";

export function ClaimTokenCapture() {
  const [state, setState] = useState<CaptureState>("idle");

  async function captureToken() {
    setState("working");
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("token");
    if (!token) {
      setState("invalid");
      return;
    }

    window.history.replaceState(null, "", "/claim");
    try {
      const response = await fetch("/api/auth/claim-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setState("invalid");
        return;
      }
      window.location.reload();
    } catch {
      setState("invalid");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Identity invitation</p>
        <h1>Preview your invitation</h1>
        <p>
          Continue to load the trip and member name. This step does not consume the invitation.
        </p>
        {state === "invalid" ? (
          <>
            <p className="auth-note">This invitation is invalid, expired, already used, or revoked.</p>
            <Link className="auth-secondary" href="/auth/sign-in">Sign in instead</Link>
          </>
        ) : (
          <button
            className="auth-primary"
            disabled={state === "working"}
            onClick={captureToken}
            type="button"
          >
            {state === "working" ? "Loading invitation…" : "Preview invitation"}
          </button>
        )}
      </section>
    </main>
  );
}
