import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiImagePicker } from "@/components/ai-image-picker";
import { aiImageMessages } from "@/lib/ai/image-i18n";
import { locales } from "@/lib/i18n";

describe("localized private picture composer", () => {
  it.each(locales)("renders %s file selection, approval notice and accessible removal", (locale) => {
    const copy = aiImageMessages(locale);
    const markup = renderToStaticMarkup(createElement(AiImagePicker, {
      locale, disabled: false, preparing: false, error: null, add: vi.fn(), remove: vi.fn(),
      images: [{ id: "synthetic", previewUrl: "blob:synthetic", width: 300, height: 200, input: { mediaType: "image/jpeg", data: "not-rendered" } }],
    }));
    expect(markup).toContain(copy.add); expect(markup).toContain(copy.safety);
    expect(markup).toContain('accept="image/jpeg,image/png,image/webp"'); expect(markup).toContain('multiple=""');
    expect(markup).toContain(`aria-label="${copy.remove} 1"`);
    expect(markup).toContain('src="blob:synthetic"'); expect(markup).not.toContain("not-rendered");
    expect(markup).not.toContain("/_next/image");
  });
  it.each(locales)("renders %s preparation and image errors without provider diagnostics", (locale) => {
    const copy = aiImageMessages(locale);
    const markup = renderToStaticMarkup(createElement(AiImagePicker, { locale, disabled: false, preparing: true, error: "format", images: [], add: vi.fn(), remove: vi.fn() }));
    expect(markup).toContain(copy.preparing); expect(markup).toContain(copy.format);
    expect(markup).toContain('aria-busy="true"'); expect(markup).toContain('role="alert"');
    expect(markup).toContain('disabled=""');
  });
  it("uses neutral safety and money copy in both Cantonese modes", () => {
    expect(aiImageMessages("zh-HK-lihkg")).toEqual(aiImageMessages("zh-HK"));
  });
  it("wires both composers to one scoped draft with explicit send and safe lifecycle cleanup", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(shell.match(/imagePicker=\{\{ \.\.\.aiImages, locale \}\}/g)).toHaveLength(2);
    expect(shell).toContain('readOnly={purpose === "preferences"}');
    expect(shell).toContain('conversationId === undefined || purpose === "preferences") return;');
    expect(shell).toContain('{imagePicker ?');
    expect(shell).toContain("useAiImageDraft(aiScope)");
    expect(shell).toContain("aiImages.images.map((image) => image.input)");
    expect(shell).toContain("aiImages.preparing || conversationId === undefined");
    expect(shell).toContain("aiRequestDeliveryTimeoutMs(Boolean(input.images?.length))");
    expect(shell).toMatch(/completed: \(\) => \{\s*setAiPrompt\(""\);\s*clearAiImages\(\);/);
    expect(shell).toMatch(/client\?\.reset\(\);\s*setAiPrompt\(""\);\s*clearAiImages\(\);/);
    expect(shell).toContain("if (status === 401 || status === 403) clearAiImages();");
  });
});
