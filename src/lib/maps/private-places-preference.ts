// The day map's only browser-stored state: whether this viewer turned private
// places off (D-081). No map data, place or trip is ever stored.
const key = "stardust.day-map.include-private";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem" | "removeItem">;
const browserStorage = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

/** Private places are included unless this browser's viewer turned them off. */
export function readIncludePrivatePlaces(storage: Reader | null = browserStorage()): boolean {
  try { return storage?.getItem(key) !== "off"; } catch { return true; }
}

export function saveIncludePrivatePlaces(value: boolean, storage: Writer | null = browserStorage()): void {
  try { if (value) storage?.removeItem(key); else storage?.setItem(key, "off"); } catch { /* The choice then lasts for this map only. */ }
}
