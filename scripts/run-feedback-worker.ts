import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { runFeedbackWorker } from "../src/lib/feedback/worker";

export function feedbackWorkerConfiguration(env: NodeJS.ProcessEnv) {
  const connectionString = env.DATABASE_DIRECT_URL ?? env.DATABASE_URL;
  if (!connectionString) throw new Error("feedback_database_unconfigured");
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("feedback_database_unconfigured");
  return { connectionString, triageEnabled: env.STARDUST_FEEDBACK_TRIAGE_ENABLED === "true",
    githubToken: env.STARDUST_FEEDBACK_GITHUB_TOKEN };
}
export async function feedbackWorkerMain() {
  if (process.argv.length > 2) throw new Error("feedback_arguments_invalid");
  const config = feedbackWorkerConfiguration(process.env);
  const pool = new Pool({ connectionString: config.connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15_000 });
  try {
    const result = await runFeedbackWorker(pool, config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.triage === "failed") process.exitCode = 1;
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  feedbackWorkerMain().catch(() => { process.stderr.write("Feedback worker failed safely; inspect private operator status.\n"); process.exitCode = 1; });
}
