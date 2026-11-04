import { describe, expect, it } from "vitest";
import { privacyNoticeUrl } from "@/lib/app/privacy-notice";

describe("privacy notice link", () => {
  it("links only to an https notice", () => {
    expect(privacyNoticeUrl({ PRIVACY_NOTICE_URL: " https://example.test/privacy " })).toBe("https://example.test/privacy");
    for (const value of [undefined, "", "http://example.test/privacy", "javascript:alert(1)", "/privacy", "https://user:secret@example.test/x", "not a url"]) {
      expect(privacyNoticeUrl({ PRIVACY_NOTICE_URL: value }), String(value)).toBeNull();
    }
  });
});
