import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISRUPTION_RECEIPTS_KEY, notificationContent, notifyNewDisruptions, notifyBrowserDisruptions,
  type NotificationDependencies, type NotificationWarning,
} from "@/lib/disruptions/notifications";

function warning(overrides: Partial<NotificationWarning["disruption"]> = {}): NotificationWarning {
  return { id: "synthetic-event", title: "Station visit", disruption: {
    observationId: "observation-a", evidenceFingerprint: "a".repeat(64),
    state: "confirmed", reasonCode: "transit_disruption", severity: "warning",
    detail: "The local line has reduced service on September 7.",
    sourceUrls: ["https://rail.example.com/status"], firstSeenAt: "2026-09-05T00:00:00Z",
    lastSeenAt: "2026-09-06T00:00:00Z", checkedAt: "2026-09-06T00:00:00Z",
    staleAfter: "2026-09-06T01:00:00Z", ...overrides,
  } };
}

function harness() {
  const records = new Map<string, string>();
  let tail = Promise.resolve();
  const deps: NotificationDependencies = {
    storage: {
      getItem: vi.fn((key) => records.get(key) ?? null),
      setItem: vi.fn((key, value) => { records.set(key, value); }),
    },
    exclusive: (run) => {
      const next = tail.then(run);
      tail = next.catch(() => undefined);
      return next;
    },
    digest: async (value) => createHash("sha256").update(value).digest("hex"),
    show: vi.fn(async () => undefined), isCurrent: () => true,
    canNotify: () => true, now: () => 1_000,
  };
  const send = (warnings: NotificationWarning[], scope = { tripId: "trip-a", memberId: "member-a" }) => (
    notifyNewDisruptions({ ...scope, warnings }, deps)
  );
  return { deps, records, send };
}

describe("disruption notification receipts", () => {
  it("quietly baselines existing warnings, including first permission enable", async () => {
    const h = harness();
    h.deps.canNotify = () => false;
    await h.send([warning()]);
    h.deps.canNotify = () => true;
    await h.send([warning()]);
    expect(h.deps.show).not.toHaveBeenCalled();
  });

  it("notifies once across refresh, remount and temporary disappearance", async () => {
    const h = harness();
    await h.send([]);
    await h.send([warning()]);
    await h.send([]);
    // A new invocation has no in-memory observed-warning state to reuse.
    await notifyNewDisruptions({ tripId: "trip-a", memberId: "member-a", warnings: [warning()] }, { ...h.deps });
    await h.send([warning()]);
    expect(h.deps.show).toHaveBeenCalledTimes(1);
  });

  it("ignores new observation/fingerprint, check times, sources, title and translations", async () => {
    const h = harness();
    await h.send([]);
    await h.send([warning()]);
    await h.send([{ ...warning({
      observationId: "observation-b", evidenceFingerprint: "b".repeat(64),
      checkedAt: "2026-09-06T00:30:00Z", lastSeenAt: "2026-09-06T00:30:00Z",
      staleAfter: "2026-09-06T01:30:00Z", sourceUrls: ["https://rail.example.com/alternative"],
      localizedDetails: { en: "Same evidence", "zh-HK": "同一警告", "ja-JP": "同じ警告" },
    }), title: "Localized station visit" }]);
    expect(h.deps.show).toHaveBeenCalledTimes(1);
  });

  it.each([
    { detail: "The local line is now fully suspended on September 7." },
    { severity: "critical" as const },
    { state: "possible" as const },
    { reasonCode: "cancellation" as const },
    { firstSeenAt: "2026-09-08T00:00:00Z" },
  ])("notifies once for a changed warning or new episode: %j", async (change) => {
    const h = harness();
    await h.send([warning()]);
    await h.send([warning(change)]);
    await h.send([warning(change)]);
    expect(h.deps.show).toHaveBeenCalledTimes(1);
  });

  it("normalizes cosmetic case and whitespace without hiding changed numbers/negation", () => {
    expect(notificationContent(warning({ detail: " SERVICE  delayed. " })))
      .toBe(notificationContent(warning({ detail: "service\ndelayed." })));
    expect(notificationContent(warning({ detail: "Delay 30 minutes" })))
      .not.toBe(notificationContent(warning({ detail: "Delay 90 minutes" })));
    expect(notificationContent(warning({ detail: "Service is running" })))
      .not.toBe(notificationContent(warning({ detail: "Service is not running" })));
  });

  it("coordinates concurrent tabs and duplicate rows under the shared lock", async () => {
    const h = harness();
    await h.send([]);
    await Promise.all([h.send([warning(), warning()]), h.send([warning()]), h.send([warning()])]);
    expect(h.deps.show).toHaveBeenCalledTimes(1);
  });

  it("scopes receipts to both trip and member without storing warning content or IDs", async () => {
    const h = harness();
    const scopes = [
      { tripId: "trip-a", memberId: "member-a" },
      { tripId: "trip-a", memberId: "member-b" },
      { tripId: "trip-b", memberId: "member-a" },
    ];
    for (const scope of scopes) { await h.send([], scope); await h.send([warning()], scope); }
    expect(h.deps.show).toHaveBeenCalledTimes(3);
    const raw = h.records.get(DISRUPTION_RECEIPTS_KEY)!;
    for (const secret of ["trip-a", "member-a", "synthetic-event", "Station visit", "reduced service", "rail.example.com"])
      expect(raw).not.toContain(secret);
    expect(Object.keys(JSON.parse(raw).entries)).toHaveLength(6);
  });

  it("persists before display and releases a failed attempt for a later retry", async () => {
    const h = harness();
    await h.send([]);
    let fail = true;
    h.deps.show = vi.fn(async () => {
      expect(Object.keys(JSON.parse(h.records.get(DISRUPTION_RECEIPTS_KEY)!).entries)).toHaveLength(2);
      if (fail) throw new Error("Browser refused notification");
    });
    await h.send([warning()]);
    fail = false;
    await h.send([warning()]);
    await h.send([warning()]);
    expect(h.deps.show).toHaveBeenCalledTimes(2);
  });

  it("does not consume warnings beyond the three-attempt cap", async () => {
    const h = harness();
    await h.send([]);
    const warnings = Array.from({ length: 5 }, (_, index) => ({ ...warning(), id: `item-${index}` }));
    await h.send(warnings);
    expect(h.deps.show).toHaveBeenCalledTimes(3);
    await h.send(warnings);
    expect(h.deps.show).toHaveBeenCalledTimes(5);
    await h.send(warnings);
    expect(h.deps.show).toHaveBeenCalledTimes(5);
  });

  it.each(["get", "set", "lock", "digest", "malformed"])("fails quietly if %s is unavailable", async (failure) => {
    const h = harness();
    await h.send([]);
    const reject = () => { throw new Error("Unavailable"); };
    if (failure === "get") h.deps.storage.getItem = reject;
    if (failure === "set") h.deps.storage.setItem = reject;
    if (failure === "lock") h.deps.exclusive = reject;
    if (failure === "digest") h.deps.digest = reject;
    if (failure === "malformed") h.records.set(DISRUPTION_RECEIPTS_KEY, '{"version":1,"entries":{"bad":"data"}}');
    await h.send([warning()]);
    expect(h.deps.show).not.toHaveBeenCalled();
  });

  it("ignores stale work after a scope change, including a queued lock", async () => {
    const h = harness();
    await h.send([]);
    const original = h.deps.exclusive;
    h.deps.exclusive = (run) => original(async () => {
      h.deps.isCurrent = () => false;
      await run();
    });
    await h.send([warning()]);
    expect(h.deps.show).not.toHaveBeenCalled();
    expect(Object.keys(JSON.parse(h.records.get(DISRUPTION_RECEIPTS_KEY)!).entries)).toHaveLength(1);
  });

  it.each([1000, 2000])("keeps a reserved receipt when full, even after clock rollback (%i)", async (oldTimestamp) => {
    const h = harness();
    await h.send([]);
    const ledger = JSON.parse(h.records.get(DISRUPTION_RECEIPTS_KEY)!);
    for (let i = 0; i < 4095; i++) ledger.entries[`n:${i.toString(16).padStart(64, "0")}`] = oldTimestamp;
    h.records.set(DISRUPTION_RECEIPTS_KEY, JSON.stringify(ledger));
    await h.send([warning()]);
    await h.send([warning()]);
    expect(h.deps.show).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(h.records.get(DISRUPTION_RECEIPTS_KEY)!).entries)).toHaveLength(4096);
  });

  it("wires public-only warnings, cancellation, localized copy and silent tags in the browser", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    const browser = readFileSync("src/lib/disruptions/notifications.ts", "utf8");
    expect(shell).toContain('item.visibility === "trip" && item.disruption');
    expect(shell).toContain("memberId: overview.session.memberId");
    expect(shell).toContain("isCurrent: () => !cancelled");
    expect(shell).toContain("messages.disruptionNotificationBody");
    expect(shell).not.toContain("observedDisruptions");
    expect(browser).toContain("navigator.locks.request(DISRUPTION_RECEIPTS_KEY, run)");
    expect(browser).toContain("renotify: false");
    expect(browser).not.toContain("requestPermission");
  });
});

describe("browser disruption delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  function browserHarness() {
    const h = harness();
    const showNotification = vi.fn(async () => undefined);
    const registration = { active: {}, showNotification };
    const getRegistration = vi.fn(async () => registration);
    const permission = { permission: "granted" };
    const request = vi.fn((_key: string, run: () => Promise<void>) => h.deps.exclusive(run));
    vi.stubGlobal("window", { localStorage: h.deps.storage, Notification: permission });
    vi.stubGlobal("Notification", permission);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration }, locks: { request } });
    const input = {
      tripId: "trip-a", memberId: "member-a", warnings: [] as NotificationWarning[],
      title: "交通異常", body: () => "有交通預警", url: "/zh-HK-lihkg", isCurrent: () => true,
    };
    return { ...h, input, showNotification, getRegistration, request };
  }

  it("delivers one localized tagged notification through the real browser adapter", async () => {
    const h = browserHarness();
    await notifyBrowserDisruptions(h.input);
    await notifyBrowserDisruptions({ ...h.input, warnings: [warning()] });
    await notifyBrowserDisruptions({ ...h.input, warnings: [warning()] });
    expect(h.request).toHaveBeenCalledWith(DISRUPTION_RECEIPTS_KEY, expect.any(Function));
    expect(h.showNotification).toHaveBeenCalledExactlyOnceWith("交通異常", {
      body: "有交通預警", tag: expect.stringMatching(/^stardust-disruption-[a-f0-9]{64}$/u),
      renotify: false, icon: "/icons/stardust-192.png", badge: "/icons/stardust-192.png",
      data: { url: "/zh-HK-lihkg" },
    });
  });

  it("fails quietly on unsupported locking or service-worker failure", async () => {
    const h = browserHarness();
    await notifyBrowserDisruptions(h.input);
    h.getRegistration.mockRejectedValueOnce(new Error("Unavailable"));
    await notifyBrowserDisruptions({ ...h.input, warnings: [warning()] });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: h.getRegistration } });
    await notifyBrowserDisruptions({ ...h.input, warnings: [warning()] });
    expect(h.showNotification).not.toHaveBeenCalled();
  });

  it("does not show a late notification after the old page/scope is cancelled", async () => {
    const h = browserHarness();
    await notifyBrowserDisruptions(h.input);
    let current = true;
    h.getRegistration.mockImplementationOnce(async () => {
      current = false;
      return { active: {}, showNotification: h.showNotification };
    });
    await notifyBrowserDisruptions({ ...h.input, warnings: [warning()], isCurrent: () => current });
    expect(h.showNotification).not.toHaveBeenCalled();
  });
});
