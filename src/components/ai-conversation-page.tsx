"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ChevronLeft, Plus, RefreshCw } from "lucide-react";

import { AiReadableText } from "@/components/ai-readable-text";
import { AiSection, useAiSectionOpen } from "@/components/ai-section";
import { aiTabMessages } from "@/lib/ai/ai-tab-i18n";
import { createAiConversationHistoryClient, emptyAiHistoryState, type AiConversationHistoryClient, type AiHistoryState, type AiHistoryTurn } from "@/lib/ai/conversation-history-client";
import type { AiConversationListResponse, AiConversationMessagesResponse, AiConversationSummary } from "@/lib/ai/conversation-history-types";
import type { AiHistoryMessages } from "@/lib/ai/history-i18n";
import { aiImageMessages } from "@/lib/ai/image-i18n";
import { aiInstructionsMessages } from "@/lib/ai/instructions-i18n";
import { aiProviderFailureMessage } from "@/lib/ai/provider-failure-presentation";
import type { AiRecoveryState } from "@/lib/ai/request-recovery-client";
import type { Locale } from "@/lib/i18n";
import "./ai-conversation-page.css";

type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
export type AiConversationPageProps = {
  tripId: string;
  locale: Locale;
  messages: AiHistoryMessages;
  timeZone: string;
  isOwner?: boolean;
  recovery: AiRecoveryState;
  refreshToken?: string | number;
  request: Request;
  renderComposer: (conversationId: string | null, purpose: "trip" | "preferences") => ReactNode;
  newConversation: () => Promise<boolean | void>;
  resumeConversation: (conversationId: string) => Promise<boolean | void>;
  activeConversationChanged?: (conversationId: string | null) => void;
  onAuthorizationLost?: () => void;
  /** Under the composer, such as the chat effort picker (JOB-094). */
  chatFooter?: ReactNode;
  /** The AI tab's other sections, above Conversations, which holds the chat and past conversations (JOB-093, JOB-096). */
  sections?: ReactNode;
};

function localTime(instant: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, {
    timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

function publicSources(values: string[]): Array<{ href: string; host: string }> {
  return values.flatMap((value) => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
        ? [{ href: url.href, host: url.hostname }] : [];
    } catch { return []; }
  }).slice(0, 5);
}

export function AiConversationList({ conversations, selectedId, locale, timeZone, messages, select }: {
  conversations: AiConversationSummary[];
  selectedId: string | null;
  locale: Locale;
  timeZone: string;
  messages: AiHistoryMessages;
  select: (id: string) => void;
}) {
  return <div className="ai-conversation-list">
    {conversations.map((conversation) => <button type="button" key={conversation.conversationId}
      className={`ai-conversation-choice${selectedId === conversation.conversationId ? " is-selected" : ""}`}
      aria-current={selectedId === conversation.conversationId ? "true" : undefined}
      onClick={() => select(conversation.conversationId)}>
      <span>{conversation.title || messages.newConversation}</span>
      {conversation.purpose === "preferences" ? <span className="ai-purpose-badge">{aiInstructionsMessages(locale).archived}</span> : null}
      <small><span>{conversation.isActive ? messages.currentConversation : messages.archivedConversation}</span>
        <time dateTime={conversation.lastUsedAt}>{localTime(conversation.lastUsedAt, locale, timeZone)}</time></small>
    </button>)}
  </div>;
}

export function AiConversationTranscript({ turns, locale, timeZone, messages, tripId, isOwner = false }: {
  turns: AiHistoryTurn[];
  locale: Locale;
  timeZone: string;
  messages: AiHistoryMessages;
  tripId?: string;
  isOwner?: boolean;
}) {
  return <div className="ai-conversation-turns">
    {turns.map((turn) => {
      const answer = turn.status === "running" ? messages.messageRunning
        : turn.status === "interrupted" ? messages.messageInterrupted
          : turn.status === "failed" ? aiProviderFailureMessage(turn, { locale, timeZone, isOwner }) ?? messages.messageFailed
            : turn.result?.message ?? turn.message;
      const sources = turn.status === "succeeded" ? publicSources(turn.result?.webSearch.sources ?? []) : [];
      return <article className="ai-conversation-turn" key={turn.requestId} data-request-id={turn.requestId}>
        <div className="ai-message ai-message-user"><div className="ai-message-meta"><strong>{messages.you}</strong>
          <time dateTime={turn.createdAt}>{localTime(turn.createdAt, locale, timeZone)}</time></div><AiReadableText text={turn.prompt} />
          {tripId && turn.images?.length ? <div className="ai-message-images">{turn.images.map((image, index) => {
            const url = `/api/trips/${encodeURIComponent(tripId)}/ai/images/${encodeURIComponent(image.id)}`;
            return <a key={image.id} href={url} target="_blank" rel="noopener noreferrer">
              {/* Authenticated private/no-store images must never use the public Next image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} width={image.width} height={image.height} loading="lazy" decoding="async" referrerPolicy="no-referrer" alt={`${aiImageMessages(locale).saved} ${index + 1}`} />
            </a>;
          })}</div> : null}</div>
        {answer ? <div className={`ai-message ai-message-assistant${turn.status === "running" ? " is-running" : ""}`}>
          <div className="ai-message-meta"><strong>{messages.assistant}</strong><span>{messages.modelLabel}: {turn.model}</span></div>
          <AiReadableText text={answer} />
          {sources.length ? <ul className="ai-message-sources">{sources.map((url) => <li key={url.href}><a href={url.href} target="_blank" rel="noopener noreferrer">{url.host}</a></li>)}</ul> : null}
        </div> : null}
      </article>;
    })}
  </div>;
}

/** Page-local browsing is independent of the live per-user request controller. */
export function AiConversationPage(props: AiConversationPageProps) {
  const { tripId, locale, messages, timeZone, recovery, refreshToken, request, activeConversationChanged, onAuthorizationLost } = props;
  const instructionsCopy = aiInstructionsMessages(locale);
  const tabCopy = aiTabMessages(locale);
  // One section for the chat and past conversations (JOB-096); a new id, so it starts open for everyone.
  const [open, setOpen] = useAiSectionOpen("conversation", true);
  const chatSection = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<{ tripId: string; value: AiHistoryState } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const historyClient = useRef<AiConversationHistoryClient | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const olderScroll = useRef<{ conversationId: string; height: number; top: number } | null>(null);
  const authorizationLostNotified = useRef(false);
  const history = snapshot?.tripId === tripId ? snapshot.value : emptyAiHistoryState();
  const canChangeConversation = recovery.phase === "idle" && !actionBusy && !history.accessDenied;
  const selectedActive = history.selectedConversationId !== null
    && history.selectedConversationId === history.activeConversationId;
  const archived = history.conversation?.purpose === "preferences";

  useEffect(() => {
    authorizationLostNotified.current = false;
    const get = async <T,>(url: string): Promise<T> => {
      const abort = new AbortController();
      const timeout = window.setTimeout(() => abort.abort(), 15_000);
      try { return await request<T>(url, { cache: "no-store", signal: abort.signal }); }
      finally { window.clearTimeout(timeout); }
    };
    const base = `/api/trips/${encodeURIComponent(tripId)}/ai/conversations`;
    const client = createAiConversationHistoryClient({
      loadList: (cursor) => get<AiConversationListResponse>(`${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
      loadMessages: (id, cursor) => get<AiConversationMessagesResponse>(`${base}/${encodeURIComponent(id)}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
      changed: (value) => setSnapshot({ tripId, value }),
    });
    historyClient.current = client;
    return () => {
      client.dispose();
      if (historyClient.current === client) historyClient.current = null;
    };
  }, [tripId, request]);

  useEffect(() => {
    if (history.accessDenied && !authorizationLostNotified.current) {
      authorizationLostNotified.current = true;
      onAuthorizationLost?.();
    }
  }, [history.accessDenied, onAuthorizationLost]);

  useEffect(() => {
    const timer = window.setTimeout(() => void historyClient.current?.refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshToken, tripId, request]);

  useEffect(() => {
    if (!history.listLoading && !history.listError) activeConversationChanged?.(history.activeConversationId);
  }, [activeConversationChanged, history.activeConversationId, history.listLoading, history.listError]);

  useEffect(() => {
    const node = transcript.current;
    if (!node || history.olderLoading) return;
    const anchor = olderScroll.current;
    if (anchor && anchor.conversationId === history.selectedConversationId) {
      node.scrollTop = anchor.top + node.scrollHeight - anchor.height;
      olderScroll.current = null;
    } else if (nearBottom.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [history.messages, history.selectedConversationId, history.olderLoading]);

  const select = (id: string) => {
    nearBottom.current = true;
    olderScroll.current = null;
    setActionError(false);
    void historyClient.current?.select(id);
    // The list sits under the chat: bring the chat into view to read the conversation.
    window.requestAnimationFrame(() => chatSection.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  };
  const loadOlder = () => {
    const node = transcript.current;
    if (node && history.selectedConversationId) olderScroll.current = {
      conversationId: history.selectedConversationId, height: node.scrollHeight, top: node.scrollTop,
    };
    void historyClient.current?.loadOlderMessages();
  };
  const changeConversation = async (id?: string) => {
    if (!canChangeConversation) return;
    if (id && history.conversation?.purpose === "preferences") return;
    const client = historyClient.current;
    setActionBusy(true);
    setActionError(false);
    try {
      const changed = id ? await props.resumeConversation(id) : await props.newConversation();
      if (changed === false) return;
      if (historyClient.current !== client) return;
      nearBottom.current = true;
      olderScroll.current = null;
      await client?.refresh(true);
    } catch (error) {
      if (historyClient.current === client && !client?.handleAuthorizationFailure(error)) setActionError(true);
    } finally { if (historyClient.current === client) setActionBusy(false); }
  };

  return <section className="ai-conversation-page ai-tab" aria-label={messages.title}>
    {props.sections}
    <AiSection id="conversation" title={tabCopy.conversationsSection} open={open} onOpenChange={setOpen}
      summary={history.conversations.length ? String(history.conversations.length) + (history.listCursor ? "+" : "") : undefined}>
      <div className="ai-tab-chat" ref={chatSection}>
        <div className="ai-history-actions ai-chat-actions"><button data-feedback-action="ai_new" type="button" className="ghost-button" disabled={!canChangeConversation} onClick={() => void changeConversation()}><Plus size={16} />{messages.newConversation}</button></div>
        <div className="ai-history-main">
          <div className="ai-history-conversation-heading"><div><h3>{history.conversation?.title || (selectedActive ? messages.currentConversation : messages.selectConversation)}</h3>
            {archived ? <span className="ai-purpose-badge">{instructionsCopy.archived}</span> : null}</div>
            <button type="button" className="ghost-button" onClick={() => { nearBottom.current = true; transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown size={15} />{messages.latestMessages}</button></div>
          <div className="ai-history-transcript" ref={transcript} tabIndex={0} aria-label={messages.title}
            onScroll={(event) => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
            {history.messageCursor ? <button type="button" className="ghost-button ai-history-older" disabled={history.olderLoading || history.messageLoading} onClick={loadOlder}><ChevronLeft size={15} />{messages.loadOlder}</button> : null}
            {history.messageLoading || history.olderLoading ? <p className="ai-history-feedback" role="status">{messages.loading}</p> : null}
            {history.messageError ? <div className="ai-history-feedback" role="status"><p>{messages.loadFailed}</p><button type="button" className="ghost-button" onClick={() => void historyClient.current?.retryMessages()}><RefreshCw size={15} />{messages.retry}</button></div> : null}
            <AiConversationTranscript turns={history.messages} locale={locale} timeZone={timeZone} messages={messages} tripId={tripId} isOwner={props.isOwner} />
            {!history.messages.length && !history.messageLoading && !history.messageError ? <p className="ai-history-feedback">{history.selectedConversationId ? messages.emptyMessages : messages.selectConversation}</p> : null}
          </div>
          {recovery.phase !== "idle" ? <p className="ai-history-feedback" role="status">{messages.busyNotice}</p> : null}
          {actionError ? <p className="ai-history-feedback" role="status">{messages.loadFailed}</p> : null}
          {!history.accessDenied && !history.listLoading && !history.listError ? archived
            ? <p className="ai-history-feedback">{instructionsCopy.archivedNotice}</p>
            : selectedActive || !history.activeConversationId && !history.selectedConversationId
            ? <fieldset className="ai-history-composer" disabled={actionBusy || history.messageLoading} aria-busy={actionBusy}>{props.renderComposer(history.activeConversationId, history.conversation?.purpose ?? "trip")}</fieldset>
            : history.conversation ? <div className="ai-history-continue"><p>{messages.continueNotice}</p>
              {history.conversation.canResume && history.conversation.purpose !== "preferences" ? <button data-feedback-action="ai_resume" type="button" className="primary-button fit-button" disabled={!canChangeConversation} onClick={() => void changeConversation(history.conversation!.conversationId)}>{messages.continueConversation}</button> : null}</div>
              : null : null}
          {props.chatFooter}
        </div>
      </div>
      <div className="ai-conversation-section" aria-label={messages.conversations}>
        <p className="muted-copy">{messages.privateNotice}</p>
        {history.listError ? <div className="ai-history-feedback" role="status"><p>{messages.loadFailed}</p>
          {!history.accessDenied ? <button type="button" className="ghost-button" onClick={() => void historyClient.current?.refresh()}>{messages.retry}</button> : null}</div> : null}
        {!history.conversations.length && !history.listLoading && !history.listError ? <p>{messages.emptyConversations}</p> : null}
        <AiConversationList conversations={history.conversations} selectedId={history.selectedConversationId} locale={locale} timeZone={timeZone} messages={messages} select={select} />
        {history.listLoading ? <p className="ai-history-feedback" role="status">{messages.loading}</p> : null}
        {history.listCursor ? <button type="button" className="ghost-button ai-history-more" disabled={history.listLoading} onClick={() => void historyClient.current?.loadMoreConversations()}>{messages.loadMoreConversations}</button> : null}
      </div>
    </AiSection>
  </section>;
}
