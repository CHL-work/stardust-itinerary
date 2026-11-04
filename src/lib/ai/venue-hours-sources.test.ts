import { describe, expect, it } from "vitest";
import { sanitizeKnownPublicArticleSource, sanitizeVenueHoursSource } from "@/lib/ai/venue-hours-sources";

describe("exact official public article locators", () => {
  it.each(["the-chara.com", "www.the-chara.com"])("preserves a public post on %s while stripping tracking and fragments", (host) => {
    const canonical = `https://${host}/blog/?p=119155`;
    for (const raw of [canonical, `${canonical}&utm_source=search&utm_medium=web#hours`, `https://${host}/blog/?tracking=campaign&p=119155&fbclid=opaque-tracking`]) {
      expect(sanitizeKnownPublicArticleSource(raw)).toBe(canonical);
      expect(sanitizeVenueHoursSource(raw)).toBe(canonical);
    }
  });
  it.each(["1", "119155", "9999999"])("retains only a bounded positive public post ID %s", (postId) => {
    expect(sanitizeKnownPublicArticleSource(`https://www.the-chara.com/blog/?p=${postId}`)).toBe(`https://www.the-chara.com/blog/?p=${postId}`);
  });
  it.each([
    "p=0", "p=-1", "p=00119155", "p=11915500", "p=1.2", "p=１２３", "p=", "P=119155", "p[]=119155",
    "p=119155&p=119155", "p=119155&p=119156", "p=119155&%70=119155", "p=119155&preview=true",
    "p=119155&access_token=secret", "p=119155&token=secret", "p=119155&session=secret", "p=119155&nonce=secret",
    "p=119155&member=someone", "p=119155&booking=12345", "p=119155&redirect=https%3A%2F%2Fother.example",
    "p=119155&unknown=value", "p=119155&utm_source=traveler%40example.test", "p=119155&tracking=123456789",
  ])("rejects ambiguous/private/non-article query %s rather than stripping it into public evidence", (query) => {
    const raw = `https://www.the-chara.com/blog/?${query}`;
    expect(sanitizeKnownPublicArticleSource(raw)).toBeNull(); expect(sanitizeVenueHoursSource(raw)).toBeNull();
  });
  it.each([
    "http://www.the-chara.com/blog/?p=119155", "https://user:secret@www.the-chara.com/blog/?p=119155",
    "https://www.the-chara.com:8443/blog/?p=119155", "https://other.example/blog/?p=119155",
    "https://the-chara.com.evil.test/blog/?p=119155", "https://private.the-chara.com/blog/?p=119155",
    "https://www.the-chara.com/account/?p=119155", "https://www.the-chara.com/blog/preview/?p=119155",
    "https://www.the-chara.com/blog?p=119155", "https://www.the-chara.com/?p=119155", "https://www.the-chara.com/blog/",
  ])("does not widen the article exception to another host, path, transport or identity: %s", (raw) => {
    expect(sanitizeKnownPublicArticleSource(raw)).toBeNull();
  });
  it("does not widen existing private URL exceptions or emit oversized tracking input", () => {
    expect(sanitizeVenueHoursSource("https://www.the-chara.com/reserves/12345678/complete?p=119155")).toBeNull();
    expect(sanitizeVenueHoursSource(`https://www.the-chara.com/blog/?p=119155&utm_source=${"x".repeat(2000)}`)).toBeNull();
    expect(sanitizeKnownPublicArticleSource("not a URL")).toBeNull();
  });
});

describe("public hours source URLs", () => {
  it.each(["", "en/", "tw/", "cn/", "kr/"])("permits the exact public numeric restaurant landing path %s", (locale) => {
    const url = `https://tabelog.com/${locale}tokyo/A1310/A131001/13000379/`;
    expect(sanitizeVenueHoursSource(`${url}?tracking=private-value#fragment`)).toBe(url);
  });
  it.each([
    "https://tabelog.com/reservations/13000379/complete", "https://tabelog.com/account/13000379/",
    "https://tabelog.com/tokyo/A1310/A131001/13000379/booking", "https://fake.tabelog.com/tokyo/A1310/A131001/13000379/",
    "https://tabelog.com.evil.test/tokyo/A1310/A131001/13000379/", "https://user:secret@tabelog.com/tokyo/A1310/A131001/13000379/",
    "https://localhost/13000379/", "https://other.example/13000379/", "http://tabelog.com/tokyo/A1310/A131001/13000379/",
  ])("keeps private/unrelated numeric URLs blocked: %s", (url) => {
    expect(sanitizeVenueHoursSource(url)).toBeNull();
  });
  it("retains ordinary official sources and strips credential parameters", () => {
    expect(sanitizeVenueHoursSource("https://restaurant.example/hours?access_token=secret"))
      .toBe("https://restaurant.example/hours");
  });
});
