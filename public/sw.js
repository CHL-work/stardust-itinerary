/* global caches */

const STATIC_CACHE = "stardust-static-v1";
const SHELL_CACHE = "stardust-shell-v1";
const KNOWN_CACHE_PREFIXES = ["stardust-static-", "stardust-shell-", "stardust-private-"];
const STATIC_PRECACHE = [
  "/manifest.webmanifest",
  "/icons/stardust-192.png",
  "/icons/stardust-512.png",
  "/stardust-mark.png",
];
const LOCALE_SHELL_PATH = /^\/(en|zh-HK|zh-HK-lihkg|ja-JP|zh-CN|zh-TW|es|pt-BR|fr|de|ru|id)\/?$/;

function isCacheableResponse(response) {
  return response.ok && response.type === "basic";
}

function shellCacheKey(url) {
  return new Request(`${url.origin}${url.pathname}`, {
    method: "GET",
    credentials: "same-origin",
  });
}

async function openCacheBestEffort(name) {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function matchCacheBestEffort(cache, key) {
  if (!cache) return null;
  try {
    return await cache.match(key);
  } catch {
    return null;
  }
}

async function networkFirstNavigation(request, url) {
  const cache = await openCacheBestEffort(SHELL_CACHE);
  const cacheKey = shellCacheKey(url);
  try {
    const response = await fetch(request);
    if (response.status >= 500 && response.status <= 599) {
      const canUseShell = url.pathname === "/" || LOCALE_SHELL_PATH.test(url.pathname);
      const cached = canUseShell ? await matchCacheBestEffort(cache, cacheKey) : null;
      if (cached) return cached;
    }
    if (
      LOCALE_SHELL_PATH.test(url.pathname)
      && isCacheableResponse(response)
      && (response.headers.get("content-type") ?? "").includes("text/html")
    ) {
      // The installable manifest starts at `/`. Keep that key pointed at the
      // last successfully loaded locale shell so a cold offline launch works.
      if (cache) {
        try {
          await Promise.allSettled([
            cache.put(cacheKey, response.clone()),
            cache.put(shellCacheKey(new URL("/", url.origin)), response.clone()),
          ]);
        } catch {
          // A successful network response must not fail because local storage
          // is unavailable, full, or rejects cloning/caching.
        }
      }
    }
    return response;
  } catch (error) {
    const canUseShell = url.pathname === "/" || LOCALE_SHELL_PATH.test(url.pathname);
    const cached = canUseShell ? await matchCacheBestEffort(cache, cacheKey) : null;
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstImmutableAsset(request) {
  const cache = await openCacheBestEffort(STATIC_CACHE);
  const cached = await matchCacheBestEffort(cache, request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cache && isCacheableResponse(response)) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Serve the network asset even when Cache Storage cannot persist it.
    }
  }
  return response;
}

async function warmLocaleShell(path) {
  if (!LOCALE_SHELL_PATH.test(path)) return;
  const url = new URL(path, self.location.origin);
  const response = await fetch(new Request(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "reload",
    headers: { accept: "text/html" },
  }));
  if (!isCacheableResponse(response) || !(response.headers.get("content-type") ?? "").includes("text/html")) {
    return;
  }

  const cache = await openCacheBestEffort(SHELL_CACHE);
  if (!cache) return;
  await Promise.allSettled([
    cache.put(shellCacheKey(url), response.clone()),
    cache.put(shellCacheKey(new URL("/", url.origin)), response.clone()),
  ]);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await openCacheBestEffort(STATIC_CACHE);
    if (cache) {
      await Promise.allSettled(STATIC_PRECACHE.map(async (path) => {
        const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
        if (isCacheableResponse(response)) await cache.put(path, response);
      }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => {
      const belongsToStardust = KNOWN_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
      const isCurrent = name === STATIC_CACHE || name === SHELL_CACHE;
      return belongsToStardust && !isCurrent ? caches.delete(name) : Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Authenticated API data is cached only by the explicit, field-allowlisted
  // client snapshot. The service worker never stores an API response.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request, url));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || STATIC_PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirstImmutableAsset(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "WARM_LOCALE_SHELL") {
    event.waitUntil(warmLocaleShell(event.data.path));
    return;
  }

  if (event.data?.type === "CLEAR_PRIVATE_CACHE") {
    event.waitUntil((async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames
        .filter((name) => name.startsWith("stardust-shell-") || name.startsWith("stardust-private-"))
        .map((name) => caches.delete(name)));
      event.ports[0]?.postMessage({ type: "PRIVATE_CACHE_CLEARED" });
    })());
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let targetUrl = new URL("/", self.location.origin);
  try {
    const requestedUrl = new URL(event.notification.data?.url ?? "/", self.location.origin);
    if (requestedUrl.origin === self.location.origin) targetUrl = requestedUrl;
  } catch {
    // Ignore an invalid or cross-origin notification target.
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      if ("navigate" in existing) await existing.navigate(targetUrl.href);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(targetUrl.href);
  })());
});
