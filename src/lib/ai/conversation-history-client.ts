import type { AiConversationListResponse, AiConversationMessagesResponse, AiConversationSummary } from "@/lib/ai/conversation-history-types";

export type AiHistoryTurn = AiConversationMessagesResponse["messages"][number];
export type AiHistoryState = {
  conversations: AiConversationSummary[];
  activeConversationId: string | null;
  selectedConversationId: string | null;
  conversation: AiConversationSummary | null;
  messages: AiHistoryTurn[];
  listCursor: string | null;
  messageCursor: string | null;
  listLoading: boolean;
  messageLoading: boolean;
  olderLoading: boolean;
  listError: boolean;
  messageError: boolean;
  accessDenied: boolean;
};

export function emptyAiHistoryState(): AiHistoryState {
  return {
    conversations: [], activeConversationId: null, selectedConversationId: null,
    conversation: null, messages: [], listCursor: null, messageCursor: null,
    listLoading: true, messageLoading: false, olderLoading: false,
    listError: false, messageError: false, accessDenied: false,
  };
}

/** Retain loaded older pages while replacing matching rows with fresh server state. */
export function mergeAiHistoryTurns(existing: AiHistoryTurn[], incoming: AiHistoryTurn[]): AiHistoryTurn[] {
  const rows = new Map(existing.map((message) => [message.requestId, message]));
  for (const message of incoming) rows.set(message.requestId, message);
  return [...rows.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.requestId.localeCompare(right.requestId));
}

function mergeConversations(existing: AiConversationSummary[], incoming: AiConversationSummary[]): AiConversationSummary[] {
  const rows = new Map(existing.map((conversation) => [conversation.conversationId, conversation]));
  for (const conversation of incoming) rows.set(conversation.conversationId, conversation);
  return [...rows.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.conversationId.localeCompare(left.conversationId));
}

/** Read-only, in-memory history. Browsing never activates a conversation or sends a prompt. */
export function createAiConversationHistoryClient(options: {
  loadList: (cursor?: string) => Promise<AiConversationListResponse>;
  loadMessages: (conversationId: string, cursor?: string) => Promise<AiConversationMessagesResponse>;
  changed: (state: AiHistoryState) => void;
}) {
  let state = emptyAiHistoryState();
  let disposed = false;
  let listGeneration = 0;
  let messageGeneration = 0;
  const publish = (next: AiHistoryState) => {
    if (disposed) return;
    state = next;
    options.changed(next);
  };
  const denied = (error: unknown) => {
    const status = error && typeof error === "object" && "status" in error ? error.status : null;
    if (status !== 401 && status !== 403) return false;
    listGeneration += 1;
    messageGeneration += 1;
    publish({ ...emptyAiHistoryState(), listLoading: false, listError: true, accessDenied: true });
    return true;
  };

  async function loadMessages(conversationId: string, older = false) {
    if (disposed || state.accessDenied || (older && (!state.messageCursor || state.olderLoading || state.messageLoading))) return;
    const cursor = older ? state.messageCursor! : undefined;
    const version = ++messageGeneration;
    publish({ ...state, messageLoading: !older, olderLoading: older, messageError: false });
    try {
      const response = await options.loadMessages(conversationId, cursor);
      if (disposed || version !== messageGeneration || state.selectedConversationId !== conversationId) return;
      if (response.conversation.conversationId !== conversationId) throw new Error("Conversation response did not match selection.");
      const overlapsLoadedPage = response.messages.some((incoming) => state.messages.some((existing) => existing.requestId === incoming.requestId));
      publish({
        ...state, conversation: response.conversation,
        messages: mergeAiHistoryTurns(state.messages, response.messages),
        messageCursor: older || !overlapsLoadedPage ? response.nextCursor : state.messageCursor,
        messageLoading: false, olderLoading: false, messageError: false,
      });
    } catch (error) {
      if (disposed || version !== messageGeneration) return;
      if (!denied(error)) publish({ ...state, messageLoading: false, olderLoading: false, messageError: true });
    }
  }

  async function loadList(more = false, followActive = false) {
    if (disposed || state.accessDenied || (more && (!state.listCursor || state.listLoading))) return;
    const cursor = more ? state.listCursor! : undefined;
    const version = ++listGeneration;
    publish({ ...state, listLoading: true, listError: false });
    try {
      const response = await options.loadList(cursor);
      if (disposed || version !== listGeneration) return;
      const conversations = mergeConversations(state.conversations, response.conversations)
        .map((conversation) => ({ ...conversation, isActive: conversation.conversationId === response.activeConversationId }));
      const overlapsLoadedPage = response.conversations.some((incoming) => state.conversations.some((existing) => existing.conversationId === incoming.conversationId));
      const selected = followActive || !state.selectedConversationId
        ? response.activeConversationId ?? conversations[0]?.conversationId ?? null
        : state.selectedConversationId;
      const switched = selected !== state.selectedConversationId;
      if (switched) messageGeneration += 1;
      publish({
        ...state, conversations, activeConversationId: response.activeConversationId,
        selectedConversationId: selected,
        ...(switched ? { conversation: null, messages: [], messageCursor: null, messageError: false, messageLoading: Boolean(selected), olderLoading: false } : {}),
        listCursor: more || !overlapsLoadedPage ? response.nextCursor : state.listCursor,
        listLoading: false, listError: false,
      });
      if (!more && selected) await loadMessages(selected);
    } catch (error) {
      if (disposed || version !== listGeneration) return;
      if (!denied(error)) publish({ ...state, listLoading: false, listError: true });
    }
  }

  return {
    getState: () => state,
    refresh: (followActive = false) => loadList(false, followActive),
    loadMoreConversations: () => loadList(true),
    loadOlderMessages: () => state.selectedConversationId ? loadMessages(state.selectedConversationId, true) : Promise.resolve(),
    async select(conversationId: string) {
      if (disposed || state.accessDenied) return;
      messageGeneration += 1;
      publish({ ...state, selectedConversationId: conversationId, conversation: null, messages: [], messageCursor: null, messageLoading: true, olderLoading: false, messageError: false });
      await loadMessages(conversationId);
    },
    retryMessages: () => state.selectedConversationId ? loadMessages(state.selectedConversationId) : Promise.resolve(),
    handleAuthorizationFailure: (error: unknown) => !disposed && denied(error),
    dispose() { disposed = true; listGeneration += 1; messageGeneration += 1; },
  };
}

export type AiConversationHistoryClient = ReturnType<typeof createAiConversationHistoryClient>;
