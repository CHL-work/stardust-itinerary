import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/app/http";
import { AppInvalidInputError } from "@/lib/app/repository";

/** Admin responses are private to the operator's browser and never cached (JOB-069). */
export const adminHeaders = { "Cache-Control": "private, no-store" };

export function adminError(error: unknown): NextResponse {
  const response = apiError(error);
  response.headers.set("Cache-Control", adminHeaders["Cache-Control"]);
  return response;
}

const accountId = z.uuid();

export function adminAccountId(value: string): string {
  const parsed = accountId.safeParse(value);
  if (!parsed.success) throw new AppInvalidInputError("Unknown account.");
  return parsed.data;
}
