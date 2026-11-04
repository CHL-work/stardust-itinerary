import type { MemberRemovalInput, MemberRemovalPreview } from "@/lib/app/member-removal";

export type MemberRole = "owner" | "editor" | "viewer";
export type RemovalChoices = Record<string, { replacementPayerMemberId?: string; shareRecipientMemberId?: string }>;
export type PaymentRemovalChoices = Record<string, { replacementAccountingFromMemberId?: string; replacementAccountingToMemberId?: string }>;

export function canChooseMemberRole(member: { status: string; identityBound: boolean }, role: MemberRole): boolean {
  return member.status !== "removed" && (role !== "owner" || (member.status === "active" && member.identityBound));
}

// Exact choices only: never infer a payer, erase a share, or accept a stale extra row.
export function buildMemberRemovalInput(preview: MemberRemovalPreview, choices: RemovalChoices, confirmed: boolean, paymentChoices: PaymentRemovalChoices = {}): MemberRemovalInput | null {
  if (!confirmed || (!preview.canRemove && !preview.canRemoveWithReassignment)
    || preview.blockedReason === "last_bound_owner" || preview.hiddenPrivateExpenseCount > 0) return null;
  const expenseIds = new Set(preview.expenses.map((expense) => expense.id));
  if (Object.keys(choices).some((id) => !expenseIds.has(id))) return null;
  const expenseReassignments: NonNullable<MemberRemovalInput["expenseReassignments"]> = [];
  for (const expense of preview.expenses) {
    const choice = choices[expense.id] ?? {};
    const eligible = new Set(expense.eligibleMembers.map((member) => member.id));
    if (expense.requiresPayerReplacement && !eligible.has(choice.replacementPayerMemberId ?? "")) return null;
    if (expense.requiresShareRecipient && !eligible.has(choice.shareRecipientMemberId ?? "")) return null;
    expenseReassignments.push({
      expenseId: expense.id, expectedRevision: expense.revision,
      ...(expense.requiresPayerReplacement ? { replacementPayerMemberId: choice.replacementPayerMemberId } : {}),
      ...(expense.requiresShareRecipient ? { shareRecipientMemberId: choice.shareRecipientMemberId } : {}),
    });
  }
  const payments = preview.payments ?? [];
  const paymentIds = new Set(payments.map((payment) => payment.id));
  if (Object.keys(paymentChoices).some((id) => !paymentIds.has(id))) return null;
  const paymentReassignments: NonNullable<MemberRemovalInput["paymentReassignments"]> = [];
  for (const payment of payments) {
    const choice = paymentChoices[payment.id] ?? {};
    const eligible = new Set(payment.eligibleMembers.map((member) => member.id));
    if (payment.requiresFromReplacement ? !eligible.has(choice.replacementAccountingFromMemberId ?? "") : choice.replacementAccountingFromMemberId !== undefined) return null;
    if (payment.requiresToReplacement ? !eligible.has(choice.replacementAccountingToMemberId ?? "") : choice.replacementAccountingToMemberId !== undefined) return null;
    paymentReassignments.push({ paymentId: payment.id, expectedRevision: payment.revision,
      ...(payment.requiresFromReplacement ? { replacementAccountingFromMemberId: choice.replacementAccountingFromMemberId } : {}),
      ...(payment.requiresToReplacement ? { replacementAccountingToMemberId: choice.replacementAccountingToMemberId } : {}) });
  }
  return { confirmation: true, expectedRevision: preview.member.revision, previewDigest: preview.previewDigest,
    ...(expenseReassignments.length ? { expenseReassignments } : {}),
    ...(paymentReassignments.length ? { paymentReassignments } : {}) };
}
