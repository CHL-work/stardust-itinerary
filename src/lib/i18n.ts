export const locales = ["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const;

export type Locale = (typeof locales)[number];

export type Messages = {
  appName: string;
  demoMode: string;
  tripLabel: string;
  today: string;
  overview: string;
  itinerary: string;
  expenses: string;
  appCost: string;
  settings: string;
  nextUp: string;
  leaveBy: string;
  routeTime: string;
  openMap: string;
  onTrack: string;
  weather: string;
  weatherClear: string;
  weatherPartlyCloudy: string;
  weatherCloudy: string;
  weatherFog: string;
  weatherDrizzle: string;
  weatherRain: string;
  weatherSnow: string;
  weatherThunderstorm: string;
  weatherUnknown: string;
  weatherRainChance: string;
  weatherApproximate: string;
  weatherForecastFor: string;
  weatherAttribution: string;
  weatherStale: string;
  disruptionCancellation: string;
  disruptionClosure: string;
  disruptionDelay: string;
  disruptionTransit: string;
  disruptionRoad: string;
  disruptionWeather: string;
  disruptionHours: string;
  disruptionStrike: string;
  disruptionAccess: string;
  disruptionOther: string;
  openDisruptionDetail: string;
  disruptionDetailTitle: string;
  disruptionTranslationUnavailable: string;
  disruptionOriginalText: string;
  disruptionCheckedAt: string;
  disruptionSources: string;
  disruptionSourceNumber: string;
  disruptionPossibleNotice: string;
  offlineModeTitle: string;
  offlineModeDescription: string;
  offlineSavedAt: string;
  offlinePrivateDeviceNotice: string;
  offlineChooseDay: string;
  offlineDayPosition: string;
  retryLiveApp: string;
  noOfflineEvents: string;
  disruptionNotificationsTitle: string;
  disruptionNotificationsDescription: string;
  enableDisruptionNotifications: string;
  disruptionNotificationsEnabled: string;
  disruptionNotificationsDenied: string;
  disruptionNotificationTitle: string;
  disruptionNotificationBody: string;
  liveOperationsTitle: string;
  liveOperationsDescription: string;
  weatherMonitorLabel: string;
  disruptionMonitorLabel: string;
  monitorNeverSucceeded: string;
  monitorLastSuccess: string;
  monitorLastAttempt: string;
  monitorNextDue: string;
  monitorLastError: string;
  monitorNoError: string;
  monitorStatusSucceeded: string;
  monitorStatusPartial: string;
  monitorStatusFailed: string;
  monitorStatusRunning: string;
  monitorStatusSkipped: string;
  monitorStatusDisabled: string;
  tripDay: string;
  askAi: string;
  aiPlannerLabel: string;
  aiPlaceholder: string;
  aiUnavailable: string;
  aiThinking: string;
  aiResearchSources: string;
  aiMemoryNotice: string;
  aiMemoryUsage: string;
  aiMemoryTruncated: string;
  newAiConversation: string;
  newAiConversationTitle: string;
  newAiConversationDescription: string;
  confirmNewAiConversation: string;
  aiConversationReset: string;
  aiConversationResetFailed: string;
  sendAiPrompt: string;
  aiMemberQuota: string;
  aiOwnerPolicy: string;
  aiMemberPolicy: string;
  aiPlanApplied: string;
  aiApprovalCreated: string;
  aiApprovalBatchCreated: string;
  aiInvalidProposal: string;
  aiSearchEvidenceMissing: string;
  pendingEvents: string;
  pendingEventCountOne: string;
  pendingEventCountMany: string;
  pendingOwnerApproval: string;
  pendingEventUpdate: string;
  pendingEventRequestedBy: string;
  pendingEventNotConfirmed: string;
  pendingEventUpdateNotApplied: string;
  editPendingEvent: string;
  loadingPendingEvent: string;
  savePendingChanges: string;
  pendingEventUpdated: string;
  pendingEventLoadFailed: string;
  pendingEventUpdateFailed: string;
  pendingExpenses: string;
  pendingExpenseNotIncluded: string;
  approvePendingEvent: string;
  rejectPendingEvent: string;
  approvalRequestsNav: string;
  approvalQueueLabel: string;
  approvalQueueTitle: string;
  approveRequest: string;
  rejectRequest: string;
  reapproveRejectedRequest: string;
  requestStatusPending: string;
  requestStatusRejected: string;
  requestStatusApproved: string;
  requestStatusSuperseded: string;
  requestReviewedAt: string;
  noApprovalHistory: string;
  approvalHistoryLoading: string;
  approvalHistoryLoadingMore: string;
  approvalHistoryLoadFailed: string;
  loadMoreApprovalHistory: string;
  retryApprovalHistory: string;
  refreshApprovalHistory: string;
  requestApprovedNotice: string;
  requestRejectedNotice: string;
  requestReviewFailed: string;
  requestReviewStale: string;
  aiRequestFailed: string;
  aiSessionExpired: string;
  aiRequestDenied: string;
  aiConversationBusy: string;
  aiConversationChanged: string;
  aiRestoringRequest: string;
  aiProcessingInBackground: string;
  aiReconnectingRequest: string;
  aiBusyInAnotherTrip: string;
  aiRequestTimedOut: string;
  aiRequestInterrupted: string;
  aiServiceUnavailable: string;
  aiNetworkFailed: string;
  aiPromptInvalid: string;
  aiAccess: string;
  aiOwnerAccessDescription: string;
  aiMemberAccessDescription: string;
  aiOwnerDefaultModel: string;
  aiMemberPromptsPerDay: string;
  saveAiLimit: string;
  aiOwnerSummary: string;
  aiMemberRemaining: string;
  aiLimitInvalid: string;
  aiLimitChanged: string;
  aiLimitChangeFailed: string;
  aiModelChanged: string;
  aiModelChangeFailed: string;
  costThisTrip: string;
  llmCalls: string;
  hosting: string;
  estimated: string;
  members: string;
  editPlan: string;
  addExpense: string;
  notification: string;
  allPlans: string;
  previousDay: string;
  nextDay: string;
  currentDay: string;
  eventsForDay: string;
  noEventsForDay: string;
  noConfirmedEventsForDay: string;
  plannedFor: string;
  startsIn: string;
  noUpcomingEvent: string;
  swipeDay: string;
  timeNotSet: string;
  calendarAdded: string;
  calendarUpdated: string;
  calendarRecreated: string;
  calendarBulkSynced: string;
  calendarLinkReady: string;
  viewCalendarEvent: string;
  viewCalendar: string;
  dismiss: string;
  dayNumber: string;
  liveItemCountOne: string;
  liveItemCountMany: string;
  eventCountOne: string;
  eventCountMany: string;
  noEvents: string;
  stayForDay: string;
  hotelCountOne: string;
  hotelCountMany: string;
  noHotelListed: string;
  addLodgingHint: string;
  openGoogleMaps: string;
  openEventInGoogleMaps: string;
  eventStatusPlanned: string;
  eventStatusCancelled: string;
  eventTypeActivity: string;
  eventTypeMeal: string;
  eventTypeTransport: string;
  eventTypeLodging: string;
  eventTypeNote: string;
  addPlanItem: string;
  editPlanItem: string;
  editEvent: string;
  cancelEvent: string;
  restoreEvent: string;
  privateEvent: string;
  sharedByCreator: string;
  ownerLock: string;
  ownerLockDescription: string;
  eventTitleField: string;
  eventTypeField: string;
  eventStartsField: string;
  eventDurationMinutesField: string;
  eventEndsField: string;
  eventMapUrlField: string;
  eventMapUrlHint: string;
  transportDepartureTimeField: string;
  transportArrivalTimeField: string;
  transportRouteFields: string;
  transportEndpointHint: string;
  transportEndpointRequired: string;
  departureLocationField: string;
  departureMapUrlField: string;
  destinationLocationField: string;
  destinationMapUrlField: string;
  departureLabel: string;
  destinationLabel: string;
  locationNotSet: string;
  openLocationInGoogleMaps: string;
  eventNotesField: string;
  eventAudienceField: string;
  privateEventDescription: string;
  privateEventOwnerRequired: string;
  privateEventCreatorOnly: string;
  eventExpense: string;
  optionalCollapsed: string;
  alreadyLinked: string;
  addLinkedExpense: string;
  expenseChangesUnavailable: string;
  expenseDescriptionField: string;
  expenseAmountField: string;
  expenseCurrencyField: string;
  expensePaidByField: string;
  expenseWhenField: string;
  expenseSharedByField: string;
  eventExpenseAtomicNotice: string;
  saveEventAndExpense: string;
  saveEventNow: string;
  requestOwnerApproval: string;
  cancelButton: string;
  enableMemberAccess: string;
  disableMemberAccess: string;
  disableMemberTitle: string;
  disableMemberCloseLabel: string;
  disableMemberWarning: string;
  disableMemberIdentityLinked: string;
  disableMemberConfirm: string;
  memberGoogleEmail: string;
  planAndExpenseSaved: string;
  planSaved: string;
  planChangeRequested: string;
  eventCancelled: string;
  eventRestored: string;
  eventActionRequested: string;
  planSaveFailed: string;
  planUpdateFailed: string;
  startDateOutsideTrip: string;
  durationMinimum: string;
  calendarOptional: string;
  calendarSelectedDay: string;
  calendarTripDates: string;
  calendarConnectWhenNeeded: string;
  calendarAccessUnavailable: string;
  calendarConnectDescription: string;
  calendarAccessDisabledDescription: string;
  addAllToCalendar: string;
  addOrUpdateAllCalendar: string;
  refreshCalendar: string;
  googleCalendar: string;
  calendarEventCountOne: string;
  calendarEventCountMany: string;
  possibleCalendarConflictOne: string;
  possibleCalendarConflictMany: string;
  calendarOverlaps: string;
  noCalendarConflicts: string;
  checkingCalendarConflicts: string;
  calendarLinked: string;
  calendarOnly: string;
  openCalendarEntry: string;
  loadingCalendar: string;
  noCalendarEventsDay: string;
  noCalendarEventsTrip: string;
  calendarMoreEvents: string;
  addToCalendar: string;
  updateCalendar: string;
  calendarSyncing: string;
  calendarOpeningEvent: string;
  calendarOpeningHint: string;
  allowCalendarAccess: string;
  calendarConsentIntro: string;
  calendarConsentConnect: string;
  calendarConsentSingle: string;
  calendarConsentAll: string;
  calendarConsentConflicts: string;
  calendarConsentCancel: string;
  calendarTestingNotice: string;
  calendarConnectedStatus: string;
  calendarNotConnectedStatus: string;
  calendarConnectionPersonal: string;
  linkGoogleCalendar: string;
  notNow: string;
  continueWithGoogle: string;
  calendarConnectedFinishing: string;
  calendarConnectedReady: string;
  calendarConnectionFailed: string;
  calendarAccessDisabledNotice: string;
  calendarChooseEventNotice: string;
  calendarSyncFailed: string;
  enableCalendarApi: string;
  switchTripTitle: string;
  switchTripDescription: string;
  currentTripField: string;
  createNewTrip: string;
  travelDestinationField: string;
  timeZoneField: string;
  startDateField: string;
  endDateField: string;
  maximumMembersField: string;
  ownerTripContextLabel: string;
  ownerTripContextTitle: string;
  ownerTripContextDescription: string;
  tripDatesHint: string;
  confirmTripDateChange: string;
  tripSettingsInvalidDates: string;
  tripSettingsDatesOccupied: string;
  tripSettingsDatesStale: string;
  tripSettingsSaving: string;
  tripCapacityHint: string;
  saveTripSettings: string;
  tripSettingsSaved: string;
  tripSettingsSaveFailed: string;
  tripSettingsInvalidMembers: string;
  refreshAfterChangeFailed: string;
};

const en: Messages = {
  appName: "Stardust Itinerary",
  demoMode: "Demo mode · changes are not saved",
  tripLabel: "Current expedition",
  today: "Today",
  overview: "Overview",
  itinerary: "Itinerary",
  expenses: "Trip expenses",
  appCost: "App cost",
  settings: "Settings",
  nextUp: "Next up",
  leaveBy: "Leave by",
  routeTime: "35 min route + 15 min buffer",
  openMap: "Open map",
  onTrack: "On track",
  weather: "22°C · light rain later",
  weatherClear: "Clear",
  weatherPartlyCloudy: "Partly cloudy",
  weatherCloudy: "Cloudy",
  weatherFog: "Fog",
  weatherDrizzle: "Drizzle",
  weatherRain: "Rain",
  weatherSnow: "Snow",
  weatherThunderstorm: "Thunderstorm",
  weatherUnknown: "Forecast unavailable",
  weatherRainChance: "{percent}% precipitation",
  weatherApproximate: "trip-area estimate",
  weatherForecastFor: "Forecast for {date}",
  weatherAttribution: "Weather data by Open-Meteo.com (derived, CC BY 4.0)",
  weatherStale: "last available forecast; refresh pending",
  disruptionCancellation: "Event cancelled",
  disruptionClosure: "Venue closed",
  disruptionDelay: "Service delay",
  disruptionTransit: "Transit issue",
  disruptionRoad: "Road issue",
  disruptionWeather: "Weather risk",
  disruptionHours: "Hours changed",
  disruptionStrike: "Strike impact",
  disruptionAccess: "Access change",
  disruptionOther: "Possible issue",
  openDisruptionDetail: "View possible disruption for {event}",
  disruptionDetailTitle: "Possible trip disruption",
  disruptionTranslationUnavailable: "A translation of this warning is not available yet. Check the original text or linked official source.",
  disruptionOriginalText: "Original warning (not translated)",
  disruptionCheckedAt: "Checked {date}",
  disruptionSources: "Public sources",
  disruptionSourceNumber: "Source {number}",
  disruptionPossibleNotice: "Treat this as an early warning, not a guarantee. Check the linked official source before changing your plans.",
  offlineModeTitle: "Offline itinerary",
  offlineModeDescription: "The live app is unreachable. These are the last trip-wide events saved for every trip day on this device; editing, AI, expenses, Calendar, weather refresh, and disruption checks need a connection.",
  offlineSavedAt: "Saved {date}",
  offlinePrivateDeviceNotice: "Device cache for {name}. Private events are deliberately excluded offline because identity cannot be revalidated. Clear the cache by signing out when you are back online.",
  offlineChooseDay: "Choose an offline trip day",
  offlineDayPosition: "Day {current} of {total}",
  retryLiveApp: "Retry live app",
  noOfflineEvents: "No saved events for this day.",
  disruptionNotificationsTitle: "Disruption alerts",
  disruptionNotificationsDescription: "Show a phone or desktop alert when this open app receives a new sourced disruption. Closed-app push requires a separate push service and is not enabled yet.",
  enableDisruptionNotifications: "Enable notifications",
  disruptionNotificationsEnabled: "Browser notifications are enabled.",
  disruptionNotificationsDenied: "Notifications are blocked in this browser's site settings.",
  disruptionNotificationTitle: "Trip disruption detected",
  disruptionNotificationBody: "{event}: {reason}",
  liveOperationsTitle: "Live trip services",
  liveOperationsDescription: "Owner-only status for weather refreshes and the scheduled disruption worker.",
  weatherMonitorLabel: "Weather refresh",
  disruptionMonitorLabel: "Disruption monitor",
  monitorNeverSucceeded: "No successful run yet",
  monitorLastSuccess: "Last success: {date}",
  monitorLastAttempt: "Last attempt: {date}",
  monitorNextDue: "Next due: {date}",
  monitorLastError: "Last error: {error}",
  monitorNoError: "No current error",
  monitorStatusSucceeded: "Succeeded",
  monitorStatusPartial: "Partly completed",
  monitorStatusFailed: "Failed",
  monitorStatusRunning: "Running",
  monitorStatusSkipped: "No eligible events",
  monitorStatusDisabled: "Disabled",
  tripDay: "Day 3 of 7 · Tokyo",
  askAi: "Ask the trip AI",
  aiPlannerLabel: "TRIP AI",
  aiPlaceholder: "Move lunch later and find somewhere quieter…",
  aiUnavailable: "AI is disabled for this trip.",
  aiThinking: "AI is thinking…",
  aiResearchSources: "Live research sources",
  aiMemoryNotice: "AI uses a token-budgeted recent tail, a versioned conversation summary, and the instructions you explicitly save in Settings. AI does not automatically save preferences from chats. Other members do not receive this context; the trip owner can still view logged prompts and replies.",
  aiMemoryUsage: "Context used: {count} recent turns · about {tokens}/{budget} tokens.",
  aiMemoryTruncated: "Older dialogue was compacted or oversized text was left out.",
  newAiConversation: "New conversation",
  newAiConversationTitle: "Start a new AI conversation?",
  newAiConversationDescription: "Start with fresh AI context and clear the unsent message. Your previous conversation stays in the AI tab, where you can read or continue it later. Audit records are kept.",
  confirmNewAiConversation: "Start new conversation",
  aiConversationReset: "A new AI conversation started. Earlier turns will no longer be sent to AI; audit records were preserved.",
  aiConversationResetFailed: "Unable to start a new AI conversation.",
  sendAiPrompt: "Send prompt",
  aiMemberQuota: "gpt-6.1-sol · {remaining}/{limit} prompts left this UTC day",
  aiOwnerPolicy: "AI-created events always wait for owner approval, even when the owner asks. Validated owner updates, cancellations, and restores are applied and logged. Owners have no application daily prompt cap; provider and account limits still apply.",
  aiMemberPolicy: "AI plan changes enter the shared owner approval queue.",
  aiPlanApplied: "The plan was updated and logged.",
  aiApprovalCreated: "Awaiting owner approval.",
  aiApprovalBatchCreated: "{count} change requests were created and are waiting for owner approval.",
  aiInvalidProposal: "AI returned change details the app could not validate, so nothing was added. For an event, check its date, time, and audience; for an expense, check its amount, currency, payer, and split members, then try again.",
  aiSearchEvidenceMissing: "The AI did not complete the required live search, so nothing was added. Try the search again, or ask it to use only details you provide if no live verification is needed.",
  pendingEvents: "Pending events",
  pendingEventCountOne: "{count} pending event",
  pendingEventCountMany: "{count} pending events",
  pendingOwnerApproval: "Pending owner approval",
  pendingEventUpdate: "Pending changes",
  pendingEventRequestedBy: "Requested by {name}",
  pendingEventNotConfirmed: "This event is awaiting owner approval. It appears as pending and is not confirmed until approved.",
  pendingEventUpdateNotApplied: "This requested change is waiting for owner approval. The confirmed event remains unchanged until approval.",
  editPendingEvent: "Edit pending event",
  loadingPendingEvent: "Loading event…",
  savePendingChanges: "Save pending changes",
  pendingEventUpdated: "Pending event updated. It still needs owner approval.",
  pendingEventLoadFailed: "Unable to load this pending event for editing.",
  pendingEventUpdateFailed: "Unable to update this pending event. It may have changed or already been reviewed; reload and try again.",
  pendingExpenses: "Pending expenses",
  pendingExpenseNotIncluded: "Waiting for owner approval · not included in totals or settlements",
  approvePendingEvent: "Approve and add to itinerary",
  rejectPendingEvent: "Reject pending event",
  approvalRequestsNav: "Approvals ({count})",
  approvalQueueLabel: "OWNER APPROVALS · HISTORY",
  approvalQueueTitle: "Approval requests",
  approveRequest: "Approve request",
  rejectRequest: "Reject request",
  reapproveRejectedRequest: "Approve rejected request",
  requestStatusPending: "Pending",
  requestStatusRejected: "Rejected",
  requestStatusApproved: "Approved",
  requestStatusSuperseded: "Superseded",
  requestReviewedAt: "Reviewed {date}",
  noApprovalHistory: "No approval requests have been recorded.",
  approvalHistoryLoading: "Loading approval history…",
  approvalHistoryLoadingMore: "Loading more…",
  approvalHistoryLoadFailed: "Unable to load approval history.",
  loadMoreApprovalHistory: "Load more",
  retryApprovalHistory: "Try again",
  refreshApprovalHistory: "Refresh",
  requestApprovedNotice: "Request approved, applied, and logged.",
  requestRejectedNotice: "Request rejected and logged.",
  requestReviewFailed: "Unable to review the request.",
  requestReviewStale: "This proposal changed or was already reviewed. Refresh and review the latest version before trying again.",
  aiRequestFailed: "AI request failed. Please try again.",
  aiSessionExpired: "Your sign-in expired. Reload the page, sign in again, then resend your prompt.",
  aiRequestDenied: "This AI request is not allowed for your account or this trip.",
  aiConversationBusy: "AI is already processing another prompt in this conversation. Wait for it to finish, then try again.",
  aiConversationChanged: "The current conversation changed in another tab. Open the AI tab and select the conversation before sending again.",
  aiRestoringRequest: "Checking your last AI request…",
  aiProcessingInBackground: "AI is still working. You can switch apps and return here for the answer.",
  aiReconnectingRequest: "Reconnecting to your AI request… It will not be sent again.",
  aiBusyInAnotherTrip: "Your AI request in another trip is still running. Open that trip to see the answer.",
  aiRequestTimedOut: "The last AI request reached its time limit. Check pending changes before trying again; it was not automatically resent.",
  aiRequestInterrupted: "The last AI request was interrupted. Check pending changes before trying again; it was not automatically resent.",
  aiServiceUnavailable: "The AI service is temporarily unavailable. Wait a moment, then try again; your prompt is still here.",
  aiNetworkFailed: "The AI request could not reach Stardust. Check your connection, then try again; your prompt is still here.",
  aiPromptInvalid: "The prompt could not be sent. Keep it to 8,000 characters or fewer, then try again.",
  aiAccess: "AI access",
  aiOwnerAccessDescription: "Owner access is unlimited. Choose your model and set the shared UTC-day prompt limit for members.",
  aiMemberAccessDescription: "Member access is fixed to gpt-6.1-sol and {limit} prompts per UTC day.",
  aiOwnerDefaultModel: "Owner default model",
  aiMemberPromptsPerDay: "Member prompts per UTC day",
  saveAiLimit: "Save limit",
  aiOwnerSummary: "Owner unlimited · members {limit}/UTC day",
  aiMemberRemaining: "{remaining} prompts remaining this UTC day",
  aiLimitInvalid: "Enter a daily member limit from 1 to 1000.",
  aiLimitChanged: "Member AI limit changed to {limit} prompts per UTC day.",
  aiLimitChangeFailed: "Unable to update the daily AI limit.",
  aiModelChanged: "Owner AI model changed to {model}.",
  aiModelChangeFailed: "Unable to update the model.",
  costThisTrip: "App cost this trip",
  llmCalls: "LLM calls",
  hosting: "Hosting estimate",
  estimated: "Estimated",
  members: "Expedition party",
  editPlan: "Edit plan",
  addExpense: "Add expense",
  notification: "Morning brief sent to Discord",
  allPlans: "View full itinerary",
  previousDay: "Previous day",
  nextDay: "Next day",
  currentDay: "Current day",
  eventsForDay: "events on this day",
  noEventsForDay: "No events planned for this day.",
  noConfirmedEventsForDay: "No confirmed itinerary events for this day yet.",
  plannedFor: "Planned for",
  startsIn: "Starts in",
  noUpcomingEvent: "No upcoming event on this day.",
  swipeDay: "Swipe left or right to change day",
  timeNotSet: "Time not set",
  calendarAdded: "Added to your Google Calendar.",
  calendarUpdated: "Updated in your Google Calendar.",
  calendarRecreated: "The event was missing from Google Calendar, so Stardust added it again.",
  calendarBulkSynced: "{count} events added or updated in your Google Calendar without duplicates.",
  calendarLinkReady: "The Calendar link is ready.",
  viewCalendarEvent: "View event",
  viewCalendar: "View calendar",
  dismiss: "Dismiss",
  dayNumber: "Day {number}",
  liveItemCountOne: "{count} live item",
  liveItemCountMany: "{count} live items",
  eventCountOne: "{count} event",
  eventCountMany: "{count} events",
  noEvents: "No events",
  stayForDay: "Stay for this day",
  hotelCountOne: "{count} hotel",
  hotelCountMany: "{count} hotels",
  noHotelListed: "No hotel listed",
  addLodgingHint: "Add a lodging event to keep the current day's hotel visible here.",
  openGoogleMaps: "Open in Google Maps",
  openEventInGoogleMaps: "Open {title} in Google Maps",
  eventStatusPlanned: "Planned",
  eventStatusCancelled: "Cancelled",
  eventTypeActivity: "Activity",
  eventTypeMeal: "Meal",
  eventTypeTransport: "Transport",
  eventTypeLodging: "Lodging",
  eventTypeNote: "Note",
  addPlanItem: "Add event",
  editPlanItem: "Edit plan item",
  editEvent: "Edit",
  cancelEvent: "Cancel event",
  restoreEvent: "Restore event",
  privateEvent: "Private",
  sharedByCreator: "Shared by {name}",
  ownerLock: "Owner lock",
  ownerLockDescription: "Only the owner can edit, cancel, restore, or unlock this event.",
  eventTitleField: "Title",
  eventTypeField: "Type",
  eventStartsField: "Starts · {timeZone}",
  eventDurationMinutesField: "Duration (minutes)",
  eventEndsField: "Ends · {timeZone}",
  eventMapUrlField: "Exact Google Maps place URL",
  eventMapUrlHint: "Paste the place listing URL, not a city or neighborhood search.",
  transportDepartureTimeField: "Departure time · {timeZone}",
  transportArrivalTimeField: "Arrival time · {timeZone}",
  transportRouteFields: "Transport route",
  transportEndpointHint: "Departure and destination are each optional, but enter at least one location.",
  transportEndpointRequired: "Enter a departure location or destination.",
  departureLocationField: "Departure location (optional)",
  departureMapUrlField: "Departure Google Maps URL (optional)",
  destinationLocationField: "Destination (optional)",
  destinationMapUrlField: "Destination Google Maps URL (optional)",
  departureLabel: "Departure",
  destinationLabel: "Destination",
  locationNotSet: "Location not set",
  openLocationInGoogleMaps: "Open {location} in Google Maps",
  eventNotesField: "Notes",
  eventAudienceField: "Who can see this event",
  privateEventDescription: "Private events are visible only to the creator and the people selected below. Event-linked expenses must use the same audience.",
  privateEventOwnerRequired: "Your permissions require owner approval, so select the owner before submitting this private event.",
  privateEventCreatorOnly: "Private event created by {name}. Only the creator can change who it is shared with.",
  eventExpense: "Expense",
  optionalCollapsed: "Optional · collapsed by default",
  alreadyLinked: "Already linked",
  addLinkedExpense: "Add a new expense and link it to this event",
  expenseChangesUnavailable: "Your trip permissions do not allow expense changes.",
  expenseDescriptionField: "Description",
  expenseAmountField: "Amount",
  expenseCurrencyField: "Currency",
  expensePaidByField: "Paid by",
  expenseWhenField: "When · {timeZone}",
  expenseSharedByField: "Shared by",
  eventExpenseAtomicNotice: "The amount is split equally. Saving or approving creates the event, linked expense, splits, revisions, and audit entries in one database transaction.",
  saveEventAndExpense: "Save event + expense",
  saveEventNow: "Save now",
  requestOwnerApproval: "Request owner approval",
  cancelButton: "Cancel",
  enableMemberAccess: "Enable",
  disableMemberAccess: "Disable",
  disableMemberTitle: "Disable member access?",
  disableMemberCloseLabel: "Cancel disabling member",
  disableMemberWarning: "{name} will be signed out immediately and will not be able to sign in again until an owner enables their access.",
  disableMemberIdentityLinked: "Their Google identity remains linked, so enabling them later will restore normal sign-in without a new invitation.",
  disableMemberConfirm: "Disable member",
  memberGoogleEmail: "Google account · {email}",
  planAndExpenseSaved: "Plan and linked expense saved together, split, and logged.",
  planSaved: "Plan saved and logged.",
  planChangeRequested: "Change request sent to the owner. The plan and linked expense will apply together after approval.",
  eventCancelled: "Plan item cancelled.",
  eventRestored: "Plan item restored.",
  eventActionRequested: "{action} request sent to the owner.",
  planSaveFailed: "Unable to save the plan.",
  planUpdateFailed: "Unable to update the plan.",
  startDateOutsideTrip: "The start date must be one of this trip's dates.",
  durationMinimum: "Duration must be at least one minute.",
  calendarOptional: "Google Calendar · optional",
  calendarSelectedDay: "Selected day",
  calendarTripDates: "Trip dates",
  calendarConnectWhenNeeded: "Connect when you need it",
  calendarAccessUnavailable: "Calendar access unavailable",
  calendarConnectDescription: "Signing in does not connect your calendar. Choose Add to calendar on an event, or add all timed events when you are ready.",
  calendarAccessDisabledDescription: "Your owner has disabled Calendar access for this account.",
  addAllToCalendar: "Add all to calendar",
  addOrUpdateAllCalendar: "Add/update all",
  refreshCalendar: "Refresh",
  googleCalendar: "Google Calendar",
  calendarEventCountOne: "{count} Calendar event",
  calendarEventCountMany: "{count} Calendar events",
  possibleCalendarConflictOne: "{count} possible conflict",
  possibleCalendarConflictMany: "{count} possible conflicts",
  calendarOverlaps: "Overlaps {title}",
  noCalendarConflicts: "No time conflicts found.",
  checkingCalendarConflicts: "Checking for conflicts…",
  calendarLinked: "Linked",
  calendarOnly: "Calendar only",
  openCalendarEntry: "Open",
  loadingCalendar: "Loading Calendar…",
  noCalendarEventsDay: "No Google Calendar events on this day.",
  noCalendarEventsTrip: "No Google Calendar events in the trip date range.",
  calendarMoreEvents: "Showing the next 3 of {count} events for this day. Open Itinerary for the full list.",
  addToCalendar: "Add to calendar",
  updateCalendar: "Update calendar",
  calendarSyncing: "Syncing with Google Calendar…",
  calendarOpeningEvent: "Opening the event in Google Calendar…",
  calendarOpeningHint: "This may take a few seconds. Use your browser's Back button to return.",
  allowCalendarAccess: "Allow Google Calendar access?",
  calendarConsentIntro: "Calendar access is optional and is not required to sign in. To complete this action, Google will ask whether Stardust may view and edit events in your Google Calendars.",
  calendarConsentConnect: "Stardust will connect your Calendar without adding any trip events yet.",
  calendarConsentSingle: "Stardust will add this trip event to your primary calendar.",
  calendarConsentAll: "Stardust will add the timed trip events to your primary calendar.",
  calendarConsentConflicts: "Your Google events can then appear beside the itinerary for conflict checks.",
  calendarConsentCancel: "You can cancel now and continue using Stardust without Calendar access.",
  calendarTestingNotice: "Google has not verified this app yet, so before Calendar access it may show a warning that the app is unverified. To continue, choose Advanced on that screen and go to the app. Continue only if you trust this trip's organizer.",
  calendarConnectedStatus: "Connected for this trip member",
  calendarNotConnectedStatus: "Not connected",
  calendarConnectionPersonal: "Google sign-in and Google Calendar are separate. This Calendar connection belongs only to {name}.",
  linkGoogleCalendar: "Link Google Calendar",
  notNow: "Not now",
  continueWithGoogle: "Continue with Google",
  calendarConnectedFinishing: "Google Calendar connected. Finishing your requested Calendar action…",
  calendarConnectedReady: "Google Calendar connected. You can now add trip events when you choose.",
  calendarConnectionFailed: "Google Calendar connection failed. Check the consent screen, Calendar API, scope, and redirect URI.",
  calendarAccessDisabledNotice: "Google Calendar access is disabled for this trip member.",
  calendarChooseEventNotice: "Choose an itinerary event before adding it to Google Calendar.",
  calendarSyncFailed: "Calendar sync failed.",
  enableCalendarApi: "Enable the API",
  switchTripTitle: "Switch trip",
  switchTripDescription: "Select any active trip linked to this Google identity.",
  currentTripField: "Current trip",
  createNewTrip: "Create new trip",
  travelDestinationField: "Travel destination",
  timeZoneField: "Time zone",
  startDateField: "Start date",
  endDateField: "End date",
  maximumMembersField: "Maximum members, including owner",
  ownerTripContextLabel: "OWNER TRIP CONTEXT",
  ownerTripContextTitle: "Destination, local time, dates, and capacity",
  ownerTripContextDescription: "Set the trip dates, destination and local time used for your itinerary and AI planning.",
  tripDatesHint: "Up to 366 days. Extend either end or shorten unused dates. Existing events and expenses keep their dates; dates containing events or unapproved changes cannot be excluded.",
  confirmTripDateChange: "Change the trip from {previousStart} – {previousEnd} to {nextStart} – {nextEnd}? Existing events and expenses will not move.",
  tripSettingsInvalidDates: "Choose valid start and end dates. The end must be on or after the start, with at most 366 calendar days.",
  tripSettingsDatesOccupied: "These dates would exclude an existing event or unapproved change, possibly private. Move the affected items first, or keep a wider date range. Nothing was changed.",
  tripSettingsDatesStale: "Another owner changed the trip dates. Refresh the page, then review and re-enter your changes. Nothing was overwritten.",
  tripSettingsSaving: "Saving…",
  tripCapacityHint: "{count} places currently reserved · product maximum 20",
  saveTripSettings: "Save trip settings",
  tripSettingsSaved: "Trip destination, time zone, dates, and member capacity were updated and logged.",
  tripSettingsSaveFailed: "Unable to update trip settings.",
  tripSettingsInvalidMembers: "Maximum members must be a whole number from {count} to 20.",
  refreshAfterChangeFailed: "The change was saved, but the latest trip data could not be loaded. Reload the page before trying it again.",
};

const zhHk: Messages = {
  appName: "星塵遠征軍",
  demoMode: "示範模式 · 變更不會儲存",
  tripLabel: "目前旅程",
  today: "今日",
  overview: "總覽",
  itinerary: "行程",
  expenses: "旅程開支",
  appCost: "應用程式成本",
  settings: "設定",
  nextUp: "下一站",
  leaveBy: "最遲出發時間",
  routeTime: "車程 35 分鐘 + 緩衝 15 分鐘",
  openMap: "開啟地圖",
  onTrack: "時間充足",
  weather: "22°C · 稍後有微雨",
  weatherClear: "天晴",
  weatherPartlyCloudy: "部分多雲",
  weatherCloudy: "多雲",
  weatherFog: "有霧",
  weatherDrizzle: "毛毛雨",
  weatherRain: "有雨",
  weatherSnow: "有雪",
  weatherThunderstorm: "雷暴",
  weatherUnknown: "暫無預報",
  weatherRainChance: "降水機會 {percent}%",
  weatherApproximate: "旅程地區概算",
  weatherForecastFor: "{date} 的預報",
  weatherAttribution: "天氣資料由 Open-Meteo.com 提供（衍生資料，CC BY 4.0）",
  weatherStale: "上次可用預報；等待更新",
  disruptionCancellation: "活動取消",
  disruptionClosure: "場地關閉",
  disruptionDelay: "服務延誤",
  disruptionTransit: "交通異常",
  disruptionRoad: "道路異常",
  disruptionWeather: "天氣風險",
  disruptionHours: "時間更改",
  disruptionStrike: "罷工影響",
  disruptionAccess: "出入改動",
  disruptionOther: "可能受阻",
  openDisruptionDetail: "查看 {event} 的可能受阻詳情",
  disruptionDetailTitle: "可能影響旅程的狀況",
  disruptionTranslationUnavailable: "暫時未有呢段詳情嘅廣東話版本。請查看原文或官方資料來源。",
  disruptionOriginalText: "查看原文（未經翻譯）",
  disruptionCheckedAt: "檢查時間：{date}",
  disruptionSources: "公開資料來源",
  disruptionSourceNumber: "來源 {number}",
  disruptionPossibleNotice: "這是預警，不是保證。更改行程前，請先查看連結中的官方資料來源。",
  offlineModeTitle: "離線行程",
  offlineModeDescription: "目前無法連接即時系統。以下是此裝置最後儲存的所有旅程日期及團體活動；編輯、AI、開支、Google 日曆、天氣更新及行程受阻檢查均需要網絡連線。",
  offlineSavedAt: "儲存時間：{date}",
  offlinePrivateDeviceNotice: "這是 {name} 的裝置快取。離線時無法重新驗證身分，因此私人活動不會儲存。重新連線後登出即可清除快取。",
  offlineChooseDay: "選擇離線旅程日期",
  offlineDayPosition: "第 {current} 日（共 {total} 日）",
  retryLiveApp: "重新連接即時系統",
  noOfflineEvents: "這一日沒有已儲存的活動。",
  disruptionNotificationsTitle: "行程受阻通知",
  disruptionNotificationsDescription: "當已開啟的程式收到新的有來源受阻資訊時，在手機或電腦顯示通知。程式完全關閉後的推送需要另一套推送服務，目前尚未啟用。",
  enableDisruptionNotifications: "啟用通知",
  disruptionNotificationsEnabled: "瀏覽器通知已啟用。",
  disruptionNotificationsDenied: "此瀏覽器的網站設定已封鎖通知。",
  disruptionNotificationTitle: "偵測到行程可能受阻",
  disruptionNotificationBody: "{event}：{reason}",
  liveOperationsTitle: "即時旅程服務",
  liveOperationsDescription: "只供管理員查看天氣更新及定時行程受阻檢查的狀態。",
  weatherMonitorLabel: "天氣更新",
  disruptionMonitorLabel: "行程受阻監察",
  monitorNeverSucceeded: "尚未有成功執行紀錄",
  monitorLastSuccess: "上次成功：{date}",
  monitorLastAttempt: "上次嘗試：{date}",
  monitorNextDue: "下次執行：{date}",
  monitorLastError: "上次錯誤：{error}",
  monitorNoError: "目前沒有錯誤",
  monitorStatusSucceeded: "成功",
  monitorStatusPartial: "部分完成",
  monitorStatusFailed: "失敗",
  monitorStatusRunning: "執行中",
  monitorStatusSkipped: "沒有合資格活動",
  monitorStatusDisabled: "已停用",
  tripDay: "第 3 日（共 7 日）· 東京",
  askAi: "問旅程 AI",
  aiPlannerLabel: "旅程 AI",
  aiPlaceholder: "將午餐延後，再找一間較安靜的餐廳…",
  aiUnavailable: "此旅程的 AI 功能已停用。",
  aiThinking: "AI 正在思考…",
  aiResearchSources: "即時資料來源",
  aiMemoryNotice: "AI 會使用按 token 上限保留的最近對話、已有版本紀錄的對話摘要，以及你在設定明確儲存的指示。AI 不會從對話自動儲存偏好。其他成員不會收到這些內容；旅程管理員仍可查閱已記錄的提問及回覆。",
  aiMemoryUsage: "此回覆使用：{count} 次最近對話 · 約 {tokens}/{budget} tokens。",
  aiMemoryTruncated: "較舊對話已壓縮成摘要，或過長內容未有載入。",
  newAiConversation: "開始新對話",
  newAiConversationTitle: "開始新的 AI 對話？",
  newAiConversationDescription: "開始新的 AI 上下文，並清除未傳送的訊息。過往對話會保留在 AI 頁，你可以稍後閱讀或繼續。審計紀錄仍會保留。",
  confirmNewAiConversation: "開始新對話",
  aiConversationReset: "新的 AI 對話已開始。較早的對話不會再提供給 AI，審計紀錄則會保留。",
  aiConversationResetFailed: "未能開始新的 AI 對話。",
  sendAiPrompt: "傳送問題",
  aiMemberQuota: "gpt-6.1-sol · 本 UTC 日尚餘 {remaining}/{limit} 次",
  aiOwnerPolicy: "所有 AI 新增活動都要等管理員審批，包括由管理員提出的活動。管理員經驗證的更新、取消及恢復會直接套用並記錄。管理員不受應用程式的每日提問上限限制，但供應商及帳戶的上限仍然適用。",
  aiMemberPolicy: "AI 行程變更會送到管理員的共用審批佇列。",
  aiPlanApplied: "行程已更新並記錄。",
  aiApprovalCreated: "等待管理員審批。",
  aiApprovalBatchCreated: "已建立 {count} 個變更審批請求，正等待管理員審批。",
  aiInvalidProposal: "AI 回傳的變更資料未能通過驗證，因此未有新增任何項目。活動請檢查日期、時間及分享對象；開支請檢查金額、貨幣、付款人及分帳成員，然後再試。",
  aiSearchEvidenceMissing: "AI 未完成所需嘅即時搜尋，所以未有新增任何項目。請再試搜尋；如果唔需要即時查證，可以要求只使用你提供嘅資料。",
  pendingEvents: "待審批活動",
  pendingEventCountOne: "{count} 個待審批活動",
  pendingEventCountMany: "{count} 個待審批活動",
  pendingOwnerApproval: "等待管理員審批",
  pendingEventUpdate: "變更待審批",
  pendingEventRequestedBy: "{name} 提出",
  pendingEventNotConfirmed: "此活動正等待管理員審批；現時會以「待審批」顯示，獲批後才會成為已確認行程。",
  pendingEventUpdateNotApplied: "這項變更正等待管理員審批；獲批前，已確認的活動不會更改。",
  editPendingEvent: "編輯待審批活動",
  loadingPendingEvent: "正在載入活動…",
  savePendingChanges: "儲存待審批變更",
  pendingEventUpdated: "待審批活動已更新，仍須管理員批准。",
  pendingEventLoadFailed: "未能載入此待審批活動以供編輯。",
  pendingEventUpdateFailed: "未能更新此待審批活動；活動可能已被修改或審批，請重新載入後再試。",
  pendingExpenses: "待審批開支",
  pendingExpenseNotIncluded: "等待管理員審批 · 尚未計入總額或還款結算",
  approvePendingEvent: "審批並加入行程",
  rejectPendingEvent: "拒絕待審批活動",
  approvalRequestsNav: "審批（{count}）",
  approvalQueueLabel: "管理員審批 · 歷史紀錄",
  approvalQueueTitle: "審批請求",
  approveRequest: "批准請求",
  rejectRequest: "拒絕請求",
  reapproveRejectedRequest: "批准已拒絕的請求",
  requestStatusPending: "待審批",
  requestStatusRejected: "已拒絕",
  requestStatusApproved: "已批准",
  requestStatusSuperseded: "已被取代",
  requestReviewedAt: "審批時間：{date}",
  noApprovalHistory: "尚未有審批請求紀錄。",
  approvalHistoryLoading: "正在載入審批歷史紀錄…",
  approvalHistoryLoadingMore: "正在載入更多紀錄…",
  approvalHistoryLoadFailed: "未能載入審批歷史紀錄。",
  loadMoreApprovalHistory: "載入更多",
  retryApprovalHistory: "再試一次",
  refreshApprovalHistory: "重新整理",
  requestApprovedNotice: "變更已審批、套用並記錄。",
  requestRejectedNotice: "變更已拒絕並記錄。",
  requestReviewFailed: "未能審批變更。",
  requestReviewStale: "這項提案已更新或已被審批。請重新整理並查看最新版本，再作決定。",
  aiRequestFailed: "AI 請求失敗，請稍後再試。",
  aiSessionExpired: "登入狀態已過期。請重新載入頁面並再次登入，然後重送問題。",
  aiRequestDenied: "你的帳戶或此旅程不允許這項 AI 請求。",
  aiConversationBusy: "AI 正在處理這段對話的另一個問題。請等待完成後再試。",
  aiConversationChanged: "另一個分頁已切換目前對話。請開啟 AI 頁並選擇對話後，再傳送問題。",
  aiRestoringRequest: "正在檢查你上一個 AI 請求…",
  aiProcessingInBackground: "AI 仍在處理。你可以切換其他程式，稍後返嚟睇答案。",
  aiReconnectingRequest: "正在重新連接你嘅 AI 請求…唔會重複提交。",
  aiBusyInAnotherTrip: "你喺另一個旅程嘅 AI 請求仍在處理。請切換到該旅程查看答案。",
  aiRequestTimedOut: "上一個 AI 請求已逾時。重試前請先檢查待批變更；系統冇自動重新提交。",
  aiRequestInterrupted: "上一個 AI 請求已中斷。重試前請先檢查待批變更；系統冇自動重新提交。",
  aiServiceUnavailable: "AI 服務暫時無法使用。請稍後再試；你輸入的問題仍然保留。",
  aiNetworkFailed: "未能連接 Stardust 傳送 AI 請求。請檢查網絡後再試；你輸入的問題仍然保留。",
  aiPromptInvalid: "未能傳送問題。請將內容縮短至 8,000 個字元或以下，然後再試。",
  aiAccess: "AI 權限",
  aiOwnerAccessDescription: "管理員不限提問次數。請選擇模型，並設定成員共用的每 UTC 日提問上限。",
  aiMemberAccessDescription: "成員固定使用 gpt-6.1-sol，每個 UTC 日可提問 {limit} 次。",
  aiOwnerDefaultModel: "管理員預設模型",
  aiMemberPromptsPerDay: "成員每 UTC 日提問上限",
  saveAiLimit: "儲存上限",
  aiOwnerSummary: "管理員不限次數 · 成員每 UTC 日 {limit} 次",
  aiMemberRemaining: "本 UTC 日尚餘 {remaining} 次提問",
  aiLimitInvalid: "請輸入 1 至 1000 的成員每日上限。",
  aiLimitChanged: "成員每日 AI 提問上限已改為 {limit} 次（以 UTC 日計算）。",
  aiLimitChangeFailed: "未能更新每日 AI 提問上限。",
  aiModelChanged: "管理員 AI 模型已改為 {model}。",
  aiModelChangeFailed: "未能更新 AI 模型。",
  costThisTrip: "今次旅程的應用程式成本",
  llmCalls: "LLM 呼叫",
  hosting: "託管成本估算",
  estimated: "估算",
  members: "旅程成員",
  editPlan: "編輯行程",
  addExpense: "新增開支",
  notification: "早晨摘要已傳送至 Discord",
  allPlans: "查看完整行程",
  previousDay: "上一日",
  nextDay: "下一日",
  currentDay: "目前日期",
  eventsForDay: "項當日行程",
  noEventsForDay: "當日未有行程。",
  noConfirmedEventsForDay: "此日暫時沒有已確認的行程活動。",
  plannedFor: "預定時間",
  startsIn: "距離開始",
  noUpcomingEvent: "當日沒有尚未開始的行程。",
  swipeDay: "左右滑動切換日期",
  timeNotSet: "未設定時間",
  calendarAdded: "已新增至你的 Google 日曆。",
  calendarUpdated: "已更新你的 Google 日曆。",
  calendarRecreated: "Google Calendar 已找不到此活動，因此星塵遠征軍已重新加入。",
  calendarBulkSynced: "已在你的 Google 日曆新增或更新 {count} 個活動，並避免重複。",
  calendarLinkReady: "Google 日曆連結已準備好。",
  viewCalendarEvent: "查看活動",
  viewCalendar: "查看日曆",
  dismiss: "關閉",
  dayNumber: "第 {number} 日",
  liveItemCountOne: "{count} 項現有行程",
  liveItemCountMany: "{count} 項現有行程",
  eventCountOne: "{count} 項活動",
  eventCountMany: "{count} 項活動",
  noEvents: "沒有活動",
  stayForDay: "當日住宿",
  hotelCountOne: "{count} 間酒店",
  hotelCountMany: "{count} 間酒店",
  noHotelListed: "未有酒店資料",
  addLodgingHint: "新增住宿行程後，當日酒店便會顯示在這裏。",
  openGoogleMaps: "在 Google 地圖開啟",
  openEventInGoogleMaps: "在 Google 地圖開啟「{title}」",
  eventStatusPlanned: "已安排",
  eventStatusCancelled: "已取消",
  eventTypeActivity: "活動",
  eventTypeMeal: "用餐",
  eventTypeTransport: "交通",
  eventTypeLodging: "住宿",
  eventTypeNote: "備註",
  addPlanItem: "新增活動",
  editPlanItem: "編輯行程",
  editEvent: "編輯",
  cancelEvent: "取消活動",
  restoreEvent: "恢復活動",
  privateEvent: "私人活動",
  sharedByCreator: "由 {name} 分享",
  ownerLock: "管理員鎖定",
  ownerLockDescription: "只有管理員可以編輯、取消、恢復或解除鎖定此活動。",
  eventTitleField: "標題",
  eventTypeField: "類型",
  eventStartsField: "開始 · {timeZone}",
  eventDurationMinutesField: "歷時（分鐘）",
  eventEndsField: "結束 · {timeZone}",
  eventMapUrlField: "Google 地圖確實地點連結",
  eventMapUrlHint: "請貼上地點資料頁的連結，不要貼城市或地區搜尋結果。",
  transportDepartureTimeField: "出發時間 · {timeZone}",
  transportArrivalTimeField: "到達時間 · {timeZone}",
  transportRouteFields: "交通路線",
  transportEndpointHint: "出發地點及目的地可各自選填，但最少要填其中一個地點。",
  transportEndpointRequired: "請填寫出發地點或目的地。",
  departureLocationField: "出發地點（選填）",
  departureMapUrlField: "出發地點 Google 地圖連結（選填）",
  destinationLocationField: "目的地（選填）",
  destinationMapUrlField: "目的地 Google 地圖連結（選填）",
  departureLabel: "出發",
  destinationLabel: "到達",
  locationNotSet: "未設定地點",
  openLocationInGoogleMaps: "在 Google 地圖開啟「{location}」",
  eventNotesField: "備註",
  eventAudienceField: "誰可以查看此活動",
  privateEventDescription: "私人活動只供建立者及下方所選成員查看。連結至活動的開支必須使用相同查看名單。",
  privateEventOwnerRequired: "你的權限需要管理員審批，因此提交此私人活動前必須選取管理員。",
  privateEventCreatorOnly: "此私人活動由 {name} 建立，只有建立者可以更改分享對象。",
  eventExpense: "開支",
  optionalCollapsed: "選填 · 預設收起",
  alreadyLinked: "已連結",
  addLinkedExpense: "新增開支並連結至此活動",
  expenseChangesUnavailable: "你的旅程權限不允許更改開支。",
  expenseDescriptionField: "說明",
  expenseAmountField: "金額",
  expenseCurrencyField: "貨幣",
  expensePaidByField: "付款人",
  expenseWhenField: "時間 · {timeZone}",
  expenseSharedByField: "分攤成員",
  eventExpenseAtomicNotice: "金額會平均分攤。儲存或審批時，系統會在同一個資料庫交易內建立活動、連結開支、分攤、修訂及審計紀錄。",
  saveEventAndExpense: "儲存活動及開支",
  saveEventNow: "立即儲存",
  requestOwnerApproval: "要求管理員審批",
  cancelButton: "取消",
  enableMemberAccess: "啟用",
  disableMemberAccess: "停用",
  disableMemberTitle: "停用成員存取權？",
  disableMemberCloseLabel: "取消停用成員",
  disableMemberWarning: "系統會立即登出 {name}，並阻止其再次登入，直至管理員重新啟用其存取權。",
  disableMemberIdentityLinked: "其 Google 身分仍會保持連結；日後重新啟用即可恢復正常登入，毋須發出新邀請。",
  disableMemberConfirm: "停用成員",
  memberGoogleEmail: "Google 帳戶 · {email}",
  planAndExpenseSaved: "行程及連結開支已一併儲存、分攤並記錄。",
  planSaved: "行程已儲存並記錄。",
  planChangeRequested: "變更要求已送交管理員；審批後會一併套用行程及連結開支。",
  eventCancelled: "行程活動已取消。",
  eventRestored: "行程活動已恢復。",
  eventActionRequested: "已將「{action}」要求送交管理員。",
  planSaveFailed: "未能儲存行程。",
  planUpdateFailed: "未能更新行程。",
  startDateOutsideTrip: "開始日期必須是此旅程的其中一日。",
  durationMinimum: "歷時必須至少為一分鐘。",
  calendarOptional: "Google Calendar · 選用",
  calendarSelectedDay: "所選日期",
  calendarTripDates: "旅程日期",
  calendarConnectWhenNeeded: "需要時才連接",
  calendarAccessUnavailable: "無法使用日曆功能",
  calendarConnectDescription: "登入不會自動連接你的日曆。準備好後，可在活動按「加至日曆」，或一次加入所有有時間的活動。",
  calendarAccessDisabledDescription: "管理員已停用此帳戶的日曆權限。",
  addAllToCalendar: "全部加至日曆",
  addOrUpdateAllCalendar: "全部新增／更新",
  refreshCalendar: "重新整理",
  googleCalendar: "Google Calendar",
  calendarEventCountOne: "{count} 個日曆活動",
  calendarEventCountMany: "{count} 個日曆活動",
  possibleCalendarConflictOne: "{count} 個可能有衝突的活動",
  possibleCalendarConflictMany: "{count} 個可能有衝突的活動",
  calendarOverlaps: "與「{title}」時間重疊",
  noCalendarConflicts: "沒有發現時間衝突。",
  checkingCalendarConflicts: "正在檢查時間衝突…",
  calendarLinked: "已連結",
  calendarOnly: "只在日曆",
  openCalendarEntry: "開啟",
  loadingCalendar: "正在載入 Google Calendar…",
  noCalendarEventsDay: "Google Calendar 在這一日沒有活動。",
  noCalendarEventsTrip: "Google Calendar 在旅程日期內沒有活動。",
  calendarMoreEvents: "現顯示當日 {count} 個活動中的首 3 個；完整清單可在行程頁查看。",
  addToCalendar: "加至日曆",
  updateCalendar: "更新日曆",
  calendarSyncing: "正在與 Google Calendar 同步…",
  calendarOpeningEvent: "正在 Google Calendar 開啟活動…",
  calendarOpeningHint: "這可能需要幾秒；請使用瀏覽器的返回按鈕回到行程。",
  allowCalendarAccess: "允許使用 Google Calendar？",
  calendarConsentIntro: "日曆權限是選用功能，登入時並不需要。若要完成此操作，Google 會詢問你是否允許星塵遠征軍查看及編輯你的 Google 日曆活動。",
  calendarConsentConnect: "星塵遠征軍只會先連接你的日曆，暫時不會加入任何旅程活動。",
  calendarConsentSingle: "星塵遠征軍會把這項旅程活動加入你的主要日曆。",
  calendarConsentAll: "星塵遠征軍會把旅程內有時間的活動加入你的主要日曆。",
  calendarConsentConflicts: "之後你的 Google 日曆活動可顯示在行程旁邊，讓系統檢查時間衝突。",
  calendarConsentCancel: "你可以現在取消，並在不授予日曆權限的情況下繼續使用星塵遠征軍。",
  calendarTestingNotice: "Google 尚未驗證此應用程式，因此在存取日曆前可能會顯示應用程式未經驗證的警告。如要繼續，請在該畫面選擇「進階」，再前往應用程式。請只在你信任此旅程的發起人時繼續。",
  calendarConnectedStatus: "已為此旅程成員連接",
  calendarNotConnectedStatus: "尚未連接",
  calendarConnectionPersonal: "Google 登入與 Google Calendar 是兩項獨立連結。這個日曆連結只屬於 {name}。",
  linkGoogleCalendar: "連接 Google Calendar",
  notNow: "暫時不要",
  continueWithGoogle: "透過 Google 繼續",
  calendarConnectedFinishing: "Google Calendar 已連接，正在完成你要求的日曆操作…",
  calendarConnectedReady: "Google Calendar 已連接；你現在可按需要加入旅程活動。",
  calendarConnectionFailed: "Google Calendar 連接失敗。請檢查同意畫面、Calendar API、權限範圍及重新導向 URI。",
  calendarAccessDisabledNotice: "此旅程成員的 Google Calendar 權限已停用。",
  calendarChooseEventNotice: "請先選擇一項行程活動，再加至 Google Calendar。",
  calendarSyncFailed: "Google Calendar 同步失敗。",
  enableCalendarApi: "啟用 API",
  switchTripTitle: "切換旅程",
  switchTripDescription: "選擇任何已連結至此 Google 身分的有效旅程。",
  currentTripField: "目前旅程",
  createNewTrip: "建立新旅程",
  travelDestinationField: "旅遊目的地",
  timeZoneField: "時區",
  startDateField: "開始日期",
  endDateField: "結束日期",
  maximumMembersField: "成員上限（包括管理員）",
  ownerTripContextLabel: "管理員旅程設定",
  ownerTripContextTitle: "目的地、當地時間、日期及人數",
  ownerTripContextDescription: "設定旅程日期、目的地及當地時區，供行程及 AI 規劃使用。",
  tripDatesHint: "旅程最多 366 日。開始及結束日期都可以延長，亦可縮短未使用的日期。現有活動及開支日期不會移動；有活動或未批准變更的日期不能排除。",
  confirmTripDateChange: "確定將旅程由 {previousStart} – {previousEnd} 改為 {nextStart} – {nextEnd}？現有活動及開支日期不會移動。",
  tripSettingsInvalidDates: "請選擇有效的開始及結束日期。結束日期不得早於開始日期，旅程最多涵蓋 366 日。",
  tripSettingsDatesOccupied: "新的日期範圍會排除現有活動或未批准變更，當中可能包括私人活動。請先調整相關項目，或保留較闊的日期範圍。所有資料均未有改動。",
  tripSettingsDatesStale: "另一位擁有人已更改旅程日期。請重新整理頁面，確認最新日期後再輸入修改；系統未有覆寫任何資料。",
  tripSettingsSaving: "正在儲存…",
  tripCapacityHint: "目前已預留 {count} 個名額 · 系統上限 20 人",
  saveTripSettings: "儲存旅程設定",
  tripSettingsSaved: "旅程目的地、時區、日期及成員上限已更新並記錄。",
  tripSettingsSaveFailed: "未能更新旅程設定。",
  tripSettingsInvalidMembers: "成員上限必須是 {count} 至 20 的整數。",
  refreshAfterChangeFailed: "變更已儲存，但未能載入最新旅程資料。請重新載入頁面，避免重複提交。",
};

const zhHkLihkg: Messages = {
  ...zhHk,
  demoMode: "示範模式 · 撳到爛都唔會幫你儲",
  tripLabel: "今次又去邊",
  today: "今日搞邊科",
  overview: "睇晒先",
  itinerary: "成班友個行程",
  nextUp: "下一鑊",
  routeTime: "車程 35 分鐘 + 預你哋遲到 15 分鐘",
  openMap: "唔識路就撳呢度",
  onTrack: "暫時未出事",
  tripDay: "第 3 日（共 7 日）· 東京，仲有排捱",
  askAi: "叫 AI 執手尾",
  aiPlannerLabel: "旅程 AI",
  aiPlaceholder: "又想改午餐？講啦，反正實有人有意見…",
  aiThinking: "AI 諗緊計，咪催…",
  aiMemberQuota: "gpt-6.1-sol · 呢個 UTC 日仲有 {remaining}/{limit} 次機會",
  aiPlanApplied: "行程已經幫你改好兼留咗紀錄。",
  members: "今次班麻煩友",
  editPlan: "又要改行程",
  addExpense: "入數，唔好扮唔記得",
  notification: "Discord 朝早提過你哋，遲到唔好賴人",
  allPlans: "睇晒成個行程",
  previousDay: "上一日搞乜",
  nextDay: "下一日搞乜",
  currentDay: "而家呢日",
  eventsForDay: "單嘢等住你",
  noEventsForDay: "呢日成張白紙，居然冇人搞事。",
  plannedFor: "預定時間",
  startsIn: "仲有幾耐開波",
  noUpcomingEvent: "呢日冇下一站，終於可以唞吓。",
  swipeDay: "左右掃就可以轉日子",
  calendarAdded: "已經加落你個 Google Calendar。",
  calendarUpdated: "已經幫你更新 Google Calendar。",
  calendarRecreated: zhHk.calendarRecreated,
  calendarBulkSynced: "Google Calendar 已加／更新 {count} 個活動，唔會重複。",
  calendarLinkReady: "條 Calendar link 搞掂。",
  viewCalendarEvent: "睇活動",
  viewCalendar: "開 Google Calendar",
  dismiss: "收起",
  liveItemCountOne: "仲有 {count} 項行程",
  liveItemCountMany: "仲有 {count} 項行程",
  eventCountOne: "{count} 單嘢等住你",
  eventCountMany: "{count} 單嘢等住你",
  noEvents: "乜活動都冇",
  stayForDay: "今日瞓邊",
  noHotelListed: "連酒店都未填",
  addLodgingHint: "加返住宿行程，先可以喺度見到當日酒店。",
  openGoogleMaps: "喺 Google 地圖睇路",
  eventTypeMeal: "食飯",
  addPlanItem: "新增活動",
  editPlanItem: "執一執行程",
  editEvent: "編輯",
  calendarConnectWhenNeeded: "要用先連接",
  addAllToCalendar: "成批加落日曆",
  addOrUpdateAllCalendar: "全部加／更新",
  openCalendarEntry: "開嚟睇",
  addToCalendar: "加落日曆",
  updateCalendar: "更新日曆",
};

const jaJp: Messages = {
  appName: "スターダスト・イティネラリー",
  demoMode: "デモモード · 変更は保存されません",
  tripLabel: "現在の旅",
  today: "今日",
  overview: "概要",
  itinerary: "旅程",
  expenses: "旅行費用",
  appCost: "アプリ費用",
  settings: "設定",
  nextUp: "次の予定",
  leaveBy: "出発期限",
  routeTime: "移動 35 分 + 余裕 15 分",
  openMap: "地図を開く",
  onTrack: "予定どおり",
  weather: "22°C · 午後は小雨",
  weatherClear: "晴れ",
  weatherPartlyCloudy: "晴れ時々曇り",
  weatherCloudy: "曇り",
  weatherFog: "霧",
  weatherDrizzle: "霧雨",
  weatherRain: "雨",
  weatherSnow: "雪",
  weatherThunderstorm: "雷雨",
  weatherUnknown: "予報なし",
  weatherRainChance: "降水確率 {percent}%",
  weatherApproximate: "旅行地域の概算",
  weatherForecastFor: "{date} の予報",
  weatherAttribution: "天気データ：Open-Meteo.com（派生データ、CC BY 4.0）",
  weatherStale: "前回取得した予報・更新待ち",
  disruptionCancellation: "予定中止",
  disruptionClosure: "施設休業",
  disruptionDelay: "運行遅延",
  disruptionTransit: "交通障害",
  disruptionRoad: "道路障害",
  disruptionWeather: "天候リスク",
  disruptionHours: "時間変更",
  disruptionStrike: "スト影響",
  disruptionAccess: "入場変更",
  disruptionOther: "影響の可能性",
  openDisruptionDetail: "{event} の影響情報を見る",
  disruptionDetailTitle: "旅行への影響の可能性",
  disruptionTranslationUnavailable: "この詳細の日本語訳はまだありません。原文または公式情報源をご確認ください。",
  disruptionOriginalText: "原文を見る（未翻訳）",
  disruptionCheckedAt: "確認日時：{date}",
  disruptionSources: "公開情報源",
  disruptionSourceNumber: "情報源 {number}",
  disruptionPossibleNotice: "これは早期警告であり、確定情報ではありません。予定を変更する前に、リンク先の公式情報を確認してください。",
  offlineModeTitle: "オフライン旅程",
  offlineModeDescription: "ライブアプリに接続できません。この端末に最後に保存された全旅行日の共有予定を表示しています。編集、AI、費用、Google カレンダー、天気更新、運行障害確認には接続が必要です。",
  offlineSavedAt: "保存日時：{date}",
  offlinePrivateDeviceNotice: "{name} 用の端末キャッシュです。オフラインでは本人確認をやり直せないため、非公開予定は保存されません。再接続後にログアウトするとキャッシュを消去できます。",
  offlineChooseDay: "オフラインで表示する旅行日を選択",
  offlineDayPosition: "全 {total} 日中 {current} 日目",
  retryLiveApp: "ライブアプリに再接続",
  noOfflineEvents: "この日に保存された予定はありません。",
  disruptionNotificationsTitle: "運行・営業障害通知",
  disruptionNotificationsDescription: "開いているアプリが新しい根拠付きの影響情報を受信したとき、端末に通知します。アプリを完全に閉じた状態のプッシュ通知には別の配信サービスが必要なため、まだ有効ではありません。",
  enableDisruptionNotifications: "通知を有効にする",
  disruptionNotificationsEnabled: "ブラウザ通知は有効です。",
  disruptionNotificationsDenied: "このブラウザのサイト設定で通知がブロックされています。",
  disruptionNotificationTitle: "旅行への影響を検出",
  disruptionNotificationBody: "{event}：{reason}",
  liveOperationsTitle: "旅行ライブサービス",
  liveOperationsDescription: "天気更新と定期障害チェックのオーナー専用ステータスです。",
  weatherMonitorLabel: "天気更新",
  disruptionMonitorLabel: "障害モニター",
  monitorNeverSucceeded: "成功した実行はまだありません",
  monitorLastSuccess: "最終成功：{date}",
  monitorLastAttempt: "最終試行：{date}",
  monitorNextDue: "次回予定：{date}",
  monitorLastError: "最新エラー：{error}",
  monitorNoError: "現在エラーなし",
  monitorStatusSucceeded: "成功",
  monitorStatusPartial: "一部完了",
  monitorStatusFailed: "失敗",
  monitorStatusRunning: "実行中",
  monitorStatusSkipped: "対象予定なし",
  monitorStatusDisabled: "無効",
  tripDay: "7日間の3日目 · 東京",
  askAi: "旅行AIに相談",
  aiPlannerLabel: "旅行AI",
  aiPlaceholder: "昼食を遅らせて、静かな店を探して…",
  aiUnavailable: "この旅ではAI機能が無効です。",
  aiThinking: "AIが考えています…",
  aiResearchSources: "ライブ検索の情報源",
  aiMemoryNotice: "AIはトークン上限内の直近の会話、バージョン管理された会話要約、設定で明示的に保存した指示を使います。会話から好みを自動保存しません。他のメンバーにはこの文脈を渡しませんが、旅行オーナーは記録された質問と回答を確認できます。",
  aiMemoryUsage: "使用した文脈：直近{count}件 · 約{tokens}/{budget}トークン。",
  aiMemoryTruncated: "古い会話は要約に圧縮されたか、長すぎる内容を除外しました。",
  newAiConversation: "新しい会話",
  newAiConversationTitle: "新しいAI会話を始めますか？",
  newAiConversationDescription: "新しい文脈で会話を始め、未送信のメッセージを消去します。以前の会話はAIタブに残り、後から閲覧・再開できます。監査ログも保持されます。",
  confirmNewAiConversation: "新しい会話を開始",
  aiConversationReset: "新しいAI会話を開始しました。以前の会話はAIに送られなくなり、監査記録は保持されます。",
  aiConversationResetFailed: "新しいAI会話を開始できませんでした。",
  sendAiPrompt: "質問を送信",
  aiMemberQuota: "gpt-6.1-sol · このUTC日ではあと{remaining}/{limit}回",
  aiOwnerPolicy: "AIが作成する予定は、オーナー自身の依頼でも必ずオーナー承認を待ちます。検証済みのオーナーによる更新・キャンセル・復元は適用・記録されます。オーナーにアプリ側の1日あたりの質問上限はありませんが、プロバイダーやアカウントの上限は適用されます。",
  aiMemberPolicy: "AIによる旅程変更は、オーナーの共有承認キューに送られます。",
  aiPlanApplied: "旅程を更新し、記録しました。",
  aiApprovalCreated: "オーナーの承認待ちです。",
  aiApprovalBatchCreated: "{count}件の変更リクエストを作成し、オーナーの承認を待っています。",
  aiInvalidProposal: "AIが返した変更内容を検証できなかったため、何も追加されていません。予定は日付・時刻・共有範囲を、費用は金額・通貨・支払者・分担メンバーを確認して、もう一度お試しください。",
  aiSearchEvidenceMissing: "必要なライブ検索が完了しなかったため、何も追加されていません。検索を再試行してください。最新情報の確認が不要なら、提供した情報だけを使うよう依頼できます。",
  pendingEvents: "承認待ちの予定",
  pendingEventCountOne: "承認待ち {count} 件",
  pendingEventCountMany: "承認待ち {count} 件",
  pendingOwnerApproval: "オーナーの承認待ち",
  pendingEventUpdate: "変更の承認待ち",
  pendingEventRequestedBy: "{name}さんが申請",
  pendingEventNotConfirmed: "この予定はオーナーの承認待ちです。承認されるまでは「承認待ち」として表示され、確定した旅程ではありません。",
  pendingEventUpdateNotApplied: "この変更リクエストはオーナーの承認待ちです。承認されるまで確定済みの予定は変更されません。",
  editPendingEvent: "承認待ちの予定を編集",
  loadingPendingEvent: "予定を読み込んでいます…",
  savePendingChanges: "承認待ちの変更を保存",
  pendingEventUpdated: "承認待ちの予定を更新しました。引き続きオーナーの承認が必要です。",
  pendingEventLoadFailed: "承認待ちの予定を編集用に読み込めませんでした。",
  pendingEventUpdateFailed: "承認待ちの予定を更新できませんでした。変更済みまたは確認済みの可能性があるため、再読み込みしてお試しください。",
  pendingExpenses: "承認待ちの費用",
  pendingExpenseNotIncluded: "オーナーの承認待ち · 合計や精算には含まれていません",
  approvePendingEvent: "承認して旅程に追加",
  rejectPendingEvent: "承認待ちの予定を却下",
  approvalRequestsNav: "承認（{count}）",
  approvalQueueLabel: "オーナー承認 · 履歴",
  approvalQueueTitle: "承認リクエスト",
  approveRequest: "リクエストを承認",
  rejectRequest: "リクエストを却下",
  reapproveRejectedRequest: "却下済みリクエストを承認",
  requestStatusPending: "承認待ち",
  requestStatusRejected: "却下済み",
  requestStatusApproved: "承認済み",
  requestStatusSuperseded: "置き換え済み",
  requestReviewedAt: "確認日時：{date}",
  noApprovalHistory: "承認リクエストの履歴はありません。",
  approvalHistoryLoading: "承認履歴を読み込んでいます…",
  approvalHistoryLoadingMore: "さらに読み込んでいます…",
  approvalHistoryLoadFailed: "承認履歴を読み込めませんでした。",
  loadMoreApprovalHistory: "さらに読み込む",
  retryApprovalHistory: "再試行",
  refreshApprovalHistory: "更新",
  requestApprovedNotice: "リクエストを承認し、適用・記録しました。",
  requestRejectedNotice: "リクエストを却下し、記録しました。",
  requestReviewFailed: "リクエストを確認できませんでした。",
  requestReviewStale: "この提案は変更済み、または確認済みです。更新して最新の内容を確認してから、もう一度操作してください。",
  aiRequestFailed: "AIへのリクエストに失敗しました。もう一度お試しください。",
  aiSessionExpired: "ログインの有効期限が切れました。ページを再読み込みして再度ログインし、質問を送り直してください。",
  aiRequestDenied: "このアカウントまたは旅行では、このAIリクエストは許可されていません。",
  aiConversationBusy: "AIはこの会話の別の質問を処理中です。完了してからもう一度お試しください。",
  aiConversationChanged: "別のタブで会話が切り替わりました。AIタブで会話を選んでから再送信してください。",
  aiRestoringRequest: "前回のAIリクエストを確認しています…",
  aiProcessingInBackground: "AIは処理を続けています。他のアプリに切り替えても、ここに戻れば回答を確認できます。",
  aiReconnectingRequest: "AIリクエストに再接続しています…再送信は行いません。",
  aiBusyInAnotherTrip: "別の旅行でAIリクエストを処理中です。その旅行を開くと回答を確認できます。",
  aiRequestTimedOut: "前回のAIリクエストは制限時間に達しました。再試行前に承認待ちの変更を確認してください。自動再送信はしていません。",
  aiRequestInterrupted: "前回のAIリクエストは中断されました。再試行前に承認待ちの変更を確認してください。自動再送信はしていません。",
  aiServiceUnavailable: "AIサービスは一時的に利用できません。少し待ってからもう一度お試しください。入力内容は残っています。",
  aiNetworkFailed: "AIリクエストをStardustへ送信できませんでした。接続を確認して、もう一度お試しください。入力内容は残っています。",
  aiPromptInvalid: "質問を送信できませんでした。8,000文字以内にして、もう一度お試しください。",
  aiAccess: "AIアクセス",
  aiOwnerAccessDescription: "オーナーの利用回数は無制限です。モデルを選び、メンバー共通のUTC日ごとの質問上限を設定できます。",
  aiMemberAccessDescription: "メンバーはgpt-6.1-sol固定で、UTC日ごとに{limit}回まで質問できます。",
  aiOwnerDefaultModel: "オーナーの既定モデル",
  aiMemberPromptsPerDay: "メンバーのUTC日ごとの質問数",
  saveAiLimit: "上限を保存",
  aiOwnerSummary: "オーナーは無制限 · メンバーはUTC日ごとに{limit}回",
  aiMemberRemaining: "このUTC日ではあと{remaining}回質問できます",
  aiLimitInvalid: "メンバーの1日上限は1～1000で入力してください。",
  aiLimitChanged: "メンバーのAI上限をUTC日ごとに{limit}回へ変更しました。",
  aiLimitChangeFailed: "AIの1日上限を更新できませんでした。",
  aiModelChanged: "オーナーのAIモデルを{model}に変更しました。",
  aiModelChangeFailed: "AIモデルを更新できませんでした。",
  costThisTrip: "今回のアプリ費用",
  llmCalls: "LLM呼び出し",
  hosting: "ホスティング見積もり",
  estimated: "見積もり",
  members: "旅行メンバー",
  editPlan: "予定を編集",
  addExpense: "費用を追加",
  notification: "朝の概要をDiscordに送信しました",
  allPlans: "旅程全体を見る",
  previousDay: "前の日",
  nextDay: "次の日",
  currentDay: "現在の日付",
  eventsForDay: "件の予定",
  noEventsForDay: "この日の予定はありません。",
  noConfirmedEventsForDay: "この日には確定済みの旅程はまだありません。",
  plannedFor: "予定時刻",
  startsIn: "開始まで",
  noUpcomingEvent: "この日に今後の予定はありません。",
  swipeDay: "左右にスワイプして日付を切り替え",
  timeNotSet: "時刻未設定",
  calendarAdded: "Google カレンダーに追加しました。",
  calendarUpdated: "Google カレンダーの予定を更新しました。",
  calendarRecreated: "Google カレンダーに予定が見つからなかったため、Stardust がもう一度追加しました。",
  calendarBulkSynced: "Google カレンダーの予定を{count}件、重複せずに追加または更新しました。",
  calendarLinkReady: "Google カレンダーのリンクを開けます。",
  viewCalendarEvent: "予定を見る",
  viewCalendar: "カレンダーを見る",
  dismiss: "閉じる",
  dayNumber: "{number}日目",
  liveItemCountOne: "有効な予定 {count} 件",
  liveItemCountMany: "有効な予定 {count} 件",
  eventCountOne: "予定 {count} 件",
  eventCountMany: "予定 {count} 件",
  noEvents: "予定なし",
  stayForDay: "この日の宿泊",
  hotelCountOne: "ホテル {count} 件",
  hotelCountMany: "ホテル {count} 件",
  noHotelListed: "ホテル未登録",
  addLodgingHint: "宿泊予定を追加すると、この日のホテルがここに表示されます。",
  openGoogleMaps: "Google マップで開く",
  openEventInGoogleMaps: "「{title}」を Google マップで開く",
  eventStatusPlanned: "予定済み",
  eventStatusCancelled: "キャンセル済み",
  eventTypeActivity: "アクティビティ",
  eventTypeMeal: "食事",
  eventTypeTransport: "移動",
  eventTypeLodging: "宿泊",
  eventTypeNote: "メモ",
  addPlanItem: "予定を追加",
  editPlanItem: "予定を編集",
  editEvent: "編集",
  cancelEvent: "予定をキャンセル",
  restoreEvent: "予定を復元",
  privateEvent: "非公開",
  sharedByCreator: "{name}さんが共有",
  ownerLock: "オーナーロック",
  ownerLockDescription: "この予定を編集、キャンセル、復元、またはロック解除できるのはオーナーだけです。",
  eventTitleField: "タイトル",
  eventTypeField: "種類",
  eventStartsField: "開始 · {timeZone}",
  eventDurationMinutesField: "所要時間（分）",
  eventEndsField: "終了 · {timeZone}",
  eventMapUrlField: "Google マップの正確な場所の URL",
  eventMapUrlHint: "都市や地域の検索結果ではなく、場所の詳細ページの URL を貼り付けてください。",
  transportDepartureTimeField: "出発時刻 · {timeZone}",
  transportArrivalTimeField: "到着時刻 · {timeZone}",
  transportRouteFields: "移動経路",
  transportEndpointHint: "出発地と目的地はそれぞれ任意ですが、少なくとも一方を入力してください。",
  transportEndpointRequired: "出発地または目的地を入力してください。",
  departureLocationField: "出発地（任意）",
  departureMapUrlField: "出発地の Google マップ URL（任意）",
  destinationLocationField: "目的地（任意）",
  destinationMapUrlField: "目的地の Google マップ URL（任意）",
  departureLabel: "出発",
  destinationLabel: "到着",
  locationNotSet: "場所未設定",
  openLocationInGoogleMaps: "{location} を Google マップで開く",
  eventNotesField: "メモ",
  eventAudienceField: "この予定を閲覧できる人",
  privateEventDescription: "非公開の予定は、作成者と下で選択した人だけが閲覧できます。予定に紐づく費用も同じ対象者に限定されます。",
  privateEventOwnerRequired: "あなたの権限ではオーナーの承認が必要なため、この非公開予定を送信する前にオーナーを選択してください。",
  privateEventCreatorOnly: "この非公開予定は{name}さんが作成しました。共有相手を変更できるのは作成者だけです。",
  eventExpense: "費用",
  optionalCollapsed: "任意 · 初期状態では折りたたみ",
  alreadyLinked: "リンク済み",
  addLinkedExpense: "新しい費用を追加して、この予定にリンクする",
  expenseChangesUnavailable: "あなたの旅行権限では費用を変更できません。",
  expenseDescriptionField: "内容",
  expenseAmountField: "金額",
  expenseCurrencyField: "通貨",
  expensePaidByField: "支払った人",
  expenseWhenField: "日時 · {timeZone}",
  expenseSharedByField: "負担する人",
  eventExpenseAtomicNotice: "金額は均等に分割されます。保存または承認すると、予定、リンク済み費用、分割、改訂、監査記録が1つのデータベーストランザクションで作成されます。",
  saveEventAndExpense: "予定と費用を保存",
  saveEventNow: "今すぐ保存",
  requestOwnerApproval: "オーナーの承認を依頼",
  cancelButton: "キャンセル",
  enableMemberAccess: "有効にする",
  disableMemberAccess: "無効にする",
  disableMemberTitle: "メンバーのアクセスを無効にしますか？",
  disableMemberCloseLabel: "メンバーの無効化をキャンセル",
  disableMemberWarning: "{name}さんは直ちにサインアウトされ、オーナーがアクセスを再び有効にするまでサインインできなくなります。",
  disableMemberIdentityLinked: "Google ID との連携は維持されるため、後で有効にすれば新しい招待なしで通常どおりサインインできます。",
  disableMemberConfirm: "メンバーを無効にする",
  memberGoogleEmail: "Google アカウント · {email}",
  planAndExpenseSaved: "予定とリンク済み費用をまとめて保存、分割、記録しました。",
  planSaved: "予定を保存し、記録しました。",
  planChangeRequested: "変更リクエストをオーナーに送信しました。承認後、予定とリンク済み費用がまとめて適用されます。",
  eventCancelled: "予定をキャンセルしました。",
  eventRestored: "予定を復元しました。",
  eventActionRequested: "「{action}」リクエストをオーナーに送信しました。",
  planSaveFailed: "予定を保存できませんでした。",
  planUpdateFailed: "予定を更新できませんでした。",
  startDateOutsideTrip: "開始日はこの旅行の日付内で指定してください。",
  durationMinimum: "所要時間は1分以上にしてください。",
  calendarOptional: "Google カレンダー · 任意",
  calendarSelectedDay: "選択した日",
  calendarTripDates: "旅行期間",
  calendarConnectWhenNeeded: "必要なときに接続",
  calendarAccessUnavailable: "カレンダーを利用できません",
  calendarConnectDescription: "ログインしてもカレンダーには接続されません。準備ができたら予定の「カレンダーに追加」を選ぶか、時刻のある予定をまとめて追加してください。",
  calendarAccessDisabledDescription: "オーナーがこのアカウントのカレンダー権限を無効にしています。",
  addAllToCalendar: "すべてカレンダーに追加",
  addOrUpdateAllCalendar: "すべて追加／更新",
  refreshCalendar: "更新",
  googleCalendar: "Google カレンダー",
  calendarEventCountOne: "カレンダーの予定 {count} 件",
  calendarEventCountMany: "カレンダーの予定 {count} 件",
  possibleCalendarConflictOne: "競合の可能性 {count} 件",
  possibleCalendarConflictMany: "競合の可能性 {count} 件",
  calendarOverlaps: "「{title}」と重複",
  noCalendarConflicts: "時間の競合はありません。",
  checkingCalendarConflicts: "競合を確認しています…",
  calendarLinked: "リンク済み",
  calendarOnly: "カレンダーのみ",
  openCalendarEntry: "開く",
  loadingCalendar: "Google カレンダーを読み込んでいます…",
  noCalendarEventsDay: "この日の Google カレンダーの予定はありません。",
  noCalendarEventsTrip: "旅行期間内に Google カレンダーの予定はありません。",
  calendarMoreEvents: "この日の予定 {count} 件のうち次の3件を表示しています。全件は旅程ページで確認できます。",
  addToCalendar: "カレンダーに追加",
  updateCalendar: "カレンダーを更新",
  calendarSyncing: "Google カレンダーと同期しています…",
  calendarOpeningEvent: "Google カレンダーで予定を開いています…",
  calendarOpeningHint: "数秒かかる場合があります。戻るにはブラウザの「戻る」ボタンを使ってください。",
  allowCalendarAccess: "Google カレンダーへのアクセスを許可しますか？",
  calendarConsentIntro: "カレンダーへのアクセスは任意で、ログインには必要ありません。この操作を完了するため、Google は Stardust に Google カレンダーの予定の表示と編集を許可するか確認します。",
  calendarConsentConnect: "旅行予定はまだ追加せず、Google カレンダーとの接続だけを行います。",
  calendarConsentSingle: "Stardust はこの旅行予定をメインカレンダーに追加します。",
  calendarConsentAll: "Stardust は時刻のある旅行予定をメインカレンダーに追加します。",
  calendarConsentConflicts: "その後、Google の予定を旅程の横に表示し、競合を確認できます。",
  calendarConsentCancel: "今はキャンセルして、カレンダーへのアクセスを許可せずに Stardust を使い続けることもできます。",
  calendarTestingNotice: "このアプリは Google の確認がまだ完了していないため、カレンダーへのアクセス前に未確認のアプリであるという警告が表示される場合があります。続行するには、その画面で「詳細」を選んでからアプリに移動してください。この旅行の主催者を信頼できる場合にのみ続行してください。",
  calendarConnectedStatus: "この旅行メンバーに接続済み",
  calendarNotConnectedStatus: "未接続",
  calendarConnectionPersonal: "Google サインインと Google カレンダーは別の連携です。このカレンダー接続は {name} さん専用です。",
  linkGoogleCalendar: "Google カレンダーを接続",
  notNow: "今はしない",
  continueWithGoogle: "Google で続行",
  calendarConnectedFinishing: "Google カレンダーに接続しました。リクエストされたカレンダー操作を完了しています…",
  calendarConnectedReady: "Google カレンダーに接続しました。必要に応じて旅行予定を追加できます。",
  calendarConnectionFailed: "Google カレンダーに接続できませんでした。同意画面、Calendar API、スコープ、リダイレクト URI を確認してください。",
  calendarAccessDisabledNotice: "この旅行メンバーの Google カレンダー権限は無効です。",
  calendarChooseEventNotice: "Google カレンダーに追加する旅程の予定を選択してください。",
  calendarSyncFailed: "Google カレンダーの同期に失敗しました。",
  enableCalendarApi: "API を有効にする",
  switchTripTitle: "旅行を切り替える",
  switchTripDescription: "この Google ID に紐づいた有効な旅行を選択します。",
  currentTripField: "現在の旅行",
  createNewTrip: "新しい旅行を作成",
  travelDestinationField: "旅行先",
  timeZoneField: "タイムゾーン",
  startDateField: "開始日",
  endDateField: "終了日",
  maximumMembersField: "最大メンバー数（オーナーを含む）",
  ownerTripContextLabel: "オーナー旅行設定",
  ownerTripContextTitle: "旅行先、現地時刻、日程、定員",
  ownerTripContextDescription: "日程、旅行先、現地のタイムゾーンを設定します。旅程とAIの計画に使用されます。",
  tripDatesHint: "最大366日。開始日・終了日を延長したり、未使用の日を短縮できます。既存の予定や支出の日付は移動しません。予定や未承認の変更がある日は範囲外にできません。",
  confirmTripDateChange: "旅行期間を {previousStart} – {previousEnd} から {nextStart} – {nextEnd} に変更しますか？既存の予定や支出の日付は移動しません。",
  tripSettingsInvalidDates: "有効な開始日と終了日を選択してください。終了日は開始日以降で、旅行期間は最大366日です。",
  tripSettingsDatesOccupied: "新しい期間では既存の予定や未承認の変更が範囲外になります。非公開の予定も含まれる場合があります。先に該当項目を調整するか、期間を広げてください。変更は保存されていません。",
  tripSettingsDatesStale: "別のオーナーが旅行日程を変更しました。ページを更新し、最新の日程を確認してから再入力してください。上書きはしていません。",
  tripSettingsSaving: "保存中…",
  tripCapacityHint: "現在 {count} 枠を予約済み · 上限20人",
  saveTripSettings: "旅行設定を保存",
  tripSettingsSaved: "旅行先、タイムゾーン、日程、メンバー上限を更新し、記録しました。",
  tripSettingsSaveFailed: "旅行設定を更新できませんでした。",
  tripSettingsInvalidMembers: "最大メンバー数は {count} から20までの整数にしてください。",
  refreshAfterChangeFailed: "変更は保存されましたが、最新の旅行データを読み込めませんでした。重複送信を避けるため、ページを再読み込みしてください。",
};

export const messages: Record<Locale, Messages> = {
  en,
  "zh-HK": zhHk,
  "zh-HK-lihkg": zhHkLihkg,
  "ja-JP": jaJp,
};

export const restrictedToneKeys = [
  "expenses",
  "appCost",
  "settings",
  "leaveBy",
  "weatherClear",
  "weatherPartlyCloudy",
  "weatherCloudy",
  "weatherFog",
  "weatherDrizzle",
  "weatherRain",
  "weatherSnow",
  "weatherThunderstorm",
  "weatherUnknown",
  "weatherRainChance",
  "weatherApproximate",
  "weatherForecastFor",
  "weatherAttribution",
  "weatherStale",
  "disruptionCancellation",
  "disruptionClosure",
  "disruptionDelay",
  "disruptionTransit",
  "disruptionRoad",
  "disruptionWeather",
  "disruptionHours",
  "disruptionStrike",
  "disruptionAccess",
  "disruptionOther",
  "openDisruptionDetail",
  "disruptionDetailTitle",
  "disruptionTranslationUnavailable",
  "disruptionOriginalText",
  "disruptionCheckedAt",
  "disruptionSources",
  "disruptionSourceNumber",
  "disruptionPossibleNotice",
  "offlineModeTitle",
  "offlineModeDescription",
  "offlineSavedAt",
  "offlinePrivateDeviceNotice",
  "offlineChooseDay",
  "offlineDayPosition",
  "retryLiveApp",
  "noOfflineEvents",
  "disruptionNotificationsTitle",
  "disruptionNotificationsDescription",
  "enableDisruptionNotifications",
  "disruptionNotificationsEnabled",
  "disruptionNotificationsDenied",
  "disruptionNotificationTitle",
  "disruptionNotificationBody",
  "liveOperationsTitle",
  "liveOperationsDescription",
  "weatherMonitorLabel",
  "disruptionMonitorLabel",
  "monitorNeverSucceeded",
  "monitorLastSuccess",
  "monitorLastAttempt",
  "monitorNextDue",
  "monitorLastError",
  "monitorNoError",
  "monitorStatusSucceeded",
  "monitorStatusPartial",
  "monitorStatusFailed",
  "monitorStatusRunning",
  "monitorStatusSkipped",
  "monitorStatusDisabled",
  "aiUnavailable",
  "aiResearchSources",
  "aiMemoryNotice",
  "aiMemoryUsage",
  "aiMemoryTruncated",
  "newAiConversation",
  "newAiConversationTitle",
  "newAiConversationDescription",
  "confirmNewAiConversation",
  "aiConversationReset",
  "aiConversationResetFailed",
  "aiOwnerPolicy",
  "aiMemberPolicy",
  "aiApprovalCreated",
  "aiApprovalBatchCreated",
  "aiInvalidProposal",
  "aiSearchEvidenceMissing",
  "tripDatesHint",
  "confirmTripDateChange",
  "tripSettingsInvalidDates",
  "tripSettingsDatesOccupied",
  "tripSettingsDatesStale",
  "tripSettingsSaving",
  "refreshAfterChangeFailed",
  "noConfirmedEventsForDay",
  "pendingEvents",
  "pendingEventCountOne",
  "pendingEventCountMany",
  "pendingOwnerApproval",
  "pendingEventUpdate",
  "pendingEventRequestedBy",
  "pendingEventNotConfirmed",
  "pendingEventUpdateNotApplied",
  "editPendingEvent",
  "loadingPendingEvent",
  "savePendingChanges",
  "pendingEventUpdated",
  "pendingEventLoadFailed",
  "pendingEventUpdateFailed",
  "pendingExpenses",
  "pendingExpenseNotIncluded",
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
  "approvalHistoryLoading",
  "approvalHistoryLoadingMore",
  "approvalHistoryLoadFailed",
  "loadMoreApprovalHistory",
  "retryApprovalHistory",
  "refreshApprovalHistory",
  "requestApprovedNotice",
  "requestRejectedNotice",
  "requestReviewFailed",
  "requestReviewStale",
  "aiRequestFailed",
  "aiRestoringRequest",
  "aiConversationChanged",
  "aiProcessingInBackground",
  "aiReconnectingRequest",
  "aiBusyInAnotherTrip",
  "aiRequestTimedOut",
  "aiRequestInterrupted",
  "aiAccess",
  "aiOwnerAccessDescription",
  "aiMemberAccessDescription",
  "aiOwnerDefaultModel",
  "aiMemberPromptsPerDay",
  "saveAiLimit",
  "aiOwnerSummary",
  "aiMemberRemaining",
  "aiLimitInvalid",
  "aiLimitChanged",
  "aiLimitChangeFailed",
  "aiModelChanged",
  "aiModelChangeFailed",
  "calendarRecreated",
  "cancelEvent",
  "restoreEvent",
  "privateEvent",
  "sharedByCreator",
  "ownerLock",
  "ownerLockDescription",
  "eventAudienceField",
  "privateEventDescription",
  "privateEventOwnerRequired",
  "privateEventCreatorOnly",
  "eventExpense",
  "optionalCollapsed",
  "alreadyLinked",
  "addLinkedExpense",
  "expenseChangesUnavailable",
  "expenseDescriptionField",
  "expenseAmountField",
  "expenseCurrencyField",
  "expensePaidByField",
  "expenseWhenField",
  "expenseSharedByField",
  "eventExpenseAtomicNotice",
  "saveEventAndExpense",
  "requestOwnerApproval",
  "enableMemberAccess",
  "disableMemberAccess",
  "disableMemberTitle",
  "disableMemberCloseLabel",
  "disableMemberWarning",
  "disableMemberIdentityLinked",
  "disableMemberConfirm",
  "memberGoogleEmail",
  "planAndExpenseSaved",
  "planChangeRequested",
  "eventCancelled",
  "eventRestored",
  "eventActionRequested",
  "planSaveFailed",
  "planUpdateFailed",
  "calendarAccessUnavailable",
  "calendarAccessDisabledDescription",
  "calendarSyncing",
  "calendarOpeningEvent",
  "calendarOpeningHint",
  "allowCalendarAccess",
  "calendarConsentIntro",
  "calendarConsentConnect",
  "calendarConsentSingle",
  "calendarConsentAll",
  "calendarConsentConflicts",
  "calendarConsentCancel",
  "calendarTestingNotice",
  "calendarConnectedStatus",
  "calendarNotConnectedStatus",
  "calendarConnectionPersonal",
  "linkGoogleCalendar",
  "notNow",
  "continueWithGoogle",
  "calendarConnectedFinishing",
  "calendarConnectedReady",
  "calendarConnectionFailed",
  "calendarAccessDisabledNotice",
  "calendarChooseEventNotice",
  "calendarSyncFailed",
  "costThisTrip",
  "llmCalls",
  "hosting",
  "estimated",
] as const satisfies readonly (keyof Messages)[];

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function getMessages(locale: Locale): Messages {
  return messages[locale];
}

export function formatMessage(
  template: string,
  values: Record<string, string | number | null>,
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? placeholder : String(value);
  });
}
