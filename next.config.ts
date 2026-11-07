import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk"],
  turbopack: {
    resolveAlias: {
      // Browser code gets an empty language-pack store; pages send only their own language's pack (JOB-085, D-097).
      "@/lib/locale-packs/store": { browser: "./src/lib/locale-packs/store.browser.ts" },
    },
  },
};

export default nextConfig;
