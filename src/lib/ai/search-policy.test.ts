import { describe, expect, it } from "vitest";

import {
  getLiveSearchIntent,
  isSearchOnlyFollowup,
  liveSearchIntents,
  requiresLivePlaceSearch,
} from "@/lib/ai/search-policy";

describe("live search policy", () => {
  it("exports the stable intent vocabulary", () => {
    expect(liveSearchIntents).toEqual(["required", "disabled", "not_requested"]);
  });

  it.each([
    "Find a restaurant near Tokyo Station",
    "Search Google Maps for afternoon tea",
    "搵酒店附近 4 星以上餐廳",
    "東京駅の近くでおすすめのカフェを探して",
    "Verify whether this hotel is still open",
    "Compare two cafes near Shinjuku",
    "查下呢間餐廳仲開唔開",
    "このホテルの営業時間を調べて",
    "このホテルの評判を確認してください",
    "レストランの料金を確認したい",
    "Check whether the hotel restaurant is open on Sunday",
    "Check if this cafe is still open",
    "Add this booking and find the hotel's address.\nHotel name: Synthetic Hotel\nCheck-in: 2030-11-29",
    "Hotel name: Synthetic Hotel\nCheck-in: 2030-11-29\n\nPlease verify the hotel is open that week.",
  ])("preserves an existing place-discovery request: %s", (prompt) => {
    expect(getLiveSearchIntent(prompt)).toBe("required");
    expect(requiresLivePlaceSearch(prompt)).toBe(true);
  });

  it.each([
    "you search for it",
    "Please actually search the web for that",
    "Look it up",
    "I want you to browse for it",
    "You should search for that",
    "Try searching for it",
    "Use live web search",
    "你上網搵下佢",
    "幫我搜尋一下這個",
    "上网查一下那个",
    "搵吓佢",
    "查一下",
    "それをネットで調べて",
    "ウェブで検索してください",
  ])("requires lookup for an explicit multilingual continuation: %s", (prompt) => {
    expect(getLiveSearchIntent(prompt)).toBe("required");
    expect(requiresLivePlaceSearch(prompt)).toBe(true);
  });

  it.each([
    "Don't search the web; just use the supplied details.",
    "Don't use web search; just use the supplied details.",
    "Do not use the web to search for this hotel.",
    "Do not use the internet to look this hotel up.",
    "No need for web search for this hotel.",
    "No need to look it up.",
    "Without browsing the internet, add the event.",
    "No web search.",
    "Don't use Google Maps.",
    "唔好上網搵，直接加落行程。",
    "不要搜尋，使用我提供的資料。",
    "唔好用 Google 地圖。",
    "ネットで検索しないでください。",
    "Google マップを使わないで。",
    "調べなくていい。",
  ])("honors an explicit search opt-out before positive language: %s", (prompt) => {
    expect(getLiveSearchIntent(prompt)).toBe("disabled");
    expect(requiresLivePlaceSearch(prompt)).toBe(false);
  });

  it.each([
    "Create dinner tomorrow at 19:00.",
    "The receipt heading says 検索 and ホテル.",
    "検索\nホテル名 Example Hotel\n到着日 2030年04月01日",
    "Review the search history.",
    "Create a hotel event from this receipt. ご予約確認 ホテル名: 架空ホテル",
    "Create a restaurant event. ご予約内容を確認する レストラン名: 架空食堂",
    "予約確認メール ホテル名: 架空ホテル 予約確認番号: SYNTHETIC",
    "Create this hotel event. 予約を確認する チェックイン: 2030年4月1日15時",
    // A pasted booking confirmation (synthetic values, same shape as a real one).
    "Hotel name:\n\nSYNTHETIC HOTEL\n\nGuest name:\n\nSynthetic Guest\n\nConfirmation #:\n\nH-SYNTHETIC0\n\nInvoice date:\n\n10/30/2030\n\nCheck-in:\n\n11/29/2030\n\nCheckout:\n\n12/06/2030\n\nYour stay:\n\n7 Nights, 1 Room",
    "Hotel name: Synthetic Hotel\nCheck-in: 2030-11-29 15:00\nCheck-out: 2030-12-06 11:00",
    "Add my hotel: check in 3pm on the 29th, check-out 11am on the 6th.",
    "Synthetic Hotel booking, checkin 15:00, checkout 11:00.",
    "酒店名稱：架空酒店\n查詢編號：SYNTHETIC\n入住日期：2030年11月29日",
  ])("does not infer a live lookup from non-imperative text: %s", (prompt) => {
    expect(getLiveSearchIntent(prompt)).toBe("not_requested");
    expect(requiresLivePlaceSearch(prompt)).toBe(false);
  });

  it("lets negation win when a prompt also contains old positive keywords", () => {
    expect(getLiveSearchIntent(
      "Don't search for a restaurant near Tokyo Station; use the place I supplied.",
    )).toBe("disabled");
  });

  it.each([
    "you search for it",
    "Search it.",
    "Search for it",
    "Please search the web for that!",
    "Look that up",
    "Look it up online",
    "I want you to search for it",
    "Try searching for it",
    "Search the web",
    "Browse the internet",
    "Use live web search",
    "你上網搵下佢",
    "搵吓佢",
    "查一下",
    "それをネットで調べて",
    "ウェブで検索してください。",
  ])("marks a whole-request public lookup continuation as search-only: %s", (prompt) => {
    expect(isSearchOnlyFollowup(prompt)).toBe(true);
  });

  it.each([
    "Search it and create an event",
    "Look it up and add an expense",
    "Search for it, then update the hotel",
    "Search it and cancel the old event",
    "Use web search, approve it, and share it",
    "搵吓佢然後加活動",
    "查一下並更新行程",
    "それを調べてイベントをキャンセルして",
    "Find a restaurant near Tokyo Station",
    "Don't search for it",
  ])("does not grant the search-only guard to a compound or different request: %s", (prompt) => {
    expect(isSearchOnlyFollowup(prompt)).toBe(false);
  });
});
