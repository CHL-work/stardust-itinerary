import type { Metadata, Viewport } from "next";

import { OfflineServiceWorkerRegistration } from "@/components/offline-service-worker";
import { SessionRefresher } from "@/components/session-refresher";
import { FeedbackWidget } from "@/components/feedback-widget";
import { UiModeSync } from "@/components/new-ui/ui-mode-sync";
import { uiModeBootstrapScript } from "@/lib/ui-mode";

import "./globals.css";
import "./new-ui/layout-toggle.css";
import "./new-ui/base.css";
import "./new-ui/shell.css";
import "./new-ui/today.css";
import "./new-ui/expenses.css";
import "./new-ui/ai-settings.css";

export const metadata: Metadata = {
  title: {
    default: "星塵遠征軍",
    template: "%s · 星塵遠征軍",
  },
  description: "A private group trip planner for a very small expedition party.",
};

// theme-color is rendered by UiModeSync so it follows the chosen layout and system theme.
export const viewport: Viewport = {
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-HK" suppressHydrationWarning>
      <head>
        {/* JOB-048: apply the device's stored layout before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: uiModeBootstrapScript }} />
      </head>
      <body>
        <OfflineServiceWorkerRegistration />
        <SessionRefresher />
        <UiModeSync />
        {children}
        <FeedbackWidget />
      </body>
    </html>
  );
}
