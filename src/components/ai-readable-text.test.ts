import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiReadableText } from "@/components/ai-readable-text";
import { AiConversationTranscript } from "@/components/ai-conversation-page";
import type { AiConversationMessage } from "@/lib/ai/conversation-history-types";
import { aiHistoryMessages } from "@/lib/ai/history-i18n";
import { locales } from "@/lib/i18n";

const renderText = (text: string) => renderToStaticMarkup(createElement(AiReadableText, { text }));

describe("readable AI message text", () => {
  it("turns existing paragraph breaks into spaced blocks without losing list line breaks", () => {
    const markup = renderText("Restaurant suggestion.\n\n1. A cafe\n2. A garden\n\nCheck opening hours.");
    expect(markup).toBe('<div class="ai-readable-text"><p>Restaurant suggestion.</p><p>1. A cafe\n2. A garden</p><p>Check opening hours.</p></div>');
  });

  it("normalizes CRLF paragraphs and ignores whitespace-only separators", () => {
    expect(renderText("First.\r\n \t\r\nSecond.\r\n\r\n")).toBe('<div class="ai-readable-text"><p>First.</p><p>Second.</p></div>');
    expect(renderText(" \n\t\n ")).toBe('<div class="ai-readable-text"></div>');
  });

  it("retains long URLs, code-like content and the complete answer without interpreting markup", () => {
    const address = `https://example.org/${"a".repeat(400)}`;
    const markup = renderText(`<script>alert(1)</script>\n\n${address}\n\n\`\`\`\nconst value = 1;\n\`\`\`\n\nFinal line.`);
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<a ");
    expect(markup).toContain(address);
    expect(markup).toContain("```\nconst value = 1;\n```");
    expect(markup).toContain("<p>Final line.</p>");
  });

  it.each(locales)("uses the same readable paragraphs for both sides of %s history", (locale) => {
    const turn: AiConversationMessage = {
      requestId: "synthetic-request", clientRequestId: null, conversationId: "synthetic-chat",
      prompt: "附近餐廳\n\n営業日を確認", message: "A suggestion.\n\nPlease confirm before travelling.",
      model: "gpt-6.1-sol", status: "succeeded", createdAt: "2030-04-01T00:00:00Z", completedAt: "2030-04-01T00:01:00Z",
      errorCode: null, result: null,
    };
    const markup = renderToStaticMarkup(createElement(AiConversationTranscript, {
      turns: [turn], locale, timeZone: "Asia/Tokyo", messages: aiHistoryMessages(locale),
    }));
    expect(markup.match(/class="ai-readable-text"/gu)).toHaveLength(2);
    expect(markup).toContain("<p>附近餐廳</p><p>営業日を確認</p>");
    expect(markup).toContain("<p>A suggestion.</p><p>Please confirm before travelling.</p>");
  });

  it("gives answers readable scalable type, safe wrapping and unclipped paragraph blocks", () => {
    const css = readFileSync(new URL("./ai-readability.css", import.meta.url), "utf8");
    expect(css).toContain("font-size: 1rem;");
    expect(css).toContain("font-size: 1.0625rem;");
    expect(css).toContain("line-height: 1.75;");
    expect(css).toContain("max-width: 72ch;");
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).toContain("white-space: pre-wrap;");
    expect(css).toContain("margin-top: 1em;");
    expect(css).not.toMatch(/line-clamp|overflow:\s*hidden|white-space:\s*nowrap|max-height/iu);
  });

  it("keeps phone typing at 16px and provides 44px submit and source targets", () => {
    const css = readFileSync(new URL("./ai-readability.css", import.meta.url), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
    expect(mobile).toContain(".ai-card .ai-input textarea");
    expect(mobile).toContain("font-size: 1rem;");
    expect(mobile).toContain("padding-right: 64px;");
    expect(mobile).toContain("width: 44px;");
    expect(mobile).toContain("height: 44px;");
    expect(mobile).toContain("min-height: 44px;");
    const history = readFileSync(new URL("./ai-conversation-page.css", import.meta.url), "utf8");
    expect(history).toContain("overflow-y: auto;");
    expect(history).toContain(".ai-message-sources li { min-width: 0; max-width: 100%; }");
  });
});
