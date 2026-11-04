import { z } from "zod";

export const tripDeletionInputSchema = z.strictObject({
  confirmationName: z.string().min(1).max(400),
});
export type TripDeletionInput = z.infer<typeof tripDeletionInputSchema>;

export type TripDeletionPreview = {
  trip: { id: string; name: string };
  /** A user with no other trip could not get back in while public signup is off. */
  blockedReason: "last_trip" | null;
  nextTripName: string | null;
  counts: { otherMembers: number; events: number; expenses: number; repayments: number; pendingRequests: number };
};

/**
 * Forgives only what a person cannot see or easily type differently: surrounding or repeated
 * spaces (including no-break spaces) and composition differences from a phone keyboard or CJK IME.
 */
export function matchesTripName(typed: string, tripName: string): boolean {
  const normalize = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
  return normalize(typed).length > 0 && normalize(typed) === normalize(tripName);
}
