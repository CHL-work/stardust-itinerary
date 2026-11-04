"use client";

import Link from "next/link";
import { useState } from "react";

type CaptureState = "idle" | "working" | "invalid";

export function JoinTokenCapture() {
  const [state, setState] = useState<CaptureState>("idle");

  async function captureToken() {
    setState("working");
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("token");
    if (!token) {
      setState("invalid");
      return;
    }

    window.history.replaceState(null, "", "/join");
    try {
      const response = await fetch("/api/auth/join-intent", {
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
        <p className="eyebrow">Trip invitation</p>
        <h1>Preview this trip</h1>
        <p>
          Continue to check the trip and available places. The invitation stays in your browser
          fragment and is never sent to the server in the page URL or access log.
        </p>
        {state === "invalid" ? (
          <>
            <p className="auth-note">This invitation is unavailable or the trip is already full.</p>
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
