import assert from "node:assert/strict";
import { createGuestSession } from "../../src/lib/app/guest.ts";
import { createTrip } from "../../src/lib/app/repository.ts";
import { verifyAccountOnboarding } from "../../src/lib/auth/account-session.ts";

/** Synthetic fixtures explicitly create their trip through the same two steps as a guest. */
export async function createGuestTripFixture(pool, config, input, env) {
  const before = process.env.GUEST_MODE_ENABLED;
  process.env.GUEST_MODE_ENABLED = "true";
  try {
    const guest = await createGuestSession(pool, config, input, env);
    const principal = await verifyAccountOnboarding(pool, config, guest.grant.rawToken);
    assert.ok(principal);
    const today = new Date().toISOString().slice(0,10);
    const trip = await createTrip(pool, principal, { name: "Synthetic guest trip", destinationName: "Tokyo, Japan",
      timeZone: "UTC", defaultLocale: input.locale, defaultCurrency: "JPY", startsOn: today, endsOn: today, maxMembers: 1 },
    { config, userAgent: input.userAgent });
    return { tripId: trip.tripId, grant: trip.sessionGrant, userId: guest.userId };
  } finally {
    if (before === undefined) delete process.env.GUEST_MODE_ENABLED;
    else process.env.GUEST_MODE_ENABLED = before;
  }
}
