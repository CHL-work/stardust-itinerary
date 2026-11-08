export type ApprovalExpenseDisplay = {
  description: string;
  amountMinor: number;
  currency: string;
  payerName: string | null;
  occurredAt: string | null;
  status: "draft" | "posted" | "void";
  hasLinkedEvent: boolean;
  splits: Array<{ memberName: string | null; shareMinor: number }>;
};

export type ApprovalEventDisplay = {
  title: string;
  itemType: "activity" | "meal" | "transport" | "lodging" | "note";
  isFlight?: boolean;
  dayDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  locationName: string | null;
  mapUrl: string | null;
  departureLocationName: string | null;
  departureMapUrl: string | null;
  destinationLocationName: string | null;
  destinationMapUrl: string | null;
  notes: string | null;
  visibility: "trip" | "private";
  audienceNames: Array<string | null>;
  isLocked: boolean;
  status: "draft" | "planned" | "cancelled" | "completed";
  linkedExpense: ApprovalExpenseDisplay | null;
};

export type ApprovalDisplay =
  | { kind: "itinerary"; event: ApprovalEventDisplay }
  | { kind: "expense"; expense: ApprovalExpenseDisplay }
  | { kind: "unavailable" };
