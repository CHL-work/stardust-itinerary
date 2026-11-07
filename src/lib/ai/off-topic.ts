import type { Locale } from "@/lib/i18n";
import { localizedCatalog, type BaseCatalogs } from "@/lib/locale-packs";

export type OffTopicCategory =
  | "coding"
  | "finance"
  | "gaming"
  | "joke"
  | "math"
  | "relationships";

export type OffTopicDecision =
  | { offTopic: false }
  | { offTopic: true; category: OffTopicCategory; restrictedTone?: true };

/*
 * This is intentionally an allow-biased gate. A false negative merely lets the
 * planner handle a request; a false positive would block useful travel help.
 * Keep the travel vocabulary broad and the unrelated patterns narrow.
 */
const TRIP_ADJACENT = /(?:\b(?:trip|travel|vacation|holiday|journey|getaway|itinerary|event|plan|planning|schedule|agenda|day|date|time|today|tomorrow|tonight|weather|forecast|temperature|rain|snow|safe|safety|unsafe|emergency|police|neighbou?rhood|district|currency|exchange\s*rate|money|budget|expense|cost|split|pay|paid|owe|yen|jpy|usd|hkd|transit|transport|train|rail|metro|subway|bus|taxi|uber|flight|airline|airport|station|route|direction|translate|translation|language|phrase|pack|packing|luggage|baggage|suitcase|bag|restaurant|cafe|food|meal|breakfast|lunch|dinner|hotel|hostel|accommodation|booking|reservation|calendar|destination|country|city|tokyo|japan|hong\s*kong|map|maps|location|nearby|attraction|museum|temple|tour|shopping|ticket|visa|passport|customs|time\s*zone)\b|行程|旅行|旅程|旅遊|旅游|度假|假期|出遊|出游|活動|活动|計劃|计划|安排|日程|日期|時間|时间|今日|聽日|听日|明日|今晚|天氣|天气|氣溫|气温|落雨|安全|危險|危险|緊急|紧急|警察|警署|社區|社区|街區|街区|區域|区域|地區|地区|匯率|汇率|兌換|兑换|貨幣|货币|日圓|日元|円|費用|费用|開支|开支|使費|分帳|分账|交通|搭車|搭车|火車|火车|地鐵|地铁|巴士|的士|飛機|飞机|航班|機場|机场|車站|车站|路線|路线|點去|怎么去|翻譯|翻译|語言|语言|廣東話|广东话|日文|英文|執行李|行李|背囊|餐廳|餐厅|食|早餐|午餐|晚餐|宵夜|酒店|住宿|訂位|订位|預約|预约|日曆|日历|目的地|日本|東京|东京|香港|地圖|地图|位置|附近|景點|景点|購物|购物|簽證|签证|護照|护照|時區|时区|旅程|旅行|旅|休暇|休日|バカンス|お出かけ|予定|計画|日程|今日|明日|今夜|天気|気温|雨|安全|危険|緊急|警察|治安|地域|地区|近隣|エリア|為替|通貨|予算|費用|支払い|交通|電車|地下鉄|バス|タクシー|飛行機|空港|駅|経路|翻訳|言語|荷造り|荷物|スーツケース|レストラン|カフェ|食事|朝食|昼食|夕食|ホテル|宿泊|予約|カレンダー|目的地|地図|場所|近く|観光|買い物|ビザ|パスポート|タイムゾーン)/iu;

// Avoid overloaded words such as "map" (Array.map) and "calendar" (a UI
// component). A category match only fails open when this stronger expression
// shows concrete travel context, or for selected non-coding categories below.
const STRONG_TRIP_CONTEXT = /(?:\b(?:trip|travel|vacation|holiday|journey|getaway|itinerary|weather|forecast|temperature|rain|snow|safe|safety|unsafe|emergency|police|neighbou?rhood|district|currency|exchange\s*rate|budget|expense|yen|jpy|hkd|transit|transport|train|rail|metro|subway|bus|taxi|uber|flight|airline|airport|station|route|direction|translate|translation|language|pack|packing|luggage|baggage|suitcase|restaurant|cafe|meal|breakfast|lunch|dinner|hotel|hostel|accommodation|booking|reservation|destination|country|city|tokyo|japan|hong\s*kong|nearby|attraction|museum|temple|tour|shopping|ticket|visa|passport|customs|time\s*zone)\b|行程|旅行|旅程|旅遊|旅游|度假|假期|出遊|出游|天氣|天气|氣溫|气温|落雨|安全|危險|危险|緊急|紧急|警察|警署|社區|社区|街區|街区|區域|区域|地區|地区|匯率|汇率|兌換|兑换|貨幣|货币|日圓|日元|円|費用|费用|開支|开支|分帳|分账|交通|搭車|搭车|火車|火车|地鐵|地铁|巴士|的士|飛機|飞机|航班|機場|机场|車站|车站|路線|路线|翻譯|翻译|語言|语言|行李|背囊|餐廳|餐厅|早餐|午餐|晚餐|宵夜|酒店|住宿|訂位|订位|預約|预约|目的地|日本|東京|东京|香港|附近|景點|景点|購物|购物|簽證|签证|護照|护照|旅程|旅行|休暇|休日|バカンス|お出かけ|天気|気温|雨|安全|危険|緊急|警察|治安|地域|地区|近隣|エリア|為替|通貨|予算|費用|交通|電車|地下鉄|バス|タクシー|飛行機|空港|駅|経路|翻訳|言語|荷造り|荷物|スーツケース|レストラン|カフェ|食事|朝食|昼食|夕食|ホテル|宿泊|予約|目的地|近く|観光|買い物|ビザ|パスポート|タイムゾーン)/iu;

const RESTRICTED_TONE_CONTEXTS = [
  /\b(?:medical|medicine|medication|insulin|dose|dosage|doctor|hospital|symptom|disease|treatment|health|cancer|diabetes|depress\w*|anxiety|mental\s+health|therapy|accessibility|accessible|wheelchair|disability|disabled|blind|deaf|mobility|child|minor|elderly|homeless|refugee|immigrant|legal|lawyer|attorney|court|lawsuit|race|racial|ethnicity|nationality|religion|muslim|jewish|christian|hindu|buddhist|black|asian|indigenous|gender|sexuality|gay|lesbian|bisexual|transgender|trans|queer|pregnan\w*|suicid\w*|self[-\s]?harm|abuse|victim|trauma|outage|disruption|disaster|login|log\s*in|password|account|authentication|security|hack\w*|malware|exploit|breach|delete|wipe|erase|destroy|rm\s+-rf)\b/iu,
  /(?:醫療|医疗|藥物|药物|胰島素|胰岛素|劑量|剂量|醫生|医生|醫院|医院|治療|治疗|健康|癌症|糖尿病|抑鬱|抑郁|焦慮|焦虑|精神健康|心理健康|心理治療|心理治疗|無障礙|无障碍|輪椅|轮椅|殘疾|残疾|傷殘|伤残|視障|视障|聽障|听障|兒童|儿童|未成年|長者|长者|老人|無家可歸|无家可归|難民|难民|移民|法律|律師|律师|法庭|訴訟|诉讼|種族|种族|族裔|國籍|国籍|宗教|穆斯林|猶太|犹太|黑人|亞裔|亚裔|原住民|性別|性别|性取向|同性戀|同性恋|男同性戀|男同性恋|女同性戀|女同性恋|雙性戀|双性恋|跨性別|跨性别|酷兒|酷儿|懷孕|怀孕|自殺|自杀|自殘|自残|虐待|受害|創傷|创伤|停機|停机|中斷|中断|災難|灾难|登入|登录|密碼|密码|帳戶|账户|賬戶|账号|網絡安全|网络安全|資訊安全|信息安全|黑客|駭客|入侵|惡意軟件|恶意软件|刪除|删除|清空|抹除|銷毀|销毁)/iu,
  /(?:医療|薬|インスリン|用量|医師|病院|治療|健康|がん|癌|糖尿病|うつ|不安|メンタルヘルス|セラピー|アクセシビリティ|車椅子|障害|視覚障害|聴覚障害|子ども|子供|未成年|高齢者|ホームレス|難民|移民|法律|弁護士|裁判|訴訟|人種|民族|国籍|宗教|イスラム教徒|ユダヤ人|黒人|アジア人|先住民|性別|性的指向|同性愛|ゲイ|レズビアン|バイセクシュアル|トランスジェンダー|クィア|妊娠|自殺|自傷|虐待|被害|トラウマ|停止|障害発生|中断|災害|ログイン|パスワード|アカウント|認証|セキュリティ|ハッキング|マルウェア|侵入|削除|消去|破壊)/iu,
  /(?:\b(?:kill\s+(?:myself|yourself|himself|herself|themselves)|want\s+to\s+die|end\s+(?:my|your|his|her|their)\s+life|not\s+want\s+to\s+live)\b|我想死|唔想活|不想活|結束生命|结束生命|了結自己|了结自己|死にたい|生きたくない|命を絶つ|自分を殺)/iu,
  /(?:\b(?:bomb|explosive|weapon|gun|shoot\w*|murder|kill\s+someone|rape|sexual\s+assault|terroris\w*)\b|炸彈|炸弹|爆炸物|武器|槍殺|枪杀|槍|枪|謀殺|谋杀|殺人|杀人|強姦|强奸|性侵|恐怖襲擊|恐怖袭击|爆弾|爆発物|武器|銃|射殺|殺人|レイプ|強姦|性暴力|テロ)/iu,
] as const;

const PLAYFUL_CODING_REQUESTS = [
  /^(?:please\s+)?(?:write|generate|implement)\s+(?:me\s+)?(?:a\s+)?(?:python|javascript|typescript|java|c\+\+|rust|go|golang|sql)?\s*(?:map\s+)?(?:function|algorithm|code|script)\s+to\s+(?:sort|reverse|deduplicate|parse|format|search)\s+(?:an?\s+)?(?:array|list|linked\s+list|string|numbers?|json|csv)\s*[.!?]*$/iu,
  /^(?:please\s+)?(?:debug|refactor|review)\s+(?:my\s+)?(?:react|javascript|typescript)?\s*(?:calendar\s+)?(?:component|code|function|script)\s*[.!?]*$/iu,
  /^(?:please\s+)?(?:write|generate)\s+(?:me\s+)?(?:a\s+)?(?:python|javascript|typescript|java|c\+\+|rust|go|golang|sql)\s+(?:program|code|script)\s*[.!?]*$/iu,
  /^(?:幫我|帮我|請|请)?(?:寫|写|撰寫|编写)(?:一個|一个)?\s*(?:python|javascript|typescript|sql)\s*(?:程式|程序|代碼|代码)[。.!?？]*$/iu,
  /^(?:python|javascript|typescript|sql)の(?:コード|プログラム|スクリプト)を?(?:書いて|作って)[。.!?？]*$/iu,
] as const;

const CATEGORY_PATTERNS: ReadonlyArray<{
  category: OffTopicCategory;
  patterns: readonly RegExp[];
}> = [
  {
    category: "coding",
    patterns: [
      /\b(?:write|debug|refactor|compile|implement|explain|generate|review)\b.{0,50}\b(?:code|program|script|function|class|algorithm|regex|sql|python|javascript|typescript|java|c\+\+|rust|golang|html|css|react)\b/iu,
      /(?:寫|写|撰寫|编写|除錯|调试|修復|修复|解釋|解释|生成).{0,24}(?:程式|程序|代碼|代码|演算法|算法|正則|正则|python|javascript|typescript|sql)/iu,
      /(?:コード|プログラム|スクリプト|関数|アルゴリズム|正規表現).{0,24}(?:書いて|作って|デバッグ|修正|説明|実装)/iu,
    ],
  },
  {
    category: "math",
    patterns: [
      /^(?:please\s+)?(?:solve\s+(?:the\s+)?equation|differentiate|integrate)\s*[:：]?\s*[\dxyzabc().\s+\-*/^=]+\??$/iu,
      /^(?:幫我|帮我|請|请)?(?:解方程|微分|積分|积分)\s*[:：]?\s*[\dxyzabc().\s+\-*/^=]+[。?？]*$/iu,
      /^(?:次の)?(?:方程式を解いて|微分|積分)(?:して|してください)?\s*[:：]?\s*[\dxyzabc().\s+\-*/^=]+[。?？]*$/iu,
    ],
  },
  {
    category: "joke",
    patterns: [
      /^(?:please\s+)?(?:tell|give)\s+me\s+(?:a|another)\s+joke\??$/iu,
      /^(?:please\s+)?(?:roast\s+me|make\s+me\s+laugh)\.?$/iu,
      /^(?:講|说|說)(?:個|个)?笑話(?:俾我聽|给我听)?[。！!？?]*$/iu,
      /^(?:ジョーク|冗談)を?(?:言って|教えて)[。！!？?]*$/iu,
    ],
  },
  {
    category: "finance",
    patterns: [
      /\b(?:stock|shares?|crypto|bitcoin|ethereum)\b.{0,50}\b(?:price|buy|sell|trade|portfolio|prediction|invest)\b|\b(?:buy|sell|trade|invest)\b.{0,40}\b(?:stock|shares?|crypto|bitcoin|ethereum)\b/iu,
      /(?:股票|股份|加密貨幣|加密货币|比特幣|比特币|以太幣|以太币).{0,30}(?:買|买|賣|卖|炒|投資|投资|預測|预测|價格|价格)/iu,
      /(?:株|暗号資産|ビットコイン|イーサリアム).{0,30}(?:買う|売る|取引|投資|予想|価格)/iu,
    ],
  },
  {
    category: "gaming",
    patterns: [
      /\b(?:video\s+game|minecraft|fortnite|valorant|league\s+of\s+legends|elden\s+ring)\b.{0,50}\b(?:cheat|build|walkthrough|攻略|rank|level)\b|\b(?:cheat|walkthrough)\b.{0,40}\b(?:game|level|boss)\b/iu,
      /(?:遊戲|游戏|minecraft|fortnite|valorant|英雄聯盟|英雄联盟).{0,30}(?:攻略|外掛|外挂|出裝|出装|升級|升级)/iu,
      /(?:ゲーム|マインクラフト|フォートナイト|valorant).{0,30}(?:攻略|チート|ビルド|レベル)/iu,
    ],
  },
  {
    category: "relationships",
    patterns: [
      /\b(?:boyfriend|girlfriend|ex|crush|spouse)\b.{0,60}\b(?:dumped|cheating|relationship|dating|love\s+me|text\s+back)\b|\b(?:dating|relationship)\s+advice\b/iu,
      /(?:男朋友|女朋友|前度|暗戀|暗恋|伴侶|伴侣).{0,30}(?:分手|出軌|出轨|拍拖|戀愛|恋爱|覆我|回我)/iu,
      /(?:彼氏|彼女|元彼|元カノ|恋人).{0,30}(?:別れ|浮気|恋愛|返信)/iu,
    ],
  },
];

const OFF_TOPIC_REPLIES: Required<BaseCatalogs<string>> = {
  en: "Wrong app. This is a trip planner, not your all-purpose homework machine. Ask about the trip—even the suitcase knows you wandered off topic.",
  "zh-HK": "問錯地方。呢度係旅程助手，唔係乜都代你做嘅萬能客服。請問返行程相關嘅事，連個行李篋都知你離咗題。",
  "zh-HK-lihkg": "喂，搭錯車呀？呢度係旅程助手，唔係你個免費萬能腦。問返行程啦，連個行李篋都嫌你離題。",
  "ja-JP": "アプリを間違えています。ここは旅行プランナーで、何でも屋ではありません。スーツケースにも呆れられる前に、旅行の話をしてください。",
};

const SENSITIVE_OFF_TOPIC_REPLIES: Required<BaseCatalogs<string>> = {
  en: "That question is outside this trip planner. Please use an appropriate support service; I can continue helping with trip-related matters.",
  "zh-HK": "呢個問題唔屬於旅程規劃範圍。請使用合適嘅支援服務；我可以繼續幫你處理旅程相關事項。",
  "zh-HK-lihkg": "呢個問題唔屬於旅程規劃範圍。請使用合適嘅支援服務；我可以繼續幫你處理旅程相關事項。",
  "ja-JP": "その質問は旅行プランナーの対象外です。適切なサポートサービスをご利用ください。旅行に関することなら引き続きお手伝いできます。",
};

/** Both replies for a locale; the added languages read them from their packs (JOB-084). */
export function offTopicReplies(locale: Locale): { reply: string; sensitive: string } {
  const catalog = (language: keyof typeof OFF_TOPIC_REPLIES) => ({ reply: OFF_TOPIC_REPLIES[language], sensitive: SENSITIVE_OFF_TOPIC_REPLIES[language] });
  return localizedCatalog(locale, "offTopic", { en: catalog("en"), "zh-HK": catalog("zh-HK"), "zh-HK-lihkg": catalog("zh-HK-lihkg"), "ja-JP": catalog("ja-JP") });
}

export function classifyOffTopicPrompt(prompt: string): OffTopicDecision {
  const normalized = prompt.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized) return { offTopic: false };

  const matches = CATEGORY_PATTERNS.filter((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(normalized)));
  if (matches.length === 0) return { offTopic: false };
  const sensitive = matches.find((candidate) =>
    candidate.category === "finance" || candidate.category === "relationships");
  const selected = sensitive ?? matches[0];
  if (selected) {
    const hasRestrictedContext = RESTRICTED_TONE_CONTEXTS.some(
      (pattern) => pattern.test(normalized),
    );
    if (hasRestrictedContext) {
      return { offTopic: true, category: selected.category, restrictedTone: true };
    }
    if (STRONG_TRIP_CONTEXT.test(normalized)) return { offTopic: false };
    if (selected.category !== "coding" && selected.category !== "gaming"
        && TRIP_ADJACENT.test(normalized)) {
      return { offTopic: false };
    }
    if (selected.category === "coding"
        && !PLAYFUL_CODING_REQUESTS.some((pattern) => pattern.test(normalized))) {
      return { offTopic: true, category: selected.category, restrictedTone: true };
    }
    return { offTopic: true, category: selected.category };
  }
  return { offTopic: false };
}

export function offTopicReply(
  locale: Locale,
  category: OffTopicCategory,
  restrictedTone = false,
): string {
  if (restrictedTone || category === "finance" || category === "relationships") {
    return offTopicReplies(locale).sensitive;
  }
  return offTopicReplies(locale).reply;
}
