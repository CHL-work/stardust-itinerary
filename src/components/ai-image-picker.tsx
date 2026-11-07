"use client";

import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { ImagePlus, X } from "lucide-react";
import { createAiImageDraft, type AiImageDraftState } from "@/lib/ai/image-client";
import { aiImageMessages } from "@/lib/ai/image-i18n";
import { AI_IMAGE_MAX_COUNT } from "@/lib/ai/image-types";
import type { Locale } from "@/lib/i18n";
import "./ai-image-picker.css";

export function useAiImageDraft(scope: string | null) {
  const draft = useMemo(() => {
    // Identity is the memoization key; no old trip/member can inherit this draft.
    void scope;
    return createAiImageDraft();
  }, [scope]);
  useEffect(() => { draft.activate(); return () => draft.dispose(); }, [draft]);
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  return { ...state, add: draft.add, remove: draft.remove, clear: draft.clear };
}

export type AiImagePickerProps = AiImageDraftState & {
  locale: Locale;
  disabled: boolean;
  /** Text-only funding lanes can remove a retained draft, but cannot add or submit pictures. */
  textOnly?: boolean;
  add: (files: File[]) => Promise<void>;
  remove: (id: string) => void;
};

export function AiImagePicker({ locale, disabled, textOnly = false, images, preparing, error, add, remove }: AiImagePickerProps) {
  const copy = aiImageMessages(locale);
  const input = useRef<HTMLInputElement | null>(null);
  const noticeId = useId();
  return <div className="ai-image-picker" aria-busy={preparing}>
    <button type="button" className="ghost-button" disabled={disabled || textOnly || preparing || images.length >= AI_IMAGE_MAX_COUNT}
      aria-describedby={textOnly ? undefined : noticeId} onClick={() => input.current?.click()}><ImagePlus size={17} />{copy.add}<span>{images.length}/{AI_IMAGE_MAX_COUNT}</span></button>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label={copy.add}
      disabled={disabled || textOnly || preparing} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (!disabled && !textOnly) void add(files); }} />
    {images.length ? <div className="ai-image-previews">{images.map((image, index) => <div className="ai-image-preview" key={image.id}>
      {/* A memory-only blob must not pass through a public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.previewUrl} alt={`${copy.preview} ${index + 1}`} width={image.width} height={image.height} />
      <button type="button" disabled={disabled || preparing} onClick={() => remove(image.id)} aria-label={`${copy.remove} ${index + 1}`}><X size={17} /></button>
    </div>)}</div> : null}
    {preparing ? <p role="status" aria-live="polite">{copy.preparing}</p> : null}
    {error ? <p role="alert" className="ai-image-error">{copy[error]}</p> : null}
    {!textOnly ? <p id={noticeId} className="ai-image-safety">{copy.safety}</p> : null}
  </div>;
}
