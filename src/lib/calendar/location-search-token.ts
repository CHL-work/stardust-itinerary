import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppConflictError } from "@/lib/app/repository";

const receiptSchema = z.strictObject({
  version: z.literal(1), tripId: z.uuid(), memberId: z.uuid(), userId: z.uuid(), requestId: z.uuid(),
  locationName: z.string().min(1).max(500), mapUrl: z.string().max(2000),
  expiresAt: z.number().int().positive(),
});

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`stardust-calendar-location-v1\0${payload}`).digest();
}

export function createCalendarLocationToken(
  authSecret: string, session: AuthenticatedSession,
  value: { requestId: string; locationName: string; mapUrl: string }, now = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify(receiptSchema.parse({ version: 1, tripId: session.tripId,
    memberId: session.memberId, userId: session.userId, ...value, expiresAt: now + 30 * 60_000 }))).toString("base64url");
  return `${payload}.${signature(payload, authSecret).toString("base64url")}`;
}

/** A browser flag cannot grant AI provenance or bypass normal owner review. */
export function verifyCalendarLocationToken(
  token: string, authSecret: string, session: AuthenticatedSession,
  selected: { locationName: string | null; mapUrl: string | null },
): void {
  // Refining a suggestion cannot discard its AI provenance or owner-review requirement.
  void selected;
  try {
    if (token.length > 6000) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2 || !parts.every((part) => /^[\w-]+$/u.test(part))) throw new Error();
    const [payload, encodedSignature] = parts as [string, string];
    const actual = Buffer.from(encodedSignature, "base64url");
    const expected = signature(payload, authSecret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const receipt = receiptSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (receipt.tripId !== session.tripId || receipt.memberId !== session.memberId || receipt.userId !== session.userId
      || receipt.expiresAt <= Date.now()) throw new Error();
  } catch {
    throw new AppConflictError("CALENDAR_LOCATION_RECEIPT_INVALID");
  }
}
