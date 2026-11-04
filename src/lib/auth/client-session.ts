"use client";

const SESSION_REFRESH_LOCK_NAME = "stardust-session-refresh";

let activeSessionRefresh: Promise<void> | null = null;
let fallbackRequestCount = 0;

function lockManager(): LockManager | null {
  if (typeof navigator === "undefined" || !navigator.locks) return null;
  return navigator.locks;
}

async function sendSessionRefresh(): Promise<void> {
  await fetch("/api/auth/session/refresh", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

/**
 * Rotate the browser session without racing an authenticated request. The Web
 * Lock coordinates tabs; the module promise coordinates callers in this tab.
 */
export function refreshSessionForActivity(): Promise<void> {
  if (activeSessionRefresh) return activeSessionRefresh;

  const locks = lockManager();
  const refresh = (async () => {
    if (locks) {
      await locks.request(
        SESSION_REFRESH_LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock) await sendSessionRefresh();
        },
      );
      return;
    }

    // Without Web Locks, preserve the same fail-open behavior in this tab:
    // skip this refresh when a request is already using the current cookie.
    if (fallbackRequestCount > 0) return;
    await sendSessionRefresh();
  })().catch(() => {
    // A temporary refresh outage must not prevent a request from trying the
    // still-current cookie. An expired session remains rejected by the server.
  });

  activeSessionRefresh = refresh;
  void refresh.finally(() => {
    if (activeSessionRefresh === refresh) activeSessionRefresh = null;
  });
  return refresh;
}

/**
 * Run a same-origin authenticated request against a stable session cookie.
 * Shared locks keep ordinary requests concurrent while excluding rotation.
 */
export async function withStableSession<T>(request: () => Promise<T>): Promise<T> {
  if (activeSessionRefresh) await activeSessionRefresh;

  const locks = lockManager();
  if (locks) {
    return locks.request(
      SESSION_REFRESH_LOCK_NAME,
      { mode: "shared" },
      request,
    );
  }

  // The refresh function installs its promise synchronously, so this second
  // check closes the gap between the first wait and incrementing the counter.
  if (activeSessionRefresh) await activeSessionRefresh;
  fallbackRequestCount += 1;
  try {
    return await request();
  } finally {
    fallbackRequestCount -= 1;
  }
}
