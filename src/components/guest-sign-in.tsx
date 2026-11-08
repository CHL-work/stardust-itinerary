"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { guestMessages } from "@/lib/app/guest-i18n";

type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string };
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * "Try as guest": starts a 24-hour isolated guest account, then opens Create Trip. With a
 * Turnstile site key, the button waits for Cloudflare's check that a person is clicking.
 */
export function GuestSignIn({ siteKey, locale = "en" }: { siteKey: string | null; locale?: Locale }) {
  const router = useRouter();
  const copy = guestMessages(locale);
  const [token, setToken] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const widget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = widget.current;
    if (!siteKey || !element) return;
    const render = () => {
      if (!window.turnstile || element.dataset.rendered) return;
      element.dataset.rendered = "true";
      window.turnstile.render(element, {
        sitekey: siteKey, action: "guest", callback: (value: string) => setToken(value),
        "expired-callback": () => setToken(null), "error-callback": () => setToken(null),
      });
    };
    if (window.turnstile) { render(); return; }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.addEventListener("load", render);
    document.head.appendChild(script);
    return () => script.removeEventListener("load", render);
  }, [siteKey]);

  const start = async () => {
    setStarting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(token ? { turnstileToken: token } : {}), locale }),
      });
      if (response.ok) {
        // The scoped grant authorizes only explicit creation, not any existing trip.
        router.replace(`/trips/new?locale=${locale}`);
        router.refresh();
        return;
      }
      const body = await response.json().catch(() => null) as { code?: unknown } | null;
      setMessage(body?.code === "GUEST_RATE_LIMITED" ? copy.limited
        : body?.code === "GUEST_CHALLENGE_FAILED" ? copy.challengeFailed
        : response.status === 404 || response.status === 503 ? copy.unavailable : copy.failed);
    } catch {
      setMessage(copy.failed);
    }
    setStarting(false);
  };

  return <div className="auth-guest">
    <p>{copy.startNotice} {copy.separateAccount}</p>
    {siteKey ? <div ref={widget} className="auth-turnstile" /> : null}
    <button type="button" className="auth-secondary" disabled={starting || (siteKey !== null && token === null)} onClick={() => void start()}>
      {starting ? copy.startingGuest : copy.startGuest}
    </button>
    {message ? <p className="auth-warning" role="alert">{message}</p> : null}
  </div>;
}
