import { describe, expect, it } from "vitest";
import { feedbackWorkerConfiguration } from "../../../scripts/run-feedback-worker";

describe("feedback worker CLI boundary", () => {
  it("defaults reviewer off and accepts only explicit true without exposing configuration", () => {
    const env = { NODE_ENV: "test" as const, DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1/test" };
    expect(feedbackWorkerConfiguration(env)).toMatchObject({ triageEnabled: false, githubToken: undefined, githubRepository: undefined });
    expect(feedbackWorkerConfiguration({ ...env, STARDUST_FEEDBACK_REPOSITORY: "synthetic-owner/stardust-feedback" }).githubRepository)
      .toBe("synthetic-owner/stardust-feedback");
    expect(feedbackWorkerConfiguration({ ...env, STARDUST_FEEDBACK_TRIAGE_ENABLED: "true" }).triageEnabled).toBe(true);
    expect(feedbackWorkerConfiguration({ ...env, STARDUST_FEEDBACK_TRIAGE_ENABLED: "1" }).triageEnabled).toBe(false);
    expect(() => feedbackWorkerConfiguration({ NODE_ENV: "test", DATABASE_URL: "https://example.test" })).toThrow("feedback_database_unconfigured");
  });
});
