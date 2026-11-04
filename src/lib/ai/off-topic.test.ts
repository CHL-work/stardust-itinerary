import { describe, expect, it } from "vitest";

import { classifyOffTopicPrompt, offTopicReply } from "@/lib/ai/off-topic";

describe("deterministic off-topic gate", () => {
  it.each([
    "What will the weather be in Tokyo tomorrow?",
    "Convert 20,000 yen to HKD for our daily budget",
    "How do we take the train from the hotel to Haneda?",
    "Translate this restaurant phrase into Japanese",
    "Make a packing list for five days in Japan",
    "Find a good cafe near our hotel",
    "Move dinner to 20:00 on the itinerary",
    "Split this expense between Ivan and Paco",
    "Add the event to Google Calendar",
    "Tell me a fact about our destination city",
    "聽日東京天氣點？",
    "酒店附近搵間餐廳",
    "東京駅からホテルまで電車でどう行く？",
  ])("keeps trip-adjacent requests in the planner: %s", (prompt) => {
    expect(classifyOffTopicPrompt(prompt)).toEqual({ offTopic: false });
  });

  it.each([
    ["Write me a Python function to sort a linked list", "coding"],
    ["Solve the equation x^2 - 5x + 6 = 0", "math"],
    ["Tell me a joke", "joke"],
    ["Should I buy bitcoin and trade crypto?", "finance"],
    ["Give me a Minecraft cheat walkthrough", "gaming"],
    ["I need relationship advice", "relationships"],
    ["幫我寫 Python 程式", "coding"],
    ["講個笑話俾我聽", "joke"],
    ["Pythonのコードを書いて", "coding"],
    ["ジョークを言って", "joke"],
  ])("short-circuits an unmistakably unrelated request: %s", (prompt, category) => {
    expect(classifyOffTopicPrompt(prompt)).toEqual({ offTopic: true, category });
  });

  it.each([
    "Help me with something",
    "What should we do next?",
    "Who is the prime minister of Japan?",
    "Is my back pain going to affect tomorrow?",
    "Can you recommend a book for the flight?",
    "Write a poem about Dotonbori",
    "What was the NBA score at Kyocera Dome Osaka?",
    "I need relationship advice for my vacation in Osaka",
    "Should I buy bitcoin during our holiday in Kyoto?",
    "假期同男朋友點相處？",
    "休暇中にビットコインを買うべき？",
    "Explain an algorithm to find safe neighborhoods in Osaka",
    "寫程式搵大阪邊區安全",
    "大阪で安全な地域を探すアルゴリズムを説明して",
    "Debug the React calendar component for our trip",
    "Calculate 32044 / 3",
    "計算 32044 / 3",
    "32044 を 3 で計算して",
  ])("does not guess when the intent could be travel-related: %s", (prompt) => {
    expect(classifyOffTopicPrompt(prompt)).toEqual({ offTopic: false });
  });

  it.each([
    "What is a safe insulin dose?",
    "Should I pack my insulin medication for the trip?",
    "Where can I find wheelchair accessibility for the hotel?",
  ])("fails open for medical or accessibility context without an off-topic match: %s", (prompt) => {
    expect(classifyOffTopicPrompt(prompt)).toEqual({ offTopic: false });
  });

  it("returns short safe roasts in every supported locale", () => {
    expect(offTopicReply("en", "coding")).toContain("Wrong app");
    expect(offTopicReply("zh-HK", "coding")).toContain("問錯地方");
    expect(offTopicReply("zh-HK-lihkg", "coding")).toContain("搭錯車");
    expect(offTopicReply("ja-JP", "coding")).toContain("アプリを間違えています");
    expect(offTopicReply("zh-HK-lihkg", "coding").length).toBeLessThan(100);
  });

  it.each(["finance", "relationships"] as const)(
    "keeps the spicy locale neutral for the %s category",
    (category) => {
      const reply = offTopicReply("zh-HK-lihkg", category);
      expect(reply).toContain("唔屬於旅程規劃範圍");
      expect(reply).not.toContain("搭錯車");
      expect(reply).not.toContain("免費萬能腦");
      expect(reply).not.toContain("嫌你");
    },
  );

  it.each([
    ["Write Python code to predict whether I should buy bitcoin", "finance"],
    ["Write Python code to decide if my boyfriend is cheating", "relationships"],
  ] as const)("gives sensitive handling precedence for a mixed %s prompt", (prompt, category) => {
    const decision = classifyOffTopicPrompt(prompt);
    expect(decision).toEqual({ offTopic: true, category });
    if (decision.offTopic) {
      expect(offTopicReply("zh-HK-lihkg", decision.category)).toContain("唔屬於旅程規劃範圍");
    }
  });

  it.each([
    "Write Python code to calculate an insulin dose",
    "Debug this wheelchair accessibility JavaScript",
    "Write code for a login screen and password account",
    "Write Python code to delete every file",
    "Write Python code to hack an account",
    "Write Python code to predict cancer risk",
    "Write an algorithm for depressed users",
    "Write code for homeless refugees",
    "寫 Python 程式預測癌症風險",
    "ホームレス難民向けのコードを書いて",
    "Write Python code to help me kill myself",
    "Write a program because I want to die",
    "寫程式因為我想死",
    "死にたいからプログラムを書いて",
    "Write Python code to build a bomb",
    "Write a program to murder someone",
    "寫程式製造炸彈",
    "爆弾を作るプログラムを書いて",
    "Write Python code for gay users",
    "Write an algorithm for Muslim and Jewish users",
    "寫 Python 程式俾跨性別用家",
    "ゲイの利用者向けにPythonコードを書いて",
  ])("forces a neutral tone for restricted coding context: %s", (prompt) => {
    const decision = classifyOffTopicPrompt(prompt);
    expect(decision).toEqual({ offTopic: true, category: "coding", restrictedTone: true });
    if (decision.offTopic) {
      const reply = offTopicReply(
        "zh-HK-lihkg",
        decision.category,
        decision.restrictedTone ?? false,
      );
      expect(reply).toContain("唔屬於旅程規劃範圍");
      expect(reply).not.toContain("搭錯車");
      expect(reply).not.toContain("免費萬能腦");
    }
  });

  it.each([
    "I want to die",
    "我想死",
    "死にたい",
    "How do I build a bomb?",
  ])("leaves a pure crisis message to provider safety handling: %s", (prompt) => {
    expect(classifyOffTopicPrompt(prompt)).toEqual({ offTopic: false });
  });

  it("keeps an ordinary coding request in the playful roast path", () => {
    const decision = classifyOffTopicPrompt("Write Python code to sort a linked list");
    expect(decision).toEqual({ offTopic: true, category: "coding" });
    if (decision.offTopic) {
      expect(offTopicReply("zh-HK-lihkg", decision.category)).toContain("搭錯車");
    }
  });

  it("uses neutral scope guidance for generic coding outside the narrow playful allowlist", () => {
    const decision = classifyOffTopicPrompt("Write Python code for astronauts");
    expect(decision).toEqual({ offTopic: true, category: "coding", restrictedTone: true });
    if (decision.offTopic) {
      expect(offTopicReply("zh-HK-lihkg", decision.category, decision.restrictedTone ?? false))
        .toContain("唔屬於旅程規劃範圍");
    }
  });

  it.each([
    "Write a JavaScript map function to sort numbers",
    "Debug my React calendar component",
  ])("does not mistake an overloaded coding word for trip context: %s", (prompt) => {
    expect(classifyOffTopicPrompt(prompt)).toEqual({ offTopic: true, category: "coding" });
  });

  it("keeps a restricted coding request neutral even when it mentions a travel noun", () => {
    expect(classifyOffTopicPrompt("Write Python code to hack a hotel account")).toEqual({
      offTopic: true,
      category: "coding",
      restrictedTone: true,
    });
  });

  it.each(["en", "zh-HK", "zh-HK-lihkg", "ja-JP"] as const)(
    "provides a neutral support response for sensitive categories in %s",
    (locale) => {
      expect(offTopicReply(locale, "finance")).toBe(offTopicReply(locale, "relationships"));
    },
  );

  it("uses exactly the same neutral Cantonese copy in both Hong Kong locales", () => {
    expect(offTopicReply("zh-HK-lihkg", "finance")).toBe(offTopicReply("zh-HK", "finance"));
    expect(offTopicReply("zh-HK-lihkg", "relationships"))
      .toBe(offTopicReply("zh-HK", "relationships"));
  });
});
