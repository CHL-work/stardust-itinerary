import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { OfflineServiceWorkerRegistration } from "@/components/offline-service-worker";
import { SessionRefresher } from "@/components/session-refresher";
import { FeedbackWidget } from "@/components/feedback-widget";
import { documentLanguageBootstrapScript } from "@/lib/document-language-bootstrap";
import { documentLanguage } from "@/lib/i18n";
import { localeCookieName, preferredLocale } from "@/lib/locale-preference";

import "./globals.css";
import "./new-ui/base.css";
import "./new-ui/shell.css";
import "./new-ui/today.css";
import "./new-ui/expenses.css";
import "./new-ui/ai-settings.css";

export const metadata: Metadata = {
  title: {
    default: "Stardust Itinerary",
    template: "%s · Stardust Itinerary",
  },
  description: "A private group trip planner for a very small expedition party.",
};

// One layout (JOB-081): light by default, dark when the system asks for it.
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3fa" },
    { media: "(prefers-color-scheme: dark)", color: "#14121b" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = preferredLocale(null, (await cookies()).get(localeCookieName)?.value);
  const language = documentLanguage(locale);
  return (
    <html lang={language} data-ui="new" suppressHydrationWarning>
      <head>
        {/* Sets the document language from the locale route before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: documentLanguageBootstrapScript }} />
      </head>
      <body>
        <OfflineServiceWorkerRegistration />
        <SessionRefresher />
        {children}
        <Suspense fallback={null}><FeedbackWidget fallbackLocale={locale} /></Suspense>
      </body>
    </html>
  );
}
