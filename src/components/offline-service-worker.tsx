"use client";

import { useEffect } from "react";

export function OfflineServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void (async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      const readyRegistration = await navigator.serviceWorker.ready;
      const localeMatch = window.location.pathname.match(/^\/(en|zh-HK|zh-HK-lihkg|ja-JP|zh-CN|zh-TW|es|pt-BR|fr|de|ru|id)(?:\/|$)/u);
      if (localeMatch?.[1]) {
        readyRegistration.active?.postMessage({
          type: "WARM_LOCALE_SHELL",
          path: `/${localeMatch[1]}`,
        });
      }
      await registration.update();
    })().catch(() => {
      // Offline support is progressive enhancement; the live app remains usable.
    });
  }, []);

  return null;
}
