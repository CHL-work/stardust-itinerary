import { describe, expect, it } from "vitest";

import { AI_RESERVATION_INSTRUCTIONS } from "@/lib/ai/reservation-instructions";

describe("AI reservation instructions", () => {
  it("uses one atomic create proposal for a new event and its linked expense", () => {
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("exactly one itinerary_item create proposal");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("patchJson contains linkedExpense");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("Do not return a second standalone expense proposal");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("only on an itinerary_item create proposal");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("after owner approval");
  });

  it("defines deterministic hotel totals and JPY minor units", () => {
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("one lodging event from check-in through check-out");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("final amount paid or owed");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("never add a subtotal or adjustment to it again");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("JPY has no fractional minor unit");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("requesting member as a tentative payer for owner review");
  });

  it("does not infer an expense from an event-only receipt", () => {
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("does not mean the user asked to record an expense");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("event-only request");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("without linkedExpense");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("explicitly asks to add or split");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("Do not silently remove the requested expense");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("short clarification reply can complete");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("do not ask the user to resend facts already present");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("application-selected open create draft");
  });

  it("allocates an undated reservation expense without inventing a payment time", () => {
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("supplies no separate expense or payment date");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("hotel check-in or supplied service/event start timestamp");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("planned ledger allocation date");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("Do not assert that payment happened at check-in");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("disclose this date-allocation assumption");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("never a claim they already paid");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("both message and the proposal reason");
  });

  it("requires exact eligible members and keeps private booking controls out of output", () => {
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("status active or invited");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("no eligible match or more than one match");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("not granted current access");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("creator or an explicitly selected viewer");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("Never copy a booking PIN");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("reservation management, change, or cancellation URL");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("conversation checkpoints");
    expect(AI_RESERVATION_INSTRUCTIONS).toContain("web-search queries");
  });
});
