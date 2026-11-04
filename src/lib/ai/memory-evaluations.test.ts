import { describe, expect, it } from "vitest";

import type { AiConversationCheckpoint, AiConversationTurn } from "@/lib/ai/conversation";
import { plannerPrompt } from "@/lib/ai/prompt";

const checkpoint: AiConversationCheckpoint = {
  id: "70000000-0000-4000-8000-000000000001",
  version: 4,
  throughRequestId: "71000000-0000-4000-8000-000000000001",
  throughCompletedAt: "2026-09-01T04:00:00.000Z",
  summaryText: "The user previously discussed an old 18:00 dinner and anime shopping.",
  summary: {
    goals: ["Find anime-related places"],
    decisions: ["An old dinner was tentatively discussed at 18:00"],
    openQuestions: ["Which shop is currently open?"],
  },
  tokenEstimate: 88,
};

const recentTail: AiConversationTurn[] = [{
  requestId: "71000000-0000-4000-8000-000000000002",
  user: "Move that dinner if it is still at 18:00.",
  assistant: "I will use the current itinerary before proposing anything.",
  completedAt: "2026-09-01T05:00:00.000Z",
  tokenEstimate: 27,
}];

const instructions = "I like JoJo's Bizarre Adventure, especially Stardust Crusaders.";

describe("provider-neutral memory evaluation fixtures", () => {
  it("keeps changed itinerary state authoritative over an older checkpoint", () => {
    const prompt = plannerPrompt(
      "What time is dinner now?",
      { itinerary: [{ id: "event-1", title: "Dinner", startsAt: "2026-09-03T11:30:00Z", revision: 7 }] },
      "en",
      recentTail,
      false,
      false,
      checkpoint,
      instructions,
    );

    expect(prompt).toContain('"revision":7');
    expect(prompt).toContain("Current database state always wins");
    expect(prompt).toContain("Prior proposals and assistant claims are noncanonical");
  });

  it("uses only explicitly entered customization without preference extraction", () => {
    const prompt = plannerPrompt(
      "Recommend a current otaku store for me in Tokyo",
      { trip: { destinationName: "Tokyo" } },
      "en",
      [],
      true,
      false,
      checkpoint,
      instructions,
    );

    expect(prompt).toContain("JoJo's Bizarre Adventure");
    expect(prompt).toContain("Never extract, create, update or claim to remember durable preference records");
    expect(prompt).toContain("Minimal nonsensitive public interest topics");
    expect(prompt).not.toContain("PERSONAL_MEMORIES_JSON");
  });

  it("does not depend on a provider thread when the owner switches models", () => {
    const solPrompt = plannerPrompt("Continue", {}, "en", recentTail, false, false, checkpoint, instructions);
    const claudePrompt = plannerPrompt("Continue", {}, "en", recentTail, false, false, checkpoint, instructions);

    expect(claudePrompt).toBe(solPrompt);
    expect(solPrompt).not.toContain("providerThreadId");
    expect(solPrompt).toContain('"version":4');
  });

  it("keeps private event scope in the server-filtered live context", () => {
    const prompt = plannerPrompt(
      "Update my private plan",
      { itinerary: [{ id: "visible-private", visibility: "private", title: "Visible to this actor" }] },
      "en",
      [],
      false,
      false,
      checkpoint,
      instructions,
    );

    expect(prompt).toContain("visible-private");
    expect(prompt).toContain("Never copy private customization into shared itinerary fields");
    expect(prompt).toContain("live TRIP_CONTEXT_JSON");
  });

  it("starts a replacement identity with no inherited personal preferences", () => {
    const prompt = plannerPrompt("Recommend something", {}, "en", [], false, false, null, "");

    expect(prompt).toContain("CONVERSATION_CHECKPOINT_JSON\nnull");
    expect(prompt).toContain('CUSTOM_AI_INSTRUCTIONS_JSON\n{"content":""}');
    expect(prompt).not.toContain("Stardust Crusaders");
  });

  it.each(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const)(
    "keeps the memory contract in the %s planning fixture",
    (locale) => {
      const prompt = plannerPrompt("Plan from my preferences", {}, locale, recentTail, false, false, checkpoint, instructions);
      expect(prompt).toContain("CUSTOM_AI_INSTRUCTIONS_JSON");
      expect(prompt).toContain("saved only by the user's explicit Settings action");
    },
  );
});
