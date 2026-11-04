import { z } from "zod";

import { AuthConfigurationError } from "@/lib/auth/errors";

const authEnvironmentSchema = z.object({
  APP_BASE_URL: z.url().default("http://localhost:3100"),
  APP_ALLOWED_ORIGINS: z.string().default("http://localhost:3100,http://127.0.0.1:3100"),
  AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  AUTH_TRIP_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(2),
  OWNER_GOOGLE_EMAIL: z.email().transform((email) => email.toLowerCase()).optional(),
  OWNER_BOOTSTRAP_SECRET: z.string().min(32).optional(),
});

export type AuthConfig = {
  appBaseUrl: URL;
  allowedOrigins: ReadonlySet<string>;
  authSecret: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  /** New invitation admission only; existing active membership access has no travel-date cutoff. */
  tripGraceDays: number;
  ownerGoogleEmail?: string;
  ownerBootstrapSecret?: string;
};

export function getAuthConfig(): AuthConfig {
  const parsed = authEnvironmentSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new AuthConfigurationError(
      "Authentication is not configured. Set DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET.",
    );
  }

  const appBaseUrl = new URL(parsed.data.APP_BASE_URL);
  const allowedOrigins = new Set([appBaseUrl.origin]);
  try {
    for (const value of parsed.data.APP_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)) {
      allowedOrigins.add(new URL(value).origin);
    }
  } catch {
    throw new AuthConfigurationError("APP_ALLOWED_ORIGINS must contain comma-separated absolute origins.");
  }

  return {
    appBaseUrl,
    allowedOrigins,
    authSecret: parsed.data.AUTH_SECRET,
    databaseUrl: parsed.data.DATABASE_URL,
    googleClientId: parsed.data.GOOGLE_CLIENT_ID,
    googleClientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
    tripGraceDays: parsed.data.AUTH_TRIP_GRACE_DAYS,
    ownerGoogleEmail: parsed.data.OWNER_GOOGLE_EMAIL,
    ownerBootstrapSecret: parsed.data.OWNER_BOOTSTRAP_SECRET,
  };
}

export function isAuthConfigured(): boolean {
  return authEnvironmentSchema.safeParse(process.env).success;
}
