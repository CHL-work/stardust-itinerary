"use client";

import { useEffect, useState } from "react";

import { adminCopy } from "@/lib/admin/i18n";
import { withStableSession } from "@/lib/auth/client-session";
import type { Locale } from "@/lib/i18n";

/**
 * Settings → the admin page link (JOB-069). Renders nothing until the server confirms that this
 * account is the platform operator, and nothing at all for everyone else.
 */
export function AdminEntry({ locale }: { locale: Locale }) {
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    let active = true;
    void withStableSession(() => fetch("/api/admin/status", { cache: "no-store", credentials: "same-origin" }))
      .then(async (response) => response.ok ? await response.json() as { operator?: unknown } : null)
      .then((body) => { if (active && body?.operator === true) setOperator(true); })
      .catch(() => { /* No privileged UI when authorization cannot be checked. */ });
    return () => { active = false; };
  }, []);
  if (!operator) return null;
  const copy = adminCopy(locale);
  return <article className="settings-card">
    <h2>{copy.title}</h2>
    <p>{copy.entry}</p>
    <a className="primary-button fit-button" href={`/admin?locale=${encodeURIComponent(locale)}`}>{copy.open}</a>
  </article>;
}
