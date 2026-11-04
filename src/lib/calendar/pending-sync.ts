import { z } from "zod";

export const pendingCalendarSyncStorageKey = "stardust.calendar-pending-sync";

const pendingCalendarSyncSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("connect") }),
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("item"), itemId: z.string().uuid() }),
]);

export type PendingCalendarSync = z.infer<typeof pendingCalendarSyncSchema>;

export function parsePendingCalendarSync(value: string | null): PendingCalendarSync | null {
  if (!value) return null;
  try {
    const result = pendingCalendarSyncSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function serializePendingCalendarSync(intent: PendingCalendarSync): string {
  return JSON.stringify(pendingCalendarSyncSchema.parse(intent));
}
