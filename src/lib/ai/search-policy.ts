export const liveSearchIntents = ["required", "disabled", "not_requested"] as const;

export type LiveSearchIntent = (typeof liveSearchIntents)[number];

const englishSearchNegation = /\b(?:(?:do\s+not|don't|dont|never|no\s+need\s+to|stop)\s+(?:(?:use|using)\s+)?|without\s+(?:(?:use|using)\s+)?)(?:(?:live|web|online|internet)\s+)*(?:search(?:ing)?(?:\s+(?:the\s+)?(?:web|internet))?|brows(?:e|ing)(?:\s+(?:the\s+)?(?:web|internet))?|look(?:ing)?\s+(?:it|this|that|them|those)?\s*up)\b|\b(?:(?:do\s+not|don't|dont|never|no\s+need\s+to|without)\s+(?:(?:use|using)\s+)?|no\s+)google\s*maps?\b|\bno\s+(?:live\s+)?web\s+search\b|\b(?:web\s+)?search\s+(?:is\s+)?not\s+(?:needed|required)\b/iu;
const englishSearchChannelNegation = /\b(?:do\s+not|don't|dont|never|stop)\s+(?:use|using)\s+(?:the\s+)?(?:web|internet|online)(?:\s+search)?\b|\bno\s+need\s+for\s+(?:(?:live|web|internet|online)\s+)*(?:search|browsing)\b/iu;
const chineseSearchNegation = /(?:唔好|不要|別|别|毋須|毋须|無需|无需|不用|唔使)\s*(?:(?:上網|上网|用(?:網絡|网络|網路|网路|web|google))?\s*(?:搵|找|查|搜尋|搜索|檢索|检索)|(?:用)?\s*google\s*(?:地圖|地图))/iu;
const japaneseSearchNegation = /(?:(?:ウェブ|web|ネット|インターネット)(?:で)?(?:検索|調べる)?(?:は)?不要|(?:検索|調べ)(?:しないで|なくて(?:いい|よい)|る必要(?:は)?ない|不要)|(?:google|グーグル)\s*マップ(?:を)?使わないで)/iu;

const englishExplicitLookup = /(?:^|[.!?]\s*)(?:(?:please|you|you\s+should|can\s+you|could\s+you|would\s+you)\s+)?(?:actually\s+)?(?:search(?:\s+(?:the\s+)?(?:web|internet))?(?:\s+for)?\s+(?:it|this|that|them|those)|look\s+(?:it|this|that|them|those)\s+up|browse(?:\s+(?:the\s+)?(?:web|internet))?\s+for\s+(?:it|this|that|them|those))\b|\bi\s+(?:want|need)\s+you\s+to\s+(?:search|look\s+up|browse)\b|\btry\s+(?:searching(?:\s+(?:the\s+)?web)?(?:\s+for)?\s+(?:it|this|that|them|those)|looking\s+(?:it|this|that|them|those)\s+up)\b|\b(?:use|try)\s+(?:the\s+)?(?:live\s+)?(?:web|internet|online)\s+search\b|\b(?:search|browse)\s+(?:the\s+)?(?:web|internet)\b/iu;
const chineseExplicitLookup = /(?:(?:你|請|请|請你|请你|幫我|帮我)?\s*(?:上網|上网)(?:幫我|帮我)?\s*(?:搵|找|查|搜尋|搜索)(?:下|吓|一下)?(?:佢|它|這個|这个|呢個|嗰個|那个)?|(?:你|請|请|請你|请你|幫我|帮我)\s*(?:搵|找|查|搜尋|搜索)(?:下|吓|一下)?(?:佢|它|這個|这个|呢個|嗰個|那个)|(?:^|[。！？!?]\s*)(?:搵|找|查|搜尋|搜索)(?:下|吓|一下)(?:佢|它|這個|这个|呢個|嗰個|那个)?)/u;
const japaneseExplicitLookup = /(?:(?:それ|これ|あれ)(?:を)?(?:(?:ウェブ|web|ネット|インターネット)(?:で)?)?(?:検索して|調べて)|(?:ウェブ|web|ネット|インターネット)(?:で)?(?:検索|調べ)(?:して|て)(?:ください|下さい|くれ|お願い)?)/iu;

const englishSearchOnlyFollowup = /^(?:(?:please|you|you\s+should|can\s+you|could\s+you|would\s+you)\s+)?(?:actually\s+)?(?:search(?:\s+(?:the\s+)?(?:web|internet))?(?:\s+for)?\s+(?:it|this|that|them|those)(?:\s+online)?|look\s+(?:it|this|that|them|those)\s+up(?:\s+online)?|browse(?:\s+(?:the\s+)?(?:web|internet))?\s+for\s+(?:it|this|that|them|those)|(?:use|try)\s+(?:the\s+)?(?:live\s+)?(?:web|internet|online)\s+search|(?:search|browse)\s+(?:the\s+)?(?:web|internet))$/iu;
const englishRequestedSearchOnlyFollowup = /^i\s+(?:want|need)\s+you\s+to\s+(?:search(?:\s+for)?\s+(?:it|this|that|them|those)|look\s+(?:it|this|that|them|those)\s+up|browse\s+for\s+(?:it|this|that|them|those))$/iu;
const englishTrySearchOnlyFollowup = /^try\s+(?:searching(?:\s+(?:the\s+)?web)?(?:\s+for)?\s+(?:it|this|that|them|those)|looking\s+(?:it|this|that|them|those)\s+up)$/iu;
const chineseSearchOnlyFollowup = /^(?:(?:你|請|请|請你|请你|幫我|帮我)?\s*(?:上網|上网)(?:幫我|帮我)?\s*(?:搵|找|查|搜尋|搜索)(?:下|吓|一下)?(?:佢|它|這個|这个|呢個|嗰個|那个)?|(?:你|請|请|請你|请你|幫我|帮我)?\s*(?:搵|找|查|搜尋|搜索)(?:下|吓|一下)(?:佢|它|這個|这个|呢個|嗰個|那个)?)$/u;
const japaneseSearchOnlyFollowup = /^(?:(?:それ|これ|あれ)(?:を)?(?:(?:ウェブ|web|ネット|インターネット)(?:で)?)?(?:検索して|調べて)(?:ください|下さい)?|(?:ウェブ|web|ネット|インターネット)(?:で)?(?:検索|調べ)(?:して|て)(?:ください|下さい|くれ|お願い)?)$/iu;

const explicitMapsRequest = /\bgoogle\s*maps?\b|google\s*地圖|google\s*地图|グーグル\s*マップ/iu;
// Receipt headings/buttons such as 予約確認 and 予約内容を確認する are
// supplied data, not a request for live research. Require request wording.
// "Check-in"/"checkout" is booking vocabulary, never a request to check something.
const discoveryLanguage = /\b(find|search|look\s*up|recommend|suggest|near|nearby|around|verify|validate|compare|check(?![\s-]*(?:in|out)\b))\b|\bstill\s+open\b|搵|找|搜尋|搜索|推薦|推介|附近|查下|查詢|比較|驗證|核實|仲開|探して|探す|検索(?:して|する|したい|を?お願い)|おすすめ|近く|調べて|確認(?:して|したい|を(?:お願い|頼))|比較|営業/u;
// A pasted confirmation is a run of short "Label: value" or "Label:" lines (Hotel name:, Check-in:,
// 查詢編號：). Those labels are supplied data, so only the remaining free text can imply a lookup.
const labelLine = /^[^\S\n]*([^\n:：]{1,32})[:：][^\n]{0,100}$/gmu;

function freeTextOnly(normalized: string): string {
  return normalized.replace(labelLine, (line, label: string) => (label.trim().split(/\s+/u).length <= 4 ? "" : line));
}
const placeLanguage = /\b(place|restaurants?|cafes?|cafés?|hotels?|attractions?|afternoon\s*tea|bars?|shops?|venues?|ratings?|stars?|open|hours?|dinner|lunch|meals?)\b|地方|餐廳|餐馆|咖啡|下午茶|酒店|旅館|景點|景点|評分|评分|星級|星级|營業|营业|開門|开门|晚餐|午餐|レストラン|カフェ|ホテル|観光|店|評価|営業時間|夕食|昼食/u;

/**
 * Classifies only the current request. A required result enables public lookup;
 * it never re-authorizes a mutation mentioned only in conversation history.
 */
export function getLiveSearchIntent(prompt: string): LiveSearchIntent {
  const normalized = prompt.normalize("NFKC").toLocaleLowerCase();

  if (englishSearchNegation.test(normalized)
      || englishSearchChannelNegation.test(normalized)
      || chineseSearchNegation.test(normalized)
      || japaneseSearchNegation.test(normalized)) {
    return "disabled";
  }

  if (englishExplicitLookup.test(normalized)
      || chineseExplicitLookup.test(normalized)
      || japaneseExplicitLookup.test(normalized)
      || explicitMapsRequest.test(normalized)) {
    return "required";
  }

  const freeText = freeTextOnly(normalized);
  if (discoveryLanguage.test(freeText) && placeLanguage.test(freeText)) {
    return "required";
  }

  return "not_requested";
}

export function requiresLivePlaceSearch(prompt: string): boolean {
  return getLiveSearchIntent(prompt) === "required";
}

/**
 * Identifies a whole-request lookup continuation that carries no mutation
 * authority of its own. Callers can require a zero-proposal response so an old
 * create, expense, update, cancellation, approval, or sharing request is not
 * replayed from conversation history.
 */
export function isSearchOnlyFollowup(prompt: string): boolean {
  const normalized = prompt.normalize("NFKC").toLocaleLowerCase().trim();
  if (normalized.length === 0 || normalized.length > 120) return false;
  const withoutTrailingPunctuation = normalized.replace(/[.!?。！？]+$/u, "").trim();
  return englishSearchOnlyFollowup.test(withoutTrailingPunctuation)
    || englishRequestedSearchOnlyFollowup.test(withoutTrailingPunctuation)
    || englishTrySearchOnlyFollowup.test(withoutTrailingPunctuation)
    || chineseSearchOnlyFollowup.test(withoutTrailingPunctuation)
    || japaneseSearchOnlyFollowup.test(withoutTrailingPunctuation);
}
