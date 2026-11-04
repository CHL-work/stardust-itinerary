import Link from "next/link";

import { SessionDevices } from "@/components/session-devices";

export default function SessionsPage() {
  return (
    <main className="auth-page">
      <section className="auth-panel wide">
        <p className="eyebrow">Security</p>
        <h1>Devices and sessions</h1>
        <p>Review active browser sessions and revoke anything you do not recognize.</p>
        <SessionDevices />
        <Link className="auth-secondary" href="/">Return to trip</Link>
      </section>
    </main>
  );
}
