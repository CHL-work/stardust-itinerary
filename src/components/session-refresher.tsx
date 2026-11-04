"use client";

import { useEffect } from "react";

import { refreshSessionForActivity } from "@/lib/auth/client-session";

const REFRESH_INTERVAL_MS = 60 * 60 * 1_000;
const ACTIVITY_REFRESH_GAP_MS = 15 * 60 * 1_000;

export function SessionRefresher() {
  useEffect(() => {
    let refreshing = false;
    let lastRefreshAt = 0;

    async function refresh(force = false) {
      const now = Date.now();
      if (refreshing || (!force && now - lastRefreshAt < ACTIVITY_REFRESH_GAP_MS)) return;
      refreshing = true;
      lastRefreshAt = now;
      try {
        await refreshSessionForActivity();
      } finally {
        refreshing = false;
      }
    }

    const refreshForActivity = () => void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const firstRefresh = window.setTimeout(() => void refresh(true), 1_000);
    const interval = window.setInterval(() => void refresh(true), REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshForActivity);
    window.addEventListener("pointerdown", refreshForActivity, { passive: true });
    window.addEventListener("keydown", refreshForActivity);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshForActivity);
      window.removeEventListener("pointerdown", refreshForActivity);
      window.removeEventListener("keydown", refreshForActivity);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return null;
}
