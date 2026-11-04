import type { Locale } from "@/lib/i18n";

/** Guest accounts (JOB-064). Deletion and account copy stays neutral in every tone. */
const english = {
  banner: "Guest demo trip. It and everything in it are permanently deleted on {time}.",
  signIn: "Sign in with Google to plan trips you keep.",
  aiHint: "AI here works with your own API key: add one in Settings → AI keys.",
};
type GuestCopy = { [K in keyof typeof english]: string };

const cantonese: GuestCopy = {
  banner: "訪客示範旅程。旅程同入面所有內容會喺 {time} 永久刪除。",
  signIn: "用 Google 登入，就可以規劃可以保留嘅旅程。",
  aiHint: "呢度嘅 AI 要用你自己嘅 API 金鑰：喺「設定 → AI 金鑰」加入。",
};

const japanese: GuestCopy = {
  banner: "ゲスト用のデモ旅行です。旅行とその内容はすべて {time} に完全に削除されます。",
  signIn: "残しておける旅行を計画するには、Google でサインインしてください。",
  aiHint: "ここでのAIは自分のAPIキーで動きます。「設定 → AIキー」で追加してください。",
};

export function guestMessages(locale: Locale): GuestCopy {
  return locale === "ja-JP" ? japanese : locale === "zh-HK" || locale === "zh-HK-lihkg" ? cantonese : english;
}
