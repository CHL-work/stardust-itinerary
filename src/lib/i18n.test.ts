import { describe, expect, it } from "vitest";

import { formatMessage, locales, messages, restrictedToneKeys } from "./i18n";

describe("LIHKG localization boundaries", () => {
  it("keeps restricted money, auth-adjacent, and safety copy clear", () => {
    for (const key of restrictedToneKeys) {
      expect(messages["zh-HK-lihkg"][key]).toBe(messages["zh-HK"][key]);
    }
  });

  it("uses the sharper tone only for eligible casual surfaces", () => {
    expect(messages["zh-HK-lihkg"].today).not.toBe(messages["zh-HK"].today);
    expect(messages["zh-HK-lihkg"].notification).toContain("遲到唔好賴人");
    expect(messages["zh-HK-lihkg"].appName).toBe("星塵遠征軍");
    expect(messages["zh-HK-lihkg"].aiThinking).toBe("AI 諗緊計，咪催…");
    expect(messages["zh-HK-lihkg"].aiPlanApplied).not.toBe(messages["zh-HK"].aiPlanApplied);
  });

  it("formats localized AI quota messages without sentence fragments", () => {
    expect(formatMessage(messages.en.aiMemberQuota, { remaining: 7, limit: 20 }))
      .toBe("gpt-6.1-sol · 7/20 prompts left this UTC day");
    expect(formatMessage(messages["zh-HK"].aiMemberRemaining, { remaining: 7 }))
      .toBe("本 UTC 日尚餘 7 次提問");
    expect(formatMessage(messages["ja-JP"].aiModelChanged, { model: "gpt-6.1-sol" }))
      .toBe("オーナーのAIモデルをgpt-6.1-solに変更しました。");
  });

  it("keeps conversational-memory privacy and reset copy explicit and neutral", () => {
    expect(messages.en.aiMemoryNotice).toContain("token-budgeted recent tail");
    expect(messages.en.aiMemoryNotice).toContain("versioned conversation summary");
    expect(messages.en.aiMemoryNotice).toContain("trip owner can still view logged prompts and replies");
    expect(messages.en.newAiConversationDescription).toContain("clear the unsent message");
    expect(messages.en.newAiConversationDescription).toContain("read or continue it later");
    expect(messages.en.newAiConversationDescription).toContain("Audit records are kept");
    expect(formatMessage(messages["zh-HK"].aiMemoryUsage, {
      count: 3,
      tokens: 900,
      budget: 6000,
    })).toBe("此回覆使用：3 次最近對話 · 約 900/6000 tokens。");
    expect(messages.en.aiMemoryNotice).toContain("does not automatically save preferences");

    for (const key of [
      "aiMemoryNotice",
      "aiMemoryUsage",
      "aiMemoryTruncated",
      "newAiConversation",
      "newAiConversationTitle",
      "newAiConversationDescription",
      "confirmNewAiConversation",
      "aiConversationReset",
      "aiConversationResetFailed",
    ] as const) {
      expect(messages["zh-HK-lihkg"][key]).toBe(messages["zh-HK"][key]);
    }
  });
});

describe("trip, event, and Calendar localization", () => {
  const cantoneseUiKeys = [
    "stayForDay",
    "noHotelListed",
    "eventStatusPlanned",
    "eventStatusCancelled",
    "eventTypeActivity",
    "eventTypeMeal",
    "eventTypeTransport",
    "eventTypeLodging",
    "eventTypeNote",
    "addPlanItem",
    "editPlanItem",
    "editEvent",
    "cancelEvent",
    "restoreEvent",
    "privateEvent",
    "ownerLock",
    "eventTitleField",
    "eventTypeField",
    "eventDurationMinutesField",
    "eventMapUrlField",
    "eventNotesField",
    "eventAudienceField",
    "saveEventNow",
    "requestOwnerApproval",
    "enableMemberAccess",
    "disableMemberAccess",
    "disableMemberTitle",
    "disableMemberWarning",
    "disableMemberConfirm",
    "memberGoogleEmail",
    "aiResearchSources",
    "pendingEvents",
    "pendingOwnerApproval",
    "pendingEventRequestedBy",
    "pendingEventNotConfirmed",
    "editPendingEvent",
    "loadingPendingEvent",
    "savePendingChanges",
    "pendingEventUpdated",
    "pendingEventLoadFailed",
    "pendingEventUpdateFailed",
    "approvePendingEvent",
    "rejectPendingEvent",
    "approvalRequestsNav",
    "approvalQueueLabel",
    "approvalQueueTitle",
    "approveRequest",
    "rejectRequest",
    "reapproveRejectedRequest",
    "requestStatusPending",
    "requestStatusRejected",
    "requestStatusApproved",
    "requestStatusSuperseded",
    "requestReviewedAt",
    "noApprovalHistory",
    "noConfirmedEventsForDay",
    "timeNotSet",
    "addToCalendar",
    "updateCalendar",
    "refreshCalendar",
    "loadingCalendar",
    "calendarOpeningEvent",
    "calendarOpeningHint",
  ] as const;

  it("provides Cantonese copy for the visible trip, event, and Calendar controls", () => {
    for (const key of cantoneseUiKeys) {
      expect(messages["zh-HK"][key], key).not.toBe(messages.en[key]);
      expect(messages["zh-HK"][key], key).toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it("keeps venue and traveler names unchanged when interpolating Cantonese copy", () => {
    expect(formatMessage(messages["zh-HK"].openEventInGoogleMaps, { title: "スシロー 新宿三丁目店" }))
      .toBe("在 Google 地圖開啟「スシロー 新宿三丁目店」");
    expect(formatMessage(messages["zh-HK"].sharedByCreator, { name: "Paco" }))
      .toBe("由 Paco 分享");
    expect(formatMessage(messages["zh-HK"].disableMemberWarning, { name: "Paco" }))
      .toContain("Paco");
    expect(formatMessage(messages["zh-HK"].pendingEventRequestedBy, { name: "Paco" }))
      .toBe("Paco 提出");
    expect(formatMessage(messages["zh-HK"].memberGoogleEmail, { email: "member@example.com" }))
      .toBe("Google 帳戶 · member@example.com");
  });

  it("keeps pending events visibly distinct from confirmed itinerary events", () => {
    expect(messages.en.pendingEventNotConfirmed).toContain("not confirmed");
    expect(messages["zh-HK"].pendingEventNotConfirmed).toContain("獲批後");
    expect(messages["zh-HK-lihkg"].pendingEventNotConfirmed)
      .toBe(messages["zh-HK"].pendingEventNotConfirmed);
    expect(messages["zh-HK-lihkg"].noConfirmedEventsForDay)
      .toBe(messages["zh-HK"].noConfirmedEventsForDay);
    expect(messages["ja-JP"].pendingEventNotConfirmed).toContain("確定した旅程");
  });

  it("keeps approval and rejection controls explicit in every locale", () => {
    for (const locale of ["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const) {
      expect(messages[locale].editPendingEvent).not.toBe(messages[locale].approvePendingEvent);
      expect(messages[locale].savePendingChanges).not.toBe(messages[locale].approvePendingEvent);
      expect(messages[locale].pendingEventUpdated).not.toBe(messages[locale].pendingEventUpdateFailed);
      expect(messages[locale].approveRequest).not.toBe(messages[locale].rejectRequest);
      expect(messages[locale].reapproveRejectedRequest).not.toBe(messages[locale].rejectRequest);
      expect(messages[locale].requestStatusApproved).not.toBe(messages[locale].requestStatusRejected);
    }
  });

  it("tells owners that their own AI-created events still require approval", () => {
    expect(messages.en.aiOwnerPolicy).toContain("even when the owner asks");
    expect(messages["zh-HK"].aiOwnerPolicy).toContain("包括由管理員提出");
    expect(messages["ja-JP"].aiOwnerPolicy).toContain("オーナー自身の依頼でも");
  });

  it("localizes AI batch approval counts and validation guidance", () => {
    expect(formatMessage(messages.en.aiApprovalBatchCreated, { count: 4 }))
      .toBe("4 change requests were created and are waiting for owner approval.");
    expect(formatMessage(messages["zh-HK"].aiApprovalBatchCreated, { count: 4 }))
      .toBe("已建立 4 個變更審批請求，正等待管理員審批。");
    expect(formatMessage(messages["ja-JP"].aiApprovalBatchCreated, { count: 4 }))
      .toContain("4件");
    expect(messages["zh-HK"].aiInvalidProposal).toContain("未有新增任何項目");
    expect(messages["zh-HK"].aiInvalidProposal).toContain("分帳成員");
    expect(messages["ja-JP"].aiInvalidProposal).toContain("何も追加されていません");
    expect(messages["ja-JP"].aiInvalidProposal).toContain("分担メンバー");
    expect(messages["zh-HK-lihkg"].aiApprovalBatchCreated)
      .toBe(messages["zh-HK"].aiApprovalBatchCreated);
    expect(messages["zh-HK-lihkg"].aiInvalidProposal)
      .toBe(messages["zh-HK"].aiInvalidProposal);
  });

  it("keeps AI progress and failure feedback in the selected language", () => {
    expect(messages.en.aiThinking).toBe("AI is thinking…");
    expect(messages["zh-HK"].aiThinking).toBe("AI 正在思考…");
    expect(messages["ja-JP"].aiThinking).toBe("AIが考えています…");
    expect(messages["zh-HK"].aiRequestFailed).not.toBe(messages.en.aiRequestFailed);
    expect(messages["ja-JP"].aiRequestFailed).not.toBe(messages.en.aiRequestFailed);
  });

  it("explains Calendar recovery and same-tab loading in clear Cantonese", () => {
    expect(messages["zh-HK"].calendarRecreated).toContain("重新加入");
    expect(messages["zh-HK-lihkg"].calendarRecreated).toBe(messages["zh-HK"].calendarRecreated);
    expect(messages["zh-HK"].calendarOpeningHint).toContain("返回按鈕");
    expect(messages.en.calendarOpeningHint).not.toContain("keep using Stardust");
  });

  it("separates Google sign-in from Calendar and explains Google's unverified-app warning", () => {
    expect(messages.en.calendarConnectionPersonal).toContain("separate");
    expect(messages.en.calendarTestingNotice).toContain("Advanced");
    expect(messages["zh-HK"].calendarConnectionPersonal).toContain("獨立連結");
    expect(messages["zh-HK"].calendarTestingNotice).toContain("進階");
    expect(messages["ja-JP"].calendarTestingNotice).toContain("詳細");
    // Since 2026-11-04 the OAuth app is in production: nobody needs to be added as a test user.
    for (const locale of ["en", "zh-HK", "ja-JP"] as const) {
      for (const key of ["calendarTestingNotice", "calendarConnectionFailed"] as const) {
        expect(messages[locale][key]).not.toMatch(/test[- ]user|測試使用者|テストユーザー/u);
      }
    }
    expect(messages["zh-HK-lihkg"].calendarTestingNotice)
      .toBe(messages["zh-HK"].calendarTestingNotice);
  });

  it("localizes owner trip creation and switching in every supported language", () => {
    const keys = [
      "switchTripTitle",
      "createNewTrip",
    ] as const;
    for (const key of keys) {
      expect(messages["zh-HK"][key], key).not.toBe(messages.en[key]);
      expect(messages["ja-JP"][key], key).not.toBe(messages.en[key]);
      expect(messages["zh-HK-lihkg"][key], key).toBe(messages["zh-HK"][key]);
    }
  });

  it("localizes both-bound date confirmation and privacy-safe conflicts with neutral wording", () => {
    for (const locale of locales) {
      const formatted = formatMessage(messages[locale].confirmTripDateChange, {
        previousStart: "2030-04-01", previousEnd: "2030-04-05", nextStart: "2030-03-31", nextEnd: "2030-04-06",
      });
      for (const date of ["2030-04-01", "2030-04-05", "2030-03-31", "2030-04-06"]) expect(formatted).toContain(date);
      expect(formatted).not.toContain("{previous");
    }
    for (const key of ["tripDatesHint", "confirmTripDateChange", "tripSettingsInvalidDates", "tripSettingsDatesOccupied", "tripSettingsDatesStale", "tripSettingsSaving"] as const) {
      expect(messages["zh-HK"][key]).not.toBe(messages.en[key]);
      expect(messages["ja-JP"][key]).not.toBe(messages.en[key]);
      expect(messages["zh-HK-lihkg"][key]).toBe(messages["zh-HK"][key]);
    }
  });
});
