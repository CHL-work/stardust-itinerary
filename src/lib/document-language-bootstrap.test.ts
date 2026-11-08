import { describe, expect, it } from "vitest";

import { documentLanguageBootstrapScript } from "@/lib/document-language-bootstrap";

function run(pathname: string, search = "") {
  const attributes = new Map<string, string>();
  const documentElement = { lang: "en", setAttribute: (name: string, value: string) => { attributes.set(name, value); } };
  new Function("document", "location", documentLanguageBootstrapScript)({ documentElement }, { pathname, search });
  return { lang: documentElement.lang, attributes };
}

describe("document language bootstrap", () => {
  it.each([
    ["/en", "en"], ["/ja-JP", "ja-JP"], ["/zh-HK", "zh-HK"], ["/zh-HK-lihkg", "zh-HK"], ["/auth/sign-in", "en"], ["/", "en"],
    ["/zh-CN", "zh-CN"], ["/zh-TW", "zh-TW"], ["/es", "es"], ["/pt-BR", "pt-BR"], ["/fr", "fr"], ["/de", "de"], ["/ru", "ru"], ["/id", "id"],
  ])("sets the document language for %s before paint", (pathname, lang) => {
    expect(run(pathname).lang).toBe(lang);
  });

  it("leaves the one layout alone and reads no stored preference (JOB-081)", () => {
    expect(run("/en").attributes.size).toBe(0);
    expect(documentLanguageBootstrapScript).not.toContain("data-ui");
    expect(documentLanguageBootstrapScript).not.toContain("localStorage");
  });
  it("uses validated creation-page query language before paint, without overriding a locale path", () => {
    expect(run("/trips/new", "?locale=ja-JP").lang).toBe("ja-JP");
    expect(run("/trips/new", "?locale=not-a-locale").lang).toBe("en");
    expect(run("/en", "?locale=ja-JP").lang).toBe("en");
  });
});
