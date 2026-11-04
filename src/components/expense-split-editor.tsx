"use client";

import { useId } from "react";
import type { Locale } from "@/lib/i18n";
import { currencyFactor } from "@/lib/app/expense-currency";
import { changeExpenseSplitMode, expenseSplitPreview, type ExpenseSplitDraft } from "@/lib/app/expense-split-editor";
import { expenseSplitMessages } from "@/lib/app/expense-split-i18n";
import styles from "./expense-split-editor.module.css";

type Draft = ExpenseSplitDraft & { amount: string; currency: string; splitMemberIds: string[] };
function previewMoney(amount: bigint, currency: string, locale: Locale): string {
  const factor = BigInt(currencyFactor(currency));
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / factor;
  const digits = factor === 1n ? 0 : 2;
  const decimal = `${amount < 0n ? "-" : ""}${whole}${digits ? `.${String(absolute % factor).padStart(2, "0")}` : ""}`;
  if (!/^[A-Z]{3}$/.test(currency)) return decimal;
  return new Intl.NumberFormat(locale === "zh-HK-lihkg" ? "zh-HK" : locale, {
    style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).formatToParts(amount < 0n ? (whole ? -whole : -0) : whole)
    .map((part) => part.type === "fraction" ? String(absolute % factor).padStart(2, "0") : part.value).join("");
}

export function ExpenseSplitEditor<T extends Draft>({ draft, members, locale, disabled, change }: {
  draft: T; members: readonly { id: string; displayName: string }[]; locale: Locale; disabled: boolean; change: (draft: T) => void;
}) {
  const copy = expenseSplitMessages(locale);
  const id = useId();
  const preview = expenseSplitPreview(draft);
  const mode = draft.splitMode ?? "equal";
  return <fieldset className={`full-field ${styles.editor}`} disabled={disabled}>
    <legend>{copy.title}</legend>
    <div className={styles.modes} role="group" aria-label={copy.title}>
      {(["equal", "custom"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value}
        onClick={() => change(changeExpenseSplitMode(draft, value))}>{copy[value]}</button>)}
    </div>
    <p className={styles.hint} id={`${id}-hint`}>{mode === "equal" ? copy.equalHint : copy.customHint}</p>
    {mode === "custom" ? <>
      <div className={styles.people}>{draft.splitMemberIds.map((memberId) => <label key={memberId}>
        <span>{members.find((member) => member.id === memberId)?.displayName ?? copy.unavailable}<small>{copy.share} · {draft.currency}</small></span>
        <input required type="text" inputMode="decimal" aria-describedby={`${id}-hint ${id}-summary`}
          value={draft.splitAmountInputs?.[memberId] ?? ""} placeholder="0"
          onChange={(event) => change({ ...draft, splitTouched: true, splitAmountInputs: { ...draft.splitAmountInputs, [memberId]: event.target.value } })} />
      </label>)}</div>
      <div id={`${id}-summary`} className={styles.summary} role="status" aria-live="polite" data-balanced={preview.valid}>
        <span>{copy.assigned}<strong>{previewMoney(preview.assigned, draft.currency, locale)}</strong></span>
        {preview.remaining !== null ? <span>{preview.remaining < 0n ? copy.over : copy.remaining}
          <strong>{previewMoney(preview.remaining < 0n ? -preview.remaining : preview.remaining, draft.currency, locale)}</strong></span> : null}
        <p>{preview.remaining === null ? copy.totalFirst : !preview.complete ? copy.incomplete : preview.valid ? copy.balanced : copy.error}</p>
      </div>
    </> : null}
  </fieldset>;
}
