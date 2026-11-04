"use client";

import { useEffect, useState } from "react";

type Device = {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

export function SessionDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);

  async function fetchDevices(): Promise<Device[]> {
    const response = await fetch("/api/auth/sessions", { credentials: "same-origin" });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { devices: Device[] };
    return payload.devices;
  }

  useEffect(() => {
    let active = true;
    void fetchDevices().then((nextDevices) => {
      if (active) setDevices(nextDevices);
    });
    return () => {
      active = false;
    };
  }, []);

  async function revoke(sessionId: string) {
    await fetch("/api/auth/sessions", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    setDevices(await fetchDevices());
  }

  if (!devices) return <p>Loading sessions…</p>;
  if (devices.length === 0) return <p>No active session is available. Sign in again.</p>;

  return (
    <div className="session-list">
      {devices.map((device) => (
        <article className="session-device" key={device.id}>
          <div>
            <strong>{device.deviceLabel}</strong>
            <p>Last used {new Date(device.lastSeenAt).toLocaleString()}</p>
          </div>
          <button className="auth-secondary" onClick={() => revoke(device.id)} type="button">
            {device.current ? "Sign out this device" : "Revoke"}
          </button>
        </article>
      ))}
    </div>
  );
}
