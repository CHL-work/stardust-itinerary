import { describe, expect, it } from "vitest";

import { documentLanguageBootstrapScript } from "@/lib/document-language-bootstrap";

function run(pathname: string) {
  const attributes = new Map<string, string>();
  const documentElement = { lang: "zh-HK", setAttribute: (name: string, value: string) => { attributes.set(name, value); } };
  new Function("document", "location", documentLanguageBootstrapScript)({ documentElement }, { pathname });
  return { lang: documentElement.lang, attributes };
}

describe("document language bootstrap", () => {
  it.each([
    ["/en", "en"], ["/ja-JP", "ja-JP"], ["/zh-HK", "zh-HK"], ["/zh-HK-lihkg", "zh-HK"], ["/auth/sign-in", "zh-HK"], ["/", "zh-HK"],
  ])("sets the document language for %s before paint", (pathname, lang) => {
    expect(run(pathname).lang).toBe(lang);
  });

  it("leaves the one layout alone and reads no stored preference (JOB-081)", () => {
    expect(run("/en").attributes.size).toBe(0);
    expect(documentLanguageBootstrapScript).not.toContain("data-ui");
    expect(documentLanguageBootstrapScript).not.toContain("localStorage");
  });
});
