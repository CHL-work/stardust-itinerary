// The AI tab's only browser-stored state: which sections this viewer opened or closed (JOB-093). No trip,
// prompt or account data is stored; a browser without storage simply uses the defaults.
const key = "stardust.ai-tab.sections";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "getItem" | "setItem">;
const browserStorage = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

function stored(storage: Reader | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch { return {}; }
}

export function readSectionOpen(id: string, fallback: boolean, storage: Reader | null = browserStorage()): boolean {
  const value = stored(storage)[id];
  return typeof value === "boolean" ? value : fallback;
}

export function saveSectionOpen(id: string, open: boolean, storage: Writer | null = browserStorage()): void {
  try { storage?.setItem(key, JSON.stringify({ ...stored(storage), [id]: open })); } catch { /* Lasts for this page only. */ }
}
