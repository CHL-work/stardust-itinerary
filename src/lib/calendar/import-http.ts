import { NextResponse } from "next/server";
import { apiError } from "@/lib/app/http";
import { AppInvalidInputError } from "@/lib/app/repository";

export const calendarPrivateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };
export function calendarImportHttpError(error: unknown) {
  const response = apiError(error);
  for (const [name, value] of Object.entries(calendarPrivateHeaders)) response.headers.set(name, value);
  return response;
}
export function calendarWrongTrip() {
  return NextResponse.json({ error: "CALENDAR_IMPORT_FORBIDDEN" }, { status: 403, headers: calendarPrivateHeaders });
}
/** Bound streamed bodies as well as declared Content-Length; never reflect tokens in errors. */
export async function readCalendarImportJson(request: Request): Promise<unknown> {
  const limit = 48 * 1024;
  const invalid = () => new AppInvalidInputError("CALENDAR_IMPORT_INVALID");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > limit)) throw invalid();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); throw invalid(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalid(); }
}
