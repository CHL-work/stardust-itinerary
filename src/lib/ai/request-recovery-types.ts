import type { AiProviderFailureDetails } from "@/lib/ai/provider-failure";

/** Safe, self-only delivery data. Never include prompts or provider diagnostics. */
export type AiPlannerResult = {
  requestId: string;
  message: string;
  proposalIds: string[];
  proposalCount: number;
  proposalId: string | null;
  changeStatus: "approved" | "pending" | null;
  entityId: string | null;
  model: string;
  usedToday: number;
  remainingToday: number | null;
  webSearch: { performed: boolean; queryCount: number; sources: string[] };
  memory: {
    previousTurnsUsed: number;
    tokenEstimate: number;
    tokenBudget: number;
    checkpointVersion: number | null;
    truncated: boolean;
  };
};

export type AiRecoveredRequest = {
  requestId: string;
  clientRequestId: string | null;
  conversationId: string | null;
  status: "running" | "succeeded" | "failed" | "interrupted";
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  message: string | null;
  result: AiPlannerResult | null;
  providerFailure?: AiProviderFailureDetails;
};

export type AiRequestRecoveryResponse = {
  request: AiRecoveredRequest | null;
  busyElsewhere: boolean;
  activeConversationId?: string | null;
};
