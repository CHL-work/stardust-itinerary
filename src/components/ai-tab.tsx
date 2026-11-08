"use client";

import { useCallback, useState } from "react";

import { AiConversationPage, type AiConversationPageProps } from "@/components/ai-conversation-page";
import { AiInstructionsSettings } from "@/components/ai-instructions-settings";
import type { AiInstructionsRequest } from "@/components/ai-instructions-state";
import { AiKeysSettings } from "@/components/ai-keys-settings";
import { AiRoutineSection, ChatEffortSelect, useAiPreferences } from "@/components/ai-routine-section";
import { AiSection, useAiSectionOpen } from "@/components/ai-section";
import { AiUsageSection } from "@/components/ai-usage-section";
import { aiTabMessages } from "@/lib/ai/ai-tab-i18n";

type Request = <T>(url: string, init?: RequestInit) => Promise<T>;

/**
 * The AI tab (JOB-093, JOB-094): Chat, then Usage, Routine checks, API keys and AI instructions, then past
 * Conversations at the bottom. Every section collapses and remembers its state in this browser.
 */
export function AiTab(props: Omit<AiConversationPageProps, "chatFooter" | "sections"> & {
  /** Remounts the key and instruction editors before another identity can see their state. */
  editorScope: string;
  keysChanged: () => void;
  instructionsDirtyChanged: (dirty: boolean) => void;
}) {
  const { tripId, locale, request, editorScope, keysChanged, instructionsDirtyChanged } = props;
  const copy = aiTabMessages(locale);
  const [keysVersion, setKeysVersion] = useState(0);
  const preferences = useAiPreferences(tripId, request as Request, keysVersion);
  const [keysOpen, setKeysOpen] = useAiSectionOpen("keys", false);
  const [instructionsOpen, setInstructionsOpen] = useAiSectionOpen("instructions", false);
  const changed = useCallback(() => { setKeysVersion((version) => version + 1); keysChanged(); }, [keysChanged]);
  const { save: savePreferences } = preferences;
  const save = useCallback((patch: Parameters<typeof savePreferences>[0]) => { void savePreferences(patch); }, [savePreferences]);
  return <AiConversationPage {...props}
    chatFooter={<ChatEffortSelect locale={locale} state={preferences.state} save={save} />}
    sections={<>
      <AiUsageSection tripId={tripId} locale={locale} request={request as Request} />
      <AiRoutineSection locale={locale} timeZone={props.timeZone} state={preferences.state} save={save} />
      <AiSection id="keys" title={copy.keysSection} open={keysOpen} onOpenChange={setKeysOpen}
        summary={preferences.state.preferences?.providers.length ? String(preferences.state.preferences.providers.length) : undefined}>
        <AiKeysSettings embedded tripId={tripId} scope={editorScope} locale={locale} request={request as Request} changed={changed} />
      </AiSection>
      <AiSection id="instructions" title={copy.instructionsSection} open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <AiInstructionsSettings embedded tripId={tripId} scope={editorScope} locale={locale} request={request as AiInstructionsRequest}
          onDirtyChange={instructionsDirtyChanged} />
      </AiSection>
    </>} />;
}
