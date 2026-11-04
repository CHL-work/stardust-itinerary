import { describe, expect, it } from "vitest";

import { allocationTotal, areExpenseSplitsEqual, resolveExpenseSplits, splitExpenseEqually } from "./expenses";

describe("splitExpenseEqually", () => {
  it("allocates remainder minor units deterministically", () => {
    const allocations = splitExpenseEqually(1_000, ["jotaro", "kakyoin", "polnareff"]);

    expect(allocations).toEqual([
      { participantId: "jotaro", amountMinor: 334 },
      { participantId: "kakyoin", amountMinor: 333 },
      { participantId: "polnareff", amountMinor: 333 },
    ]);
    expect(allocationTotal(allocations)).toBe(1_000);
  });

  it("rejects duplicate participants", () => {
    expect(() => splitExpenseEqually(500, ["jotaro", "jotaro"])).toThrow(
      /unique/,
    );
  });
});

describe("exact expense allocations", () => {
  const ids = ["alice", "bob", "carol"];
  it("defaults to existing equal splitting with deterministic remainder units", () => {
    expect(resolveExpenseSplits(1000, ids)).toEqual(splitExpenseEqually(1000, ids));
  });
  it("matches custom amounts by member identity, including explicit zero", () => {
    const amounts = [{ memberId: "bob", amountMinor: 250 }, { memberId: "carol", amountMinor: 0 }, { memberId: "alice", amountMinor: 750 }];
    expect(resolveExpenseSplits(1000, ids, amounts)).toEqual([
      { participantId: "alice", amountMinor: 750 }, { participantId: "bob", amountMinor: 250 }, { participantId: "carol", amountMinor: 0 },
    ]);
    expect(amounts[0]!.memberId).toBe("bob");
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid custom minor units: %s", (amountMinor) => {
    expect(() => resolveExpenseSplits(100, ["a"], [{ memberId: "a", amountMinor }])).toThrow();
  });
  it.each([
    [], [{ memberId: "a", amountMinor: 100 }],
    [{ memberId: "a", amountMinor: 50 }, { memberId: "a", amountMinor: 50 }],
    [{ memberId: "a", amountMinor: 50 }, { memberId: "hidden", amountMinor: 50 }],
    [{ memberId: "a", amountMinor: 20 }, { memberId: "b", amountMinor: 30 }],
    [{ memberId: "a", amountMinor: 90 }, { memberId: "b", amountMinor: 20 }],
    [{ memberId: "a", amountMinor: 0 }, { memberId: "b", amountMinor: 0 }],
  ].map((shares) => ({ shares })))("rejects a mismatched set or unreconciled sum: $shares", ({ shares }) => {
    expect(() => resolveExpenseSplits(100, ["a", "b"], shares)).toThrow();
  });
  it("cannot accept a rounded overflowing sum but supports the exact maximum", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(resolveExpenseSplits(maximum, ["a", "b"], [{ memberId: "a", amountMinor: maximum - 1 }, { memberId: "b", amountMinor: 1 }]))
      .toEqual([{ participantId: "a", amountMinor: maximum - 1 }, { participantId: "b", amountMinor: 1 }]);
    expect(() => resolveExpenseSplits(maximum, ["a", "b"], [{ memberId: "a", amountMinor: maximum }, { memberId: "b", amountMinor: 1 }])).toThrow();
  });
  it("keeps total and participant guards for custom as well as equal", () => {
    expect(() => resolveExpenseSplits(0, ["a"], [{ memberId: "a", amountMinor: 0 }])).toThrow();
    expect(() => resolveExpenseSplits(100, ["a", "a"], [{ memberId: "a", amountMinor: 100 }, { memberId: "a", amountMinor: 0 }])).toThrow();
  });
  it.each([
    [10, [4, 3, 3], true], [10, [3, 4, 3], true], [2, [0, 1, 1], true], [9, [3, 3, 3], true],
    [10, [6, 4, 0], false], [10, [3, 3, 3], false], [10, [4, 4, 3], false], [10, [4.5, 3, 2.5], false],
  ] as const)("classifies saved allocations without assuming remainder recipient order (%s/%j)", (total, shares, expected) => {
    expect(areExpenseSplitsEqual(total, shares.map((amountMinor, i) => ({ participantId: ids[i]!, amountMinor })))).toBe(expected);
  });
  it("does not classify malformed saved shares as equal", () => {
    expect(areExpenseSplitsEqual(0, [])).toBe(false);
    expect(areExpenseSplitsEqual(2, [{ participantId: "a", amountMinor: 1 }, { participantId: "a", amountMinor: 1 }])).toBe(false);
    expect(areExpenseSplitsEqual(2, [{ participantId: "a", amountMinor: -1 }, { participantId: "b", amountMinor: 3 }])).toBe(false);
  });
});
