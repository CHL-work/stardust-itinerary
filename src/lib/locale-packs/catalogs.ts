import { dayMapTimeUnits } from "@/components/day-event-map-presentation";
import { adminCopy } from "@/lib/admin/i18n";
import { aiHistoryMessages } from "@/lib/ai/history-i18n";
import { aiImageMessages } from "@/lib/ai/image-i18n";
import { aiInstructionsMessages } from "@/lib/ai/instructions-i18n";
import { aiKeysMessages } from "@/lib/ai/keys-i18n";
import { offTopicReplies } from "@/lib/ai/off-topic";
import { detachedPlanningClarification } from "@/lib/ai/planning-draft-context";
import { aiProviderFailureCopy } from "@/lib/ai/provider-failure-presentation";
import { researchCompletionCopy } from "@/lib/ai/research-completion";
import { reservationClarificationMessages, reservationExpenseReviewNotice } from "@/lib/ai/reservation-assumptions";
import { venueHoursMessages, venueHoursUnverifiedMessages } from "@/lib/ai/venue-hours";
import { activityMessages } from "@/lib/app/activity-i18n";
import { advancedSettingsMessages } from "@/lib/app/advanced-settings-i18n";
import { approvalMessages } from "@/lib/app/approval-i18n";
import { createTripCopy } from "@/lib/app/create-trip-i18n";
import { eventEditorMessages } from "@/lib/app/event-editor-i18n";
import { expensePageMessages } from "@/lib/app/expense-page-i18n";
import { expenseSplitMessages } from "@/lib/app/expense-split-i18n";
import { flightMessages } from "@/lib/app/flight-i18n";
import { guestDemoTitles } from "@/lib/app/guest";
import { guestMessages } from "@/lib/app/guest-i18n";
import { infoTipLabel } from "@/lib/app/info-tip-i18n";
import { memberManagementMessages } from "@/lib/app/member-management-i18n";
import { memberPaymentMessages } from "@/lib/app/member-payment-i18n";
import { mobileCardsMessages } from "@/lib/app/mobile-cards-i18n";
import { commonTimeZoneLabels } from "@/lib/app/trip-creation-options";
import { tripDeletionMessages } from "@/lib/app/trip-deletion-i18n";
import { uiRefreshMessages } from "@/lib/app/ui-refresh-i18n";
import { calendarImportMessages } from "@/lib/calendar/import-i18n";
import { expenseSummaryCopy } from "@/lib/expense-copy";
import { englishFeedbackActionNames, englishFeedbackEnvironmentNames, feedbackCopy } from "@/lib/feedback/i18n";
import { feedbackOperationsCopy } from "@/lib/feedback/operations-i18n";
import { getMessages } from "@/lib/i18n";
import { dayMapMessages } from "@/lib/maps/i18n";

/**
 * Every locale pack section, with the English catalog it translates (JOB-084, D-096). Each value is the very
 * object the code passes to `localizedCatalog` or `packSection`, so a pack is checked against what the app
 * reads. The locale pack tests fail when code reads a section missing here.
 */
export const packCatalogs: Record<string, unknown> = {
  messages: getMessages("en"),
  activity: activityMessages("en"),
  admin: adminCopy("en"),
  advancedSettings: advancedSettingsMessages("en"),
  aiHistory: aiHistoryMessages("en"),
  aiImage: aiImageMessages("en"),
  aiInstructions: aiInstructionsMessages("en"),
  aiKeys: aiKeysMessages("en"),
  aiProviderFailure: aiProviderFailureCopy("en"),
  approval: approvalMessages("en"),
  calendarImport: calendarImportMessages("en"),
  createTrip: createTripCopy("en"),
  dayMap: dayMapMessages("en"),
  dayMapUnits: dayMapTimeUnits.en,
  eventEditor: eventEditorMessages("en"),
  expense: expenseSummaryCopy("en"),
  expensePage: expensePageMessages("en"),
  expenseSplit: expenseSplitMessages("en"),
  feedback: feedbackCopy.en,
  feedbackActions: englishFeedbackActionNames,
  feedbackEnvironment: englishFeedbackEnvironmentNames,
  feedbackOperations: feedbackOperationsCopy("en"),
  flight: flightMessages("en"),
  guest: guestMessages("en"),
  guestDemo: guestDemoTitles.en,
  infoTip: { more: infoTipLabel("en") },
  memberManagement: memberManagementMessages("en"),
  memberPayment: memberPaymentMessages("en"),
  mobileCards: mobileCardsMessages("en"),
  offTopic: offTopicReplies("en"),
  planningDraft: { detached: detachedPlanningClarification("en") },
  researchCompletion: researchCompletionCopy.en,
  reservationClarification: reservationClarificationMessages.en,
  reservationReview: { notice: reservationExpenseReviewNotice("en") },
  tripDeletion: tripDeletionMessages("en"),
  tripTimeZones: commonTimeZoneLabels.en,
  uiRefresh: uiRefreshMessages("en"),
  venueHours: venueHoursMessages.en,
  venueHoursUnverified: venueHoursUnverifiedMessages.en,
};
