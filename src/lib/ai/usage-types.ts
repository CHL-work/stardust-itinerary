/** Browser-safe shapes of the AI tab's usage summary (JOB-093); the query lives in usage-summary.ts. */
export const AI_USAGE_DAYS = 30;

export const aiUsageServices = ["chat", "routine", "tripSetup", "other"] as const;
export type AiUsageService = (typeof aiUsageServices)[number];
/** Who paid: the account's own key ("mine", including members on its shared key), a free model, or someone else. */
export type AiUsagePayer = "mine" | "free" | "others";

export type AiUsageSummary = {
  since: string;
  days: { date: string; tokens: Record<AiUsageService, number> }[];
  services: { service: AiUsageService; requests: number; tokens: number; costUsd: number }[];
  models: { model: string; provider: string; payer: AiUsagePayer; requests: number; tokens: number; costUsd: number | null }[];
  total: { requests: number; tokens: number; costUsd: number; webSearches: number };
};
