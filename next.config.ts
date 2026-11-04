import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk"],
};

export default nextConfig;
