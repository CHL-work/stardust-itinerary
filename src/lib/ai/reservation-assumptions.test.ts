import { describe, expect, it } from "vitest";

import {
  assessReservationExpense,
  reservationExpenseClarification,
  reservationExpenseReviewNotice,
  type ReservationExpenseDirectoryMember,
} from "@/lib/ai/reservation-assumptions";

const actorId = "10000000-0000-4000-8000-000000000001";
const pacoId = "10000000-0000-4000-8000-000000000002";
const guestId = "10000000-0000-4000-8000-000000000005";
const directory: ReservationExpenseDirectoryMember[] = [
  { id: actorId, displayName: "Owner", status: "active" },
  { id: pacoId, displayName: "Paco", status: "invited" },
  { id: guestId, displayName: "Guest", status: "active" },
];

describe("reservation expense assumption guard", () => {
  it("still checks private participants when payment prose is reviewable", () => {
    expect(assessReservationExpense("Create my hotel.", actorId, directory, {
      payerMemberId: actorId, splitMemberIds: [actorId, pacoId], viewerMemberIds: [pacoId],
    }, { requirePayerEvidence: false })).toBe("participant_not_explicit");
    expect(assessReservationExpense("Create my private hotel shared with Paco.", actorId, directory, {
      payerMemberId: actorId, splitMemberIds: [actorId, pacoId], viewerMemberIds: [pacoId],
    }, { requirePayerEvidence: false })).toBeNull();
  });

  it.each(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const)("has a financial review notice in %s", (locale) => {
    expect(reservationExpenseReviewNotice(locale).length).toBeGreaterThan(20);
    expect(reservationExpenseReviewNotice("zh-HK-lihkg")).toBe(reservationExpenseReviewNotice("zh-HK"));
  });
  it.each([
    "I paid for the hotel; split it with Paco.",
    "The hotel was paid by me and shared with Paco.",
    "私が支払ったホテル代をPacoと分けます。",
    "酒店錢我俾咗，Paco 一齊分。",
    "酒店費用由我付款，Paco 一齊分。",
    "酒店由我找數，Paco 一齊分。",
    "酒店我找数，Paco 一齐分。",
    "我已經找數，Paco 一齊分。",
  ])("accepts an explicitly stated actor payer and named companion: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, directory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBeNull();
  });

  it.each([
    "Paco paid for the hotel; split it with me.",
    "The hotel was paid by Paco and split with me.",
    "Pacoさんがホテル料金を支払った。私と分担します。",
    "Paco 付款，費用同我一齊分。",
    "Paco 找數，費用同我一齊分。",
    "由 Paco 找数，費用同我一齊分。",
  ])("accepts another payer only when an exact name has nearby payment evidence: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, directory, {
      payerMemberId: pacoId,
      splitMemberIds: [actorId, pacoId],
    })).toBeNull();
  });

  it("does not treat a receipt guest name, payment method, or total as payer proof", () => {
    const receipt = [
      "Paco 様",
      "ご利用人数 2名様",
      "ご予約料金 ¥9,800",
      "お支払方法 現地でお支払い",
    ].join("\n");

    expect(assessReservationExpense(receipt, actorId, directory, {
      payerMemberId: pacoId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("payer_not_explicit");
  });

  const namedActorDirectory: ReservationExpenseDirectoryMember[] = [
    { id: actorId, displayName: "DDB", status: "active" },
    directory[1]!,
  ];

  it.each([
    "DDB 找數，同 Paco 分。",
    "DDB 找数，同 Paco 分。",
    "由 DDB 找數，同 Paco 分。",
    "ＤＤＢ 已經找數，同 Paco 分。",
    "ddb paid for the hotel; split with Paco.",
    "The hotel was paid by DDB, split with Paco.",
  ])("accepts the actor's exact unambiguous display name as payer: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, namedActorDirectory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBeNull();
  });

  it("accepts a bare unique member name only when the caller proves it answers a payer question", () => {
    const proposed = {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    };
    expect(assessReservationExpense("Share the room with Paco.\nDDB", actorId,
      namedActorDirectory, proposed)).toBe("payer_not_explicit");
    expect(assessReservationExpense("Share the room with Paco.\nDDB", actorId,
      namedActorDirectory, proposed, { exactPayerAnswer: "DDB" })).toBeNull();
    expect(assessReservationExpense("Share the room with Paco.\nDDB", actorId, [
      ...namedActorDirectory,
      { id: guestId, displayName: "ＤＤＢ", status: "invited" },
    ], proposed, { exactPayerAnswer: "DDB" })).toBe("member_name_ambiguous");
    expect(assessReservationExpense("Share the room with Paco.\nDDB", actorId,
      namedActorDirectory, proposed, { exactPayerAnswer: "Paco" })).toBe("payer_not_explicit");
  });

  it.each([
    "DDB 冇找數，同 Paco 分。",
    "DDB 唔會找数，同 Paco 分。",
    "唔係 DDB 找數，同 Paco 分。",
    "唔係由 DDB 找數，同 Paco 分。",
    "如果 DDB 找數，同 Paco 分。",
    "假如由 DDB 找数，同 Paco 分。",
    "如果係由 DDB 找數，同 Paco 分。",
    "係咪 DDB 找數，同 Paco 分？",
    "DDB has not paid; split with Paco.",
    "If paid by DDB, split with Paco.",
    "DDB is the room guest. Payment total ¥9,800. Share with Paco.",
  ])("does not guess an actor payer from negative, hypothetical, or missing evidence: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, namedActorDirectory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("payer_not_explicit");
  });

  it.each([
    "The hotel was paid by DDB-test; share with Paco.",
    "The hotel was paid by DDB_test; share with Paco.",
    "The hotel was paid by DDB‑test; share with Paco.",
    "DDB-test 找數，同 Paco 分。",
  ])("does not mistake a longer hyphenated or underscored name for the actor: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, namedActorDirectory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("payer_not_explicit");
  });

  it("accepts the exact longer name as a third-party payer without confusing the actor", () => {
    expect(assessReservationExpense("DDB-test 找數，同 DDB 分。", actorId, [
      ...namedActorDirectory,
      { id: guestId, displayName: "DDB-test", status: "active" },
    ], {
      payerMemberId: guestId,
      splitMemberIds: [actorId, guestId],
    })).toBeNull();
  });

  it("rejects an actor display-name collision but allows identity-explicit first person", () => {
    const ambiguousDirectory: ReservationExpenseDirectoryMember[] = [
      ...namedActorDirectory,
      { id: guestId, displayName: "ＤＤＢ", status: "invited" },
    ];
    expect(assessReservationExpense("DDB 找數，同 Paco 分。", actorId, ambiguousDirectory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("member_name_ambiguous");
    expect(assessReservationExpense("我找數，同 Paco 分。", actorId, ambiguousDirectory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBeNull();
  });

  it.each([
    "The hotel was not paid by me; split it with Paco.",
    "I have not paid for the hotel; split it with Paco.",
    "If I paid for the hotel, split it with Paco.",
    "They asked, \"if I paid for the hotel, would I split it with Paco?\"",
    "もし私が支払った場合はPacoと分けます。",
    "唔係由我付款，費用同 Paco 分。",
    "不是由我付款，費用同 Paco 分。",
    "唔係我找數，費用同 Paco 分。",
    "我冇找數，費用同 Paco 分。",
    "我唔會找数，費用同 Paco 分。",
    "如果我找數，費用同 Paco 分。",
    "假如由我找数，費用同 Paco 分。",
    "如果係由我找數，費用同 Paco 分。",
  ])("does not treat negated or hypothetical self-payment as proof: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, directory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("payer_not_explicit");
  });

  it.each([
    "The hotel was not paid by Paco; split it with Paco and me.",
    "Paco has not paid for the hotel; split it with Paco and me.",
    "If Paco paid for the hotel, split it with Paco and me.",
    "Pacoさんはホテル料金を支払っていない。私と分担します。",
    "唔係由 Paco 付款，費用同 Paco 分。",
    "不是由 Paco 付款，費用同 Paco 分。",
    "Paco 冇找數，費用同 Paco 分。",
    "Paco 唔會找数，費用同 Paco 分。",
    "唔係由 Paco 找數，費用同 Paco 分。",
    "如果 Paco 找數，費用同 Paco 分。",
    "假如由 Paco 找数，費用同 Paco 分。",
  ])("does not treat negated or hypothetical named payment as proof: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, directory, {
      payerMemberId: pacoId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("payer_not_explicit");
  });

  it.each([
    "The hotel was not paid by Guest; split it with Guest and me.",
    "Guest has not paid for the hotel; split it with Guest and me.",
  ])("rejects the explicit Guest negation fixture: %s", (prompt) => {
    expect(assessReservationExpense(prompt, actorId, directory, {
      payerMemberId: guestId,
      splitMemberIds: [actorId, guestId],
    })).toBe("payer_not_explicit");
  });

  it("accepts an even split between every eligible member as the default when nobody is named (JOB-080)", () => {
    const everyone = [actorId, pacoId, guestId];
    expect(assessReservationExpense("I paid ¥12,000 for dinner.", actorId, directory, {
      payerMemberId: actorId, splitMemberIds: everyone,
    })).toBeNull();
    expect(assessReservationExpense("Dinner was ¥12,000.", actorId, directory, {
      payerMemberId: actorId, splitMemberIds: everyone,
    })).toBe("payer_not_explicit");

    const otherGuestId = "10000000-0000-4000-8000-000000000006";
    const duplicateNames = [...directory, { id: otherGuestId, displayName: "Ｇｕｅｓｔ", status: "active" as const }];
    expect(assessReservationExpense("I paid for dinner.", actorId, duplicateNames, {
      payerMemberId: actorId, splitMemberIds: [...everyone, otherGuestId],
    })).toBeNull();
    expect(assessReservationExpense("Guest paid for dinner.", actorId, duplicateNames, {
      payerMemberId: guestId, splitMemberIds: [...everyone, otherGuestId],
    })).toBe("member_name_ambiguous");

    expect(assessReservationExpense("I paid for dinner; Paco did not come.", actorId, directory, {
      payerMemberId: actorId, splitMemberIds: [actorId, guestId],
    })).toBe("participant_not_explicit");
    expect(assessReservationExpense("I paid for the private dinner.", actorId, directory, {
      payerMemberId: actorId, splitMemberIds: everyone, viewerMemberIds: [pacoId, guestId],
    })).toBe("participant_not_explicit");
  });

  it("requires every proposed non-actor participant to appear in the current request", () => {
    expect(assessReservationExpense("I paid for the room.", actorId, directory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("participant_not_explicit");
  });

  it("requires every selected private viewer to appear in the current request", () => {
    expect(assessReservationExpense("I paid for the room and split it with Paco.", actorId, directory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
      viewerMemberIds: [pacoId, guestId],
    })).toBe("participant_not_explicit");

    expect(assessReservationExpense(
      "I paid for the room, split it with Paco, and also share the private event with Guest.",
      actorId,
      directory,
      {
        payerMemberId: actorId,
        splitMemberIds: [actorId, pacoId],
        viewerMemberIds: [pacoId, guestId],
      },
    )).toBeNull();
  });

  it("matches a named invited companion after exact NFKC normalization", () => {
    const fullWidthDirectory: ReservationExpenseDirectoryMember[] = [
      directory[0]!,
      { id: pacoId, displayName: "Ｐａｃｏ", status: "invited" },
    ];

    expect(assessReservationExpense("I paid; split with Paco.", actorId, fullWidthDirectory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
    })).toBeNull();
  });

  it("does not resolve a member name as a substring of another name", () => {
    const annId = "10000000-0000-4000-8000-000000000003";
    // A third member keeps the split narrower than everyone, which is the unnamed default (JOB-080).
    expect(assessReservationExpense("I paid; split with Anna.", actorId, [
      directory[0]!,
      { id: annId, displayName: "Ann", status: "active" },
      directory[2]!,
    ], {
      payerMemberId: actorId,
      splitMemberIds: [actorId, annId],
    })).toBe("participant_not_explicit");
  });

  it("fails closed when duplicate normalized names cannot identify one member", () => {
    const otherPacoId = "10000000-0000-4000-8000-000000000004";
    expect(assessReservationExpense("Paco paid; split with Paco and me.", actorId, [
      ...directory,
      { id: otherPacoId, displayName: "Ｐａｃｏ", status: "active" },
    ], {
      payerMemberId: pacoId,
      splitMemberIds: [actorId, pacoId],
    })).toBe("member_name_ambiguous");
  });

  it("fails closed when a selected private viewer has a duplicate normalized name", () => {
    const otherGuestId = "10000000-0000-4000-8000-000000000006";
    expect(assessReservationExpense("I paid; split with Paco and share with Guest.", actorId, [
      ...directory,
      { id: otherGuestId, displayName: "Ｇｕｅｓｔ", status: "invited" },
    ], {
      payerMemberId: actorId,
      splitMemberIds: [actorId, pacoId],
      viewerMemberIds: [guestId],
    })).toBe("member_name_ambiguous");
  });

  it("rejects a proposed member outside the eligible directory", () => {
    expect(assessReservationExpense("I paid; split with Unknown.", actorId, directory, {
      payerMemberId: actorId,
      splitMemberIds: [actorId, "10000000-0000-4000-8000-000000000099"],
    })).toBe("member_unavailable");
  });

  it("requires a payer and at least one explicit split member", () => {
    expect(assessReservationExpense("Hotel reservation total: ¥9,800.", actorId, directory, {
      payerMemberId: null,
      splitMemberIds: [],
    })).toBe("payer_not_explicit");
    expect(assessReservationExpense("I paid for the hotel.", actorId, directory, {
      payerMemberId: actorId,
      splitMemberIds: [],
    })).toBe("participant_not_explicit");
  });

  it.each(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const)(
    "asks only for missing detail without requesting the entire booking again in %s", (locale) => {
    for (const reason of [
      "payer_not_explicit",
      "member_name_ambiguous",
      "participant_not_explicit",
      "member_unavailable",
    ] as const) {
      const message = reservationExpenseClarification(reason, locale);
      expect(message.length).toBeGreaterThan(10);
      expect(message.length).toBeLessThan(180);
      expect(message).not.toMatch(/resend|full booking|重新提交|完整預訂|予約内容全体|再送/iu);
    }
  });

  it("keeps each clarification specific to its missing detail and neutral in both Cantonese tones", () => {
    expect(reservationExpenseClarification("payer_not_explicit", "en")).toContain("paid or will pay");
    expect(reservationExpenseClarification("payer_not_explicit", "en")).not.toContain("share");
    expect(reservationExpenseClarification("participant_not_explicit", "en")).toContain("share");
    expect(reservationExpenseClarification("member_name_ambiguous", "en")).toContain("that name");
    expect(reservationExpenseClarification("member_unavailable", "en")).toContain("active or invited");
    for (const reason of [
      "payer_not_explicit", "member_name_ambiguous", "participant_not_explicit", "member_unavailable",
    ] as const) {
      expect(reservationExpenseClarification(reason, "zh-HK-lihkg"))
        .toBe(reservationExpenseClarification(reason, "zh-HK"));
    }
  });
});
