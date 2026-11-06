import { z } from "zod";

/**
 * The operator's admin page (JOB-069, D-084): who uses the instance and how much, never what they
 * wrote. Responses carry account metadata and counts only: no trip names or contents, prompts,
 * replies, places, expenses or keys.
 */
export const adminAccountFilters = ["all", "google", "guest", "suspended"] as const;
export type AdminAccountFilter = (typeof adminAccountFilters)[number];

export const ADMIN_PAGE_SIZE = 50;

export const adminAccountQuerySchema = z.strictObject({
  filter: z.enum(adminAccountFilters).default("all"),
  q: z.string().trim().max(120).default(""),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const adminSuspensionSchema = z.strictObject({ suspended: z.boolean() });

/** null removes the cap; 0 pauses new public sign-ups. */
export const adminSignupLimitSchema = z.strictObject({ dailyLimit: z.number().int().min(0).max(100_000).nullable() });

/** Who paid for AI requests: the requester's own key, a trip owner's shared key, the operator, or nobody (free guest AI). */
export type AdminAiCounts = { own: number; shared: number; operator: number; free: number };

export type AdminDay = {
  day: string; signups: number; guests: number; trips: number; ai: number; aiRefused: number; refused: number;
};

export type AdminOverview = {
  accounts: { google: number; guestsActive: number; suspended: number; newToday: number; new7d: number; new30d: number };
  active: { day: number; week: number; month: number };
  trips: { active: number; created7d: number };
  ai: {
    today: AdminAiCounts; week: AdminAiCounts; month: AdminAiCounts;
    refusedWeek: number; failedWeek: number; providersWeek: { provider: string; count: number }[];
  };
  refusalsWeek: { scope: string; count: number }[];
  signup: { enabled: boolean; dailyLimit: number | null; today: number };
  /** The last 14 UTC days, oldest first. */
  days: AdminDay[];
};

export type AdminAccount = {
  userId: string;
  displayName: string;
  /** The Google account's email; null for guests. */
  email: string | null;
  kind: "google" | "guest";
  createdAt: string;
  lastActiveAt: string | null;
  suspendedAt: string | null;
  guestExpiresAt: string | null;
  /** The operator's own account, which cannot be suspended. */
  isOperator: boolean;
  tripsOwned: number;
  tripsJoined: number;
  /** Providers with a saved key; never the key or its hint. */
  keys: string[];
  aiWeek: AdminAiCounts;
  refusedWeek: number;
};

export type AdminAccountPage = { accounts: AdminAccount[]; total: number; nextOffset: number | null };

export type AdminAccountDetail = {
  account: AdminAccount;
  sessions: { deviceLabel: string; createdAt: string; lastSeenAt: string; state: "active" | "expired" | "revoked" }[];
  /** The account's trips without names or contents: role, size and age only. */
  trips: { role: string; status: string; guest: boolean; deleted: boolean; createdAt: string; members: number; events: number }[];
  /** The last 30 UTC days, newest first, only days with any activity. */
  days: { day: string; ai: AdminAiCounts; aiRefused: number; refused: number; tripsCreated: number }[];
  /** What the account did, from the trip audit log: kind of record and action only. */
  recentActions: { at: string; entity: string; action: string }[];
  operatorActions: { at: string; action: string }[];
};
