import { ZodError } from "zod";
import { NextResponse } from "next/server";

import {
  AppConflictError,
  AppForbiddenError,
  AppInvalidInputError,
  AppNotFoundError,
} from "@/lib/app/repository";
import { AuthConfigurationError, RateLimitError, SessionUnavailableError } from "@/lib/auth/errors";

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "The submitted values are invalid.", issues: error.issues }, { status: 400 });
  }
  if (error instanceof AuthConfigurationError) {
    return NextResponse.json({ error: "Local authentication is not configured." }, { status: 503 });
  }
  if (error instanceof SessionUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json({ error: "Too many requests. Try again later.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
  }
  if (error instanceof AppForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof AppInvalidInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AppNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof AppConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error && typeof error === "object" && "code" in error && error.code === "23514"
    && "constraint" in error && error.constraint === "member_payment_financial_capacity_ck") {
    return NextResponse.json({ error: "This record exceeds the supported financial range. Check the amount or ask a trip owner to review it." }, { status: 400 });
  }
  return NextResponse.json({ error: "The local request failed. Check the server log for details." }, { status: 500 });
}
