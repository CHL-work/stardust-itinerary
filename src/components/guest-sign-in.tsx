"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";

type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string };
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * The browser's language mapped to one the app supports; the demo trip is written in it. Chinese follows the
 * region or script: Hong Kong and Macau read Cantonese, Taiwan and other Traditional Chinese read Traditional
 * Chinese, and the rest Simplified Chinese.
 */
export function guestLocale(language: string | undefined): Locale {
  const value = (language ?? "").toLowerCase();
  const primary = value.split(/[-_]/u)[0] ?? "";
  if (primary === "zh") {
    if (/(?:^|[-_])(?:hk|mo)(?:$|[-_])/u.test(value)) return "zh-HK";
    return /(?:^|[-_])(?:tw|hant)(?:$|[-_])/u.test(value) ? "zh-TW" : "zh-CN";
  }
  if (primary === "ja") return "ja-JP";
  if (primary === "pt") return "pt-BR";
  if (primary === "in") return "id";
  return primary === "es" || primary === "fr" || primary === "de" || primary === "ru" || primary === "id" ? primary : "en";
}

/**
 * "Try as guest" (JOB-064): starts a 24-hour guest account with a synthetic demo trip. With a
 * Turnstile site key, the button waits for Cloudflare's check that a person is clicking.
 */
export function GuestSignIn({ siteKey }: { siteKey: string | null }) {
  const router = useRouter();
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
        body: JSON.stringify({ ...(token ? { turnstileToken: token } : {}), locale: guestLocale(navigator.language) }),
      });
      if (response.ok) {
        // The response set the guest's session cookie; the trip loads with it.
        router.replace("/");
        router.refresh();
        return;
      }
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      setMessage(typeof body?.error === "string" ? body.error : "The guest trip could not be started. Try again.");
    } catch {
      setMessage("The guest trip could not be started. Check your connection and try again.");
    }
    setStarting(false);
  };

  return <div className="auth-guest">
    <p>No account? Try a demo trip as a guest. It is deleted after 24 hours.</p>
    {siteKey ? <div ref={widget} className="auth-turnstile" /> : null}
    <button type="button" className="auth-secondary" disabled={starting || (siteKey !== null && token === null)} onClick={() => void start()}>
      {starting ? "Starting your demo trip…" : "Try as guest"}
    </button>
    {message ? <p className="auth-warning" role="alert">{message}</p> : null}
  </div>;
}
