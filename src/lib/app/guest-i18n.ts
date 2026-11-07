import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";

/**
 * Guest accounts (JOB-064), in one short line (D-088): when the trip is deleted, the AI key only
 * when AI here needs one because free guest AI is off (JOB-077), and the sign-in link. Deletion and
 * account copy stays neutral in every tone.
 */
const english = {
  banner: "This guest trip is deleted on {time}.",
  bannerNeedsKey: "This guest trip is deleted on {time}. AI needs your own API key.",
  signIn: "Sign in to keep trips.",
};
type GuestCopy = { [K in keyof typeof english]: string };

const cantonese: GuestCopy = {
  banner: "呢個訪客旅程會喺 {time} 刪除。",
  bannerNeedsKey: "呢個訪客旅程會喺 {time} 刪除。AI 要用你自己嘅 API 金鑰。",
  signIn: "登入就可以保留旅程。",
};

const japanese: GuestCopy = {
  banner: "このゲスト旅行は {time} に削除されます。",
  bannerNeedsKey: "このゲスト旅行は {time} に削除されます。AIには自分のAPIキーが必要です。",
  signIn: "サインインすると旅行を残せます。",
};

export function guestMessages(locale: Locale): GuestCopy {
  return localizedCatalog(locale, "guest", { en: english, "zh-HK": cantonese, "ja-JP": japanese });
}
