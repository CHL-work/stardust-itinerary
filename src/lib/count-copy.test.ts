import { describe, expect, it } from "vitest";

import { aiKeysMessages } from "@/lib/ai/keys-i18n";
import { advancedSettingsMessages } from "@/lib/app/advanced-settings-i18n";
import { expensePageMessages } from "@/lib/app/expense-page-i18n";
import { memberManagementMessages } from "@/lib/app/member-management-i18n";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { countLabel, getMessages, locales, type Locale } from "@/lib/i18n";

/** Catalogs whose counts have a singular form (JOB-077). */
const catalogs: Record<string, (locale: Locale) => Record<string, string>> = {
  messages: getMessages,
  expensePage: expensePageMessages,
  memberPayment: memberPaymentMessages,
  advancedSettings: advancedSettingsMessages,
  memberManagement: memberManagementMessages,
  aiKeys: aiKeysMessages,
};

const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map((match) => match[1]).sort();

/** The plural beside a singular key: `xOne` pairs with `xMany`, or with `x` itself. */
function pluralKey(copy: Record<string, string>, one: string): string | undefined {
  const base = one.slice(0, -"One".length);
  return [`${base}Many`, base].find((key) => key in copy);
}

describe("counts in the singular and plural (JOB-077)", () => {
  it.each(Object.keys(catalogs))("pairs every singular count in %s with its plural and the same placeholders", (name) => {
    for (const locale of locales) {
      const copy = catalogs[name]!(locale);
      for (const one of Object.keys(copy).filter((key) => key.endsWith("One"))) {
        const many = pluralKey(copy, one);
        expect(many, `${name}.${one}`).toBeDefined();
        expect(placeholders(copy[one]!), `${locale} ${name}.${one}`).toEqual(placeholders(copy[many!]!));
        if (locale === "en") expect(copy[one], `${name}.${one}`).not.toBe(copy[many!]);
      }
      expect(Object.values(copy).filter((text) => text.includes("(s)")), `${locale} ${name}`).toEqual([]);
    }
  });

  it("says one of each in the singular in English", () => {
    const messages = getMessages("en");
    const expense = expensePageMessages("en");
    const payment = memberPaymentMessages("en");
    const advanced = advancedSettingsMessages("en");
    const members = memberManagementMessages("en");
    const keys = aiKeysMessages("en");
    expect(countLabel(1, expense.countOne, expense.count)).toBe("1 expense");
    expect(countLabel(1, messages.pendingExpenseCountOne, messages.pendingExpenseCountMany)).toBe("1 pending expense");
    expect(countLabel(1, payment.dayCountOne, payment.dayCount)).toBe("1 repayment");
    expect(countLabel(1, payment.historyCountOne, payment.historyCount, { pending: 0 })).toBe("1 record · 0 awaiting approval");
    expect(countLabel(1, advanced.outputTokensOne, advanced.outputTokens)).toBe("1 output token");
    expect(countLabel(1, advanced.recentEntriesOne, advanced.recentEntries)).toBe("1 recent log entry");
    expect(countLabel(1, members.hiddenExpensesOne, members.hiddenExpenses)).toBe("1 private expense you cannot see must be settled first. Ask someone involved.");
    expect(countLabel(1, messages.tripCapacityHintOne, messages.tripCapacityHint)).toBe("1 place currently reserved · product maximum 20");
    expect(countLabel(1, messages.aiMemberRemainingOne, messages.aiMemberRemaining, { remaining: 1 })).toBe("1 prompt remaining this UTC day");
    expect(countLabel(1, messages.aiLimitChangedOne, messages.aiLimitChanged, { limit: 1 })).toBe("Member AI limit changed to 1 prompt per UTC day.");
    expect(countLabel(1, messages.aiMemberAccessDescriptionOne, messages.aiMemberAccessDescription, { limit: 1 }))
      .toBe("Member access is fixed to gpt-6.1-sol and 1 prompt per UTC day.");
    expect(countLabel(1, keys.sharedAccessOne, keys.sharedAccess, { owner: "Ada", model: "synthetic-model", limit: 1 }))
      .toBe("Runs on Ada's key with synthetic-model, up to 1 prompt a day.");
  });

  it("uses the plural for zero and for more than one, and keeps a formatted number", () => {
    const expense = expensePageMessages("en");
    const advanced = advancedSettingsMessages("en");
    expect(countLabel(0, expense.countOne, expense.count)).toBe("0 expenses");
    expect(countLabel(2, expense.countOne, expense.count)).toBe("2 expenses");
    expect(countLabel(12345, advanced.outputTokensOne, advanced.outputTokens, { count: (12345).toLocaleString("en") })).toBe("12,345 output tokens");
  });
});
