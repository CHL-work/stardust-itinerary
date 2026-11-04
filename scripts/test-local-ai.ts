import process from "node:process";
import { Pool } from "pg";

import { runAiPlanner } from "../src/lib/ai/planner";
import { ownerModels, type OwnerModel } from "../src/lib/app/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment variables may already be provided by the caller.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Configure ignored .env.local first.");
}

const requested = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "gpt-6.1-sol";
const requireWebSearch = process.argv.includes("--require-web-search");
const prompt = process.argv.slice(2).find((argument) => argument.startsWith("--prompt="))?.slice("--prompt=".length)
  ?? (requireWebSearch
    ? "Use live web search to find the official Google Maps or official venue page for a highly rated afternoon tea near Tokyo Station. Recommend one verified option, include the source URL, and do not propose any itinerary change."
    : "Summarize the current itinerary in one short sentence. Do not propose any change.");
if (!ownerModels.includes(requested as OwnerModel)) {
  throw new Error(`Model must be one of: ${ownerModels.join(", ")}`);
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  const result = await pool.query<{
    trip_id: string;
    member_id: string;
    user_id: string;
    display_name: string;
  }>(
    `SELECT tm.trip_id, tm.id AS member_id, tm.user_id, tm.display_name
       FROM trip_members tm
      WHERE tm.role = 'owner' AND tm.status = 'active' AND tm.user_id IS NOT NULL
      ORDER BY tm.created_at LIMIT 1`,
  );
  const owner = result.rows[0];
  if (!owner) throw new Error("No active local owner fixture was found.");

  const response = await runAiPlanner(
    pool,
    {
      sessionId: "local-ai-smoke",
      tripId: owner.trip_id,
      memberId: owner.member_id,
      userId: owner.user_id,
      role: "owner",
      expiresAt: new Date(Date.now() + 60_000),
      absoluteExpiresAt: new Date(Date.now() + 60_000),
      displayName: owner.display_name,
      issuer: "local-smoke",
      subject: "local-smoke",
      generation: 1,
    },
    prompt,
    requested as OwnerModel,
  );
  if (requireWebSearch && !response.webSearch.performed) {
    throw new Error("AI local web-search smoke failed: no provider web-search tool call was recorded.");
  }
  if (requireWebSearch && response.proposalId !== null) {
    throw new Error("AI local web-search smoke failed: the read-only research prompt created a proposal.");
  }
  console.log(`AI local smoke passed: ${response.model}; request ${response.requestId}; proposal ${response.proposalId ?? "none"}.`);
  if (requireWebSearch) {
    console.log(`Web search passed: ${response.webSearch.queryCount} provider tool call(s); ${response.webSearch.sources.length} public source URL(s).`);
  }
  console.log(response.message);
} finally {
  await pool.end();
}
