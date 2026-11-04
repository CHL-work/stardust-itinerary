import { describe, expect, it } from "vitest";

import {
  PRIVATE_BOOKING_URL_REDACTION,
  RESERVATION_SECRET_REDACTION,
  containsKnownReservationSecret,
  containsReservationSecret,
  inspectReservationSecrets,
  redactReservationSecrets,
} from "@/lib/ai/reservation-secrets";

describe("reservation secret boundaries", () => {
  it.each([
    ["Hotel PIN: 4821", "4821"],
    ["booking passcode is A7B9", "A7B9"],
    ["パスワード：AB12cd", "AB12cd"],
    ["入室コードは９８７６", "９８７６"],
    ["門禁碼係 2468", "2468"],
    ["預約驗證碼：HK77", "HK77"],
  ])("detects a contextual short credential without a long-number heuristic: %s", (text, secret) => {
    const context = inspectReservationSecrets(text);

    expect(context.detected).toBe(true);
    expect(context.credentials).toContain(secret);
    expect(containsReservationSecret(text)).toBe(true);
  });

  it("does not classify unrelated short numbers or a public booking page as credentials", () => {
    const text = [
      "Stay from 2026-09-06 at 15:00; the room costs ¥9800 for 2 guests.",
      "See https://hotel.example.test/booking for public room details.",
    ].join(" ");

    expect(inspectReservationSecrets(text)).toEqual({
      detected: false,
      credentials: [],
      privateUrls: [],
    });
  });

  it.each([
    "https://hotel.example.test/reservations/ABCD1234/manage",
    "https://hotel.example.test/booking/manage?reservation=ABCD&pin=4821",
    "https://guest:secret@hotel.example.test/check-in",
    "https://hotel.example.test/manage/opaque-token",
  ])("detects a credential-bearing private booking URL: %s", (url) => {
    const context = inspectReservationSecrets(`Manage the stay at ${url}.`);

    expect(context.detected).toBe(true);
    expect(context.privateUrls).toEqual([url]);
  });

  it("redacts only the labelled credential and preserves dates, times, prices, and guest counts", () => {
    const input = "PIN: 4821; arrive 2026-09-07 at 21:00, pay ¥9800 for 2 guests.";

    expect(redactReservationSecrets(input)).toBe(
      `PIN: ${RESERVATION_SECRET_REDACTION}; arrive 2026-09-07 at 21:00, pay ¥9800 for 2 guests.`,
    );
  });

  it("removes an unlabelled exact credential copied into later provider output", () => {
    const context = inspectReservationSecrets("入室コードは９８７６");
    const providerOutput = "酒店備註已經加咗入室碼 9876；活動日期係 2026-09-07。";

    expect(containsKnownReservationSecret(providerOutput, context)).toBe(true);
    expect(redactReservationSecrets(providerOutput, context)).toBe(
      `酒店備註已經加咗入室碼 ${RESERVATION_SECRET_REDACTION}；活動日期係 2026-09-07。`,
    );
  });

  it("does not redact an unrelated four-digit value that was not a known credential", () => {
    const context = inspectReservationSecrets("Password: A7B9");
    const providerOutput = "The event is in 2026 and costs ¥9800.";

    expect(containsKnownReservationSecret(providerOutput, context)).toBe(false);
    expect(redactReservationSecrets(providerOutput, context)).toBe(providerOutput);
  });

  it("does not replace a known numeric PIN inside a date, amount, user token, or UUID-like value", () => {
    const context = inspectReservationSecrets("PIN: 2026");
    const providerOutput = [
      "Date 2026-09-07",
      "amount ¥2026",
      "user guest2026",
      "reference abcd-2026-ffff",
      "use 2026 at the door",
    ].join("; ");

    expect(redactReservationSecrets(providerOutput, context)).toBe([
      "Date 2026-09-07",
      "amount ¥2026",
      "user guest2026",
      "reference abcd-2026-ffff",
      `use ${RESERVATION_SECRET_REDACTION} at the door`,
    ].join("; "));
  });

  it("removes an entire private booking URL while retaining an adjacent public URL", () => {
    const privateUrl = "https://hotel.example.test/reservations/ABCD1234/complete";
    const publicUrl = "https://hotel.example.test/rooms/deluxe";
    const input = `Confirmation: ${privateUrl}; hotel page: ${publicUrl}`;

    expect(redactReservationSecrets(input)).toBe(
      `Confirmation: ${PRIVATE_BOOKING_URL_REDACTION}; hotel page: ${publicUrl}`,
    );
  });
});
