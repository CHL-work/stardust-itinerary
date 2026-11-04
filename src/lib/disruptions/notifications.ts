import type { EventDisruption } from "@/lib/app/types";

export const DISRUPTION_RECEIPTS_KEY = "stardust-disruption-receipts-v1";
const MAX_RECEIPTS = 4096;
const MAX_STORAGE_LENGTH = 400_000;
const RECEIPT_KEY = /^[bn]:[a-f0-9]{64}$/u;

export type NotificationWarning = { id: string; title: string; disruption: EventDisruption };
type ReceiptLedger = { version: 1; entries: Record<string, number> };
export type NotificationDependencies = {
  storage: Pick<Storage, "getItem" | "setItem">;
  exclusive: (run: () => Promise<void>) => Promise<void>;
  digest: (value: string) => Promise<string>;
  show: (warning: NotificationWarning, tag: string) => Promise<void>;
  isCurrent: () => boolean;
  canNotify: () => boolean;
  now: () => number;
};

// Evidence refresh metadata is not a new user-facing warning. In particular,
// provider-derived interval bounds and alternate source URLs may vary at each
// check even when the original detail remains byte-for-byte identical.
export function notificationContent(warning: NotificationWarning): string {
  const { disruption } = warning;
  return JSON.stringify([
    warning.id, disruption.firstSeenAt, disruption.state, disruption.reasonCode, disruption.severity,
    disruption.detail.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase(),
  ]);
}

function readLedger(storage: NotificationDependencies["storage"]): ReceiptLedger {
  const raw = storage.getItem(DISRUPTION_RECEIPTS_KEY);
  if (raw === null) return { version: 1, entries: {} };
  if (raw.length > MAX_STORAGE_LENGTH) throw new Error("Invalid notification receipts.");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1
      || !("entries" in parsed) || !parsed.entries || typeof parsed.entries !== "object"
      || Array.isArray(parsed.entries)) throw new Error("Invalid notification receipts.");
  const entries = Object.entries(parsed.entries);
  if (entries.length > MAX_RECEIPTS || entries.some(([key, value]) => (
    !RECEIPT_KEY.test(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0
  ))) throw new Error("Invalid notification receipts.");
  return { version: 1, entries: Object.fromEntries(entries) };
}

function saveLedger(
  deps: NotificationDependencies, ledger: ReceiptLedger, baseline: string, reserved?: string,
): void {
  const entries = Object.entries(ledger.entries).reverse().sort((left, right) => right[1] - left[1]);
  const pinned = reserved ? [baseline, reserved] : [baseline];
  ledger.entries = Object.fromEntries([
    ...pinned.map((key) => [key, ledger.entries[key]]),
    ...entries.filter(([key]) => !pinned.includes(key)).slice(0, MAX_RECEIPTS - pinned.length),
  ]);
  deps.storage.setItem(DISRUPTION_RECEIPTS_KEY, JSON.stringify(ledger));
}

/** Browser-local at-most-once attempts; never a server delivery receipt. */
export async function notifyNewDisruptions(input: {
  tripId: string;
  memberId: string;
  warnings: readonly NotificationWarning[];
}, deps: NotificationDependencies): Promise<void> {
  try {
    const scope = JSON.stringify([input.tripId, input.memberId]);
    const baseline = `b:${await deps.digest(scope)}`;
    const warnings = await Promise.all(input.warnings.map(async (warning) => ({
      warning,
      key: `n:${await deps.digest(JSON.stringify([scope, notificationContent(warning)]))}`,
    })));
    await deps.exclusive(async () => {
      if (!deps.isCurrent()) return;
      const ledger = readLedger(deps.storage);
      const firstVisit = ledger.entries[baseline] === undefined;
      ledger.entries[baseline] = deps.now();
      if (firstVisit || !deps.canNotify()) {
        // Existing warnings are already visible in the app; no catch-up burst
        // on first install, permission enable, storage eviction or a new member.
        for (const { key } of warnings) ledger.entries[key] = deps.now();
        saveLedger(deps, ledger, baseline);
        return;
      }

      let attempted = 0;
      for (const { warning, key } of warnings) {
        if (!deps.isCurrent() || !deps.canNotify()) break;
        if (ledger.entries[key] !== undefined) continue;
        if (attempted >= 3) break; // Remaining unseen warnings wait for another refresh.
        attempted += 1;
        // Persist BEFORE showing, under a cross-tab lock. A process death in
        // this tiny window can miss an optional alert, but cannot repeat it.
        ledger.entries[key] = deps.now();
        saveLedger(deps, ledger, baseline, key);
        try {
          await deps.show(warning, `stardust-disruption-${key.slice(2)}`);
        } catch {
          delete ledger.entries[key];
          saveLedger(deps, ledger, baseline);
        }
      }
    });
  } catch {
    // No safe persistence/lock means no optional pop-up, not an in-memory
    // fallback that would spam on each reload. The in-app warning is unaffected.
  }
}

export async function notifyBrowserDisruptions(input: {
  tripId: string;
  memberId: string;
  warnings: readonly NotificationWarning[];
  title: string;
  body: (warning: NotificationWarning) => string;
  url: string;
  isCurrent: () => boolean;
}): Promise<void> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)
        || !("serviceWorker" in navigator) || !navigator.locks || !crypto.subtle) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active || !input.isCurrent()) return;
    await notifyNewDisruptions(input, {
      storage: window.localStorage,
      exclusive: (run) => navigator.locks.request(DISRUPTION_RECEIPTS_KEY, run),
      digest: async (value) => Array.from(new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      ), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      isCurrent: input.isCurrent,
      canNotify: () => Notification.permission === "granted",
      now: Date.now,
      show: (warning, tag) => {
        const options: NotificationOptions & { renotify: boolean } = {
          body: input.body(warning),
          icon: "/icons/stardust-192.png",
          badge: "/icons/stardust-192.png",
          tag,
          renotify: false,
          data: { url: input.url },
        };
        return registration.showNotification(input.title, options);
      },
    });
  } catch {
    // Browser/OS delivery is optional and never blocks the trip UI.
  }
}
