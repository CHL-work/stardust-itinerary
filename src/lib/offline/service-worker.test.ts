import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

type FetchRequest = {
  method: string;
  mode: string;
  url: string;
};

type FetchEvent = {
  request: FetchRequest;
  respondWith(value: Promise<unknown>): void;
};

type FetchHandler = (event: FetchEvent) => void;

function networkResponse(contentType: string) {
  const response = {
    ok: true,
    status: 200,
    type: "basic",
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    clone: vi.fn(),
  };
  response.clone.mockImplementation(() => response);
  return response;
}

function loadFetchHandler(input: {
  cacheOpen: () => Promise<unknown>;
  fetchResponse: ReturnType<typeof networkResponse>;
}) {
  const handlers = new Map<string, FetchHandler>();
  const fetchMock = vi.fn(async () => input.fetchResponse);
  const source = readFileSync("public/sw.js", "utf8");

  runInNewContext(source, {
    URL,
    Request,
    Promise,
    caches: {
      delete: vi.fn(async () => true),
      keys: vi.fn(async () => []),
      open: vi.fn(input.cacheOpen),
    },
    fetch: fetchMock,
    self: {
      addEventListener(type: string, handler: FetchHandler) {
        handlers.set(type, handler);
      },
      clients: {
        claim: vi.fn(async () => undefined),
      },
      location: { origin: "https://stardust.example" },
      skipWaiting: vi.fn(async () => undefined),
    },
  });

  const handler = handlers.get("fetch");
  if (!handler) throw new Error("The service worker did not register its fetch handler.");
  return { fetchMock, handler };
}

async function dispatchFetch(handler: FetchHandler, request: FetchRequest) {
  let responsePromise: Promise<unknown> | undefined;
  handler({
    request,
    respondWith(value) {
      responsePromise = value;
    },
  });
  if (!responsePromise) throw new Error("The service worker did not handle the request.");
  return responsePromise;
}

describe("offline service worker", () => {
  it("returns a successful online navigation when Cache Storage cannot open", async () => {
    const response = networkResponse("text/html; charset=utf-8");
    const { fetchMock, handler } = loadFetchHandler({
      cacheOpen: async () => {
        throw new Error("storage disabled");
      },
      fetchResponse: response,
    });

    const result = await dispatchFetch(handler, {
      method: "GET",
      mode: "navigate",
      url: "https://stardust.example/en",
    });

    expect(result).toBe(response);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns a successful online navigation when saving the shell fails", async () => {
    const response = networkResponse("text/html; charset=utf-8");
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    };
    const { handler } = loadFetchHandler({
      cacheOpen: async () => cache,
      fetchResponse: response,
    });

    const result = await dispatchFetch(handler, {
      method: "GET",
      mode: "navigate",
      url: "https://stardust.example/zh-HK-lihkg",
    });

    expect(result).toBe(response);
    expect(cache.put).toHaveBeenCalledTimes(2);
  });

  it("returns a successful immutable asset when saving it fails", async () => {
    const response = networkResponse("text/javascript");
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    };
    const { handler } = loadFetchHandler({
      cacheOpen: async () => cache,
      fetchResponse: response,
    });

    const result = await dispatchFetch(handler, {
      method: "GET",
      mode: "cors",
      url: "https://stardust.example/_next/static/chunk.js",
    });

    expect(result).toBe(response);
    expect(cache.put).toHaveBeenCalledOnce();
  });
});
