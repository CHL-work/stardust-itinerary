import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_UI_MODE, normalizeUiMode, UI_MODE_STORAGE_KEY, uiModeBootstrapScript } from "@/lib/ui-mode";
import { applyUiMode, ensureUiModeAttribute, readUiMode, setUiMode, subscribeUiMode } from "@/lib/ui-mode-store";

function fakeDom(stored: string | null, options: { storageThrows?: boolean; attribute?: string | null } = {}) {
  const attributes = new Map<string, string>(options.attribute ? [["data-ui", options.attribute]] : []);
  const storage = new Map<string, string>(stored === null ? [] : [[UI_MODE_STORAGE_KEY, stored]]);
  const events: string[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const documentElement = {
    lang: "zh-HK",
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
  };
  const document = { documentElement };
  const window = {
    localStorage: {
      getItem: (key: string) => { if (options.storageThrows) throw new Error("blocked"); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (options.storageThrows) throw new Error("blocked"); storage.set(key, value); },
    },
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => { listeners.get(type)?.delete(listener); },
  };
  return { attributes, storage, events, listeners, document, documentElement, window };
}

afterEach(() => vi.unstubAllGlobals());

describe("JOB-048 layout preference", () => {
  it("defaults to the new layout and accepts only the two known modes", () => {
    expect(DEFAULT_UI_MODE).toBe("new");
    expect(normalizeUiMode("classic")).toBe("classic");
    for (const value of ["new", "", "CLASSIC", null, undefined, 1, "dark"]) expect(normalizeUiMode(value)).toBe("new");
  });

  it.each([
    ["classic", "classic"], ["new", "new"], [null, "new"], ["unexpected", "new"],
  ])("bootstrap applies stored %s as %s before paint", (stored, expected) => {
    const dom = fakeDom(stored);
    new Function("window", "document", "location", uiModeBootstrapScript)(dom.window, dom.document, { pathname: "/en" });
    expect(dom.attributes.get("data-ui")).toBe(expected);
  });

  it("bootstrap falls back to the new layout when storage is blocked", () => {
    const dom = fakeDom("classic", { storageThrows: true });
    new Function("window", "document", "location", uiModeBootstrapScript)(dom.window, dom.document, { pathname: "/en" });
    expect(dom.attributes.get("data-ui")).toBe("new");
  });

  it.each([
    ["/en", "en"], ["/ja-JP", "ja-JP"], ["/zh-HK", "zh-HK"], ["/zh-HK-lihkg", "zh-HK"], ["/auth/sign-in", "zh-HK"], ["/", "zh-HK"],
  ])("bootstrap sets the document language for %s before paint", (pathname, lang) => {
    const dom = fakeDom(null);
    new Function("window", "document", "location", uiModeBootstrapScript)(dom.window, dom.document, { pathname });
    expect(dom.documentElement.lang).toBe(lang);
  });

  it("reads the applied attribute and persists explicit choices on this device", () => {
    const dom = fakeDom(null, { attribute: "new" });
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("window", dom.window);
    expect(readUiMode()).toBe("new");
    setUiMode("classic");
    expect(dom.storage.get(UI_MODE_STORAGE_KEY)).toBe("classic");
    expect(dom.attributes.get("data-ui")).toBe("classic");
    expect(readUiMode()).toBe("classic");
    expect(dom.events).toEqual(["stardust:ui-mode"]);
    applyUiMode("new");
    expect(readUiMode()).toBe("new");
  });

  it("falls back to the stored choice and restores the attribute when it was removed", () => {
    const dom = fakeDom("classic");
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("window", dom.window);
    expect(readUiMode()).toBe("classic");
    ensureUiModeAttribute();
    expect(dom.attributes.get("data-ui")).toBe("classic");
    ensureUiModeAttribute();
    expect(dom.events).toEqual(["stardust:ui-mode"]);
  });

  it("still switches the open page when storage writes are blocked", () => {
    const dom = fakeDom(null, { storageThrows: true, attribute: "new" });
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("window", dom.window);
    expect(() => setUiMode("classic")).not.toThrow();
    expect(readUiMode()).toBe("classic");
  });

  it("shares one cross-tab listener and applies another tab's change once", () => {
    const dom = fakeDom("new", { attribute: "new" });
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("window", dom.window);
    const notified: number[] = [];
    const unsubscribers = [0, 1, 2].map((index) => subscribeUiMode(() => notified.push(index)));
    expect(dom.listeners.get("storage")?.size).toBe(1);
    const storageListener = [...dom.listeners.get("storage")!][0];
    storageListener({ key: "other", newValue: "classic" });
    expect(dom.attributes.get("data-ui")).toBe("new");
    storageListener({ key: UI_MODE_STORAGE_KEY, newValue: "classic" });
    expect(dom.attributes.get("data-ui")).toBe("classic");
    expect(notified).toEqual([0, 1, 2]);
    storageListener({ key: UI_MODE_STORAGE_KEY, newValue: "classic" });
    expect(notified).toEqual([0, 1, 2]);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    expect(dom.listeners.get("storage")?.size).toBe(0);
    expect(dom.listeners.get("stardust:ui-mode")?.size).toBe(0);
  });

  it("is safe to import and read without a DOM", () => {
    expect(readUiMode()).toBe("new");
  });
});
