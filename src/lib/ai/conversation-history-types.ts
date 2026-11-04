import type { AiRecoveredRequest } from "@/lib/ai/request-recovery-types";
import type { AiImageSummary } from "@/lib/ai/image-types";

export type AiConversationSummary = {
  conversationId: string;
  purpose?: import("@/lib/app/types").AiConversationPurpose;
  title: string;
  createdAt: string;
  lastUsedAt: string;
  closedAt: string | null;
  isActive: boolean;
  canResume: boolean;
};

export type AiConversationListResponse = {
  conversations: AiConversationSummary[];
  activeConversationId: string | null;
  nextCursor: string | null;
};

export type AiConversationMessage = AiRecoveredRequest & { prompt: string; model: string; images?: AiImageSummary[] };

export type AiConversationMessagesResponse = {
  conversation: AiConversationSummary;
  messages: AiConversationMessage[];
  nextCursor: string | null;
};
