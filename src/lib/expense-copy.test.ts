import { describe, expect, it } from "vitest";
import { expenseSummaryCopy } from "./expense-copy";
import { locales } from "./i18n";

describe("personal expense explanation copy", () => {
  it.each(locales)("provides complete nonempty metric labels, hints and calculation help in %s", (locale) => {
    const copy = expenseSummaryCopy(locale);
    expect(Object.keys(copy)).toEqual(Object.keys(expenseSummaryCopy("en")));
    for (const value of Object.values(copy)) expect(value.trim().length).toBeGreaterThan(0);
    expect(new Set([copy.myShare, copy.paid, copy.receive, copy.owe, copy.balanced]).size).toBe(5);
    for (const field of ["myShareHelp", "paidHelp", "balanceHelp"] as const) expect(copy[field].length).toBeGreaterThan(40);
    expect(copy.myShareHelp).not.toBe(copy.paidHelp);
  });
  it("keeps both Cantonese modes identical and neutral for financial explanations", () => {
    expect(expenseSummaryCopy("zh-HK-lihkg")).toEqual(expenseSummaryCopy("zh-HK"));
    const copy = expenseSummaryCopy("zh-HK");
    expect(copy.myShare).toBe("我的個人總開支");
    expect(copy.paid).toBe("我已支付的帳單總額");
    expect(copy.myShareHelp).toContain("不是你目前尚欠的款項");
    expect(copy.paidHelp).toContain("還款不計在此");
    expect(copy.balanceHelp).toContain("＋ 已付還款 − 已收還款");
  });
  it("explains the visible recorded ledger, not a complete bank or hidden-private total", () => {
    const copy = expenseSummaryCopy("en");
    expect(copy.scope).toContain("all dates");
    expect(copy.myShareHelp).toContain("private, shared and standalone");
    expect(copy.myShareHelp).toContain("even when someone else paid");
    expect(copy.paidHelp).toContain("full amount");
    expect(copy.paidHelp).toContain("your own portion was zero");
    expect(copy.paidHelp).toContain("not a bank-verified cash total");
    expect(copy.myShareHelp).toContain("expenses you can view");
    expect(copy.myShareHelp).toContain("Pending, draft and void expenses");
    expect(copy.myShareHelp).toContain("without an expense record");
    expect(copy.myShareHelp).toContain("without conversion");
  });
  it.each(locales)("keeps notes off the figures and the remaining notes to one short line in %s (JOB-075)", (locale) => {
    const copy = expenseSummaryCopy(locale) as Record<string, string>;
    expect(Object.keys(copy).filter((key) => /Hint$/u.test(key) && key !== "settlementHint")).toEqual([]);
    expect(copy).not.toHaveProperty("excluded");
    expect(copy).not.toHaveProperty("recordedOnly");
    // Chinese and Japanese are about half as long as English; the other added languages a little longer (JOB-084).
    const limit = locale === "en" ? 60 : /^(?:zh|ja)/u.test(locale) ? 30 : 75;
    for (const field of ["settlementHint", "ownerScope"]) expect(copy[field].length).toBeLessThan(limit);
  });
  it("moves the balance note into the balance help in every language (JOB-075)", () => {
    expect(expenseSummaryCopy("en").balanceHelp).toMatch(/^This is the balance left after posted member repayments, not your total spending\. Balance = /u);
    expect(expenseSummaryCopy("zh-HK").balanceHelp).toContain("不是你的總開支。結餘＝");
    expect(expenseSummaryCopy("ja-JP").balanceHelp).toContain("自分の費用総額ではありません。残高＝");
  });
  it("keeps the same positive/negative balance directions in every language", () => {
    const en = expenseSummaryCopy("en");
    expect(en.balanceHelp).toContain("− your own expenses + posted repayments sent − posted repayments received");
    expect(en.balanceHelp).toContain("positive balance is still owed to you");
    const zh = expenseSummaryCopy("zh-HK");
    expect(zh.balanceHelp).toContain("正數代表你尚應收回，負數代表你仍須支付");
    const ja = expenseSummaryCopy("ja-JP");
    expect(ja.balanceHelp).toContain("＋ 支払済み精算 − 受取済み精算");
    expect(ja.balanceHelp).toContain("プラスはこれから受け取る額、マイナスはこれから支払う額");
  });
});
