"use client";

import { useEffect, useRef } from "react";
import type { EventEditorMessages } from "@/lib/app/event-editor-i18n";

export function EventEditorFeedback({ error }: { error: string | null }) {
  const target = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) target.current?.focus(); }, [error]);
  return error ? <p ref={target} className="full-field private-expense-note" role="alert" tabIndex={-1}>{error}</p> : null;
}

export function EventExpenseParticipants({ members, allMembers, payerMemberId, splitMemberIds, disabled,
  payerLabel, splitsLabel, copy, changePayer, changeSplits }: {
  members: readonly { id: string; displayName: string }[];
  allMembers: readonly { id: string; displayName: string }[];
  payerMemberId: string;
  splitMemberIds: string[];
  disabled: boolean;
  payerLabel: string;
  splitsLabel: string;
  copy: EventEditorMessages;
  changePayer: (id: string) => void;
  changeSplits: (ids: string[]) => void;
}) {
  const allowed = new Set(members.map((member) => member.id));
  const unavailableSplits = [...new Set(splitMemberIds.filter((id) => !allowed.has(id)))];
  const unavailableName = (id: string) => {
    const name = allMembers.find((member) => member.id === id)?.displayName;
    return name ? `${name} — ${copy.unavailable}` : copy.unavailable;
  };
  return <>
    <label>{payerLabel}<select required disabled={disabled} value={payerMemberId} onChange={(event) => changePayer(event.target.value)}>
      <option value="" disabled>{copy.choosePayer}</option>
      {payerMemberId && !allowed.has(payerMemberId) ? <option value={payerMemberId} disabled>{unavailableName(payerMemberId)}</option> : null}
      {members.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}
    </select></label>
    <fieldset className="split-field full-field" disabled={disabled}><legend>{splitsLabel}</legend><div className="split-options">
      {members.map((member) => <label className="check-field" key={member.id}><input type="checkbox"
        checked={splitMemberIds.includes(member.id)} onChange={(event) => changeSplits(event.target.checked
          ? [...new Set([...splitMemberIds, member.id])] : splitMemberIds.filter((id) => id !== member.id))} />{member.displayName}</label>)}
      {unavailableSplits.map((id) => <label className="check-field" key={id}><input type="checkbox" checked
        onChange={() => changeSplits(splitMemberIds.filter((memberId) => memberId !== id))} />{unavailableName(id)}</label>)}
    </div></fieldset>
    {!members.length || !allowed.has(payerMemberId) || unavailableSplits.length || !splitMemberIds.length
      ? <p className="full-field private-expense-note" role="status">{members.length ? copy.participants : copy.noMembers}</p> : null}
  </>;
}
