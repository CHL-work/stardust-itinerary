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
  signIn: "Sign in for saved trips.",
  separateAccount: "Guest data is not transferred when you sign in.",
  startNotice: "Create a guest trip, deleted after 24 hours.",
  startGuest: "Try as guest",
  startingGuest: "Starting guest access…",
  failed: "Could not start guest access. Check your connection and try again.",
  limited: "Too many guest attempts. Try again later or sign in with Google.",
  challengeFailed: "The verification did not pass. Try again.",
  unavailable: "Guest access is unavailable. Sign in with Google or try later.",
};
type GuestCopy = { [K in keyof typeof english]: string };

const cantonese: GuestCopy = {
  banner: "呢個訪客旅程會喺 {time} 刪除。",
  bannerNeedsKey: "呢個訪客旅程會喺 {time} 刪除。AI 要用你自己嘅 API 金鑰。",
  signIn: "登入以建立可保留嘅旅程。",
  separateAccount: "登入唔會轉移訪客資料。",
  startNotice: "建立訪客旅程，24 小時後刪除。",
  startGuest: "以訪客試用",
  startingGuest: "正在開啟訪客模式…",
  failed: "未能開啟訪客模式，請檢查連線後再試。",
  limited: "訪客嘗試次數太多，請稍後再試或用 Google 登入。",
  challengeFailed: "驗證未能通過，請再試。",
  unavailable: "訪客模式暫時無法使用，請用 Google 登入或稍後再試。",
};

const japanese: GuestCopy = {
  banner: "このゲスト旅行は {time} に削除されます。",
  bannerNeedsKey: "このゲスト旅行は {time} に削除されます。AIには自分のAPIキーが必要です。",
  signIn: "サインインして保存できる旅行を作成。",
  separateAccount: "サインインしてもゲストのデータは移行されません。",
  startNotice: "ゲスト旅行を作成できます。24時間後に削除されます。",
  startGuest: "ゲストとして試す",
  startingGuest: "ゲストアクセスを開始中…",
  failed: "ゲストアクセスを開始できませんでした。接続を確認して再試行してください。",
  limited: "ゲストの試行回数が多すぎます。後で再試行するかGoogleでサインインしてください。",
  challengeFailed: "認証に失敗しました。再試行してください。",
  unavailable: "ゲストアクセスは利用できません。Googleでサインインするか後で再試行してください。",
};

export function guestMessages(locale: Locale): GuestCopy {
  return localizedCatalog(locale, "guest", { en: english, "zh-HK": cantonese, "ja-JP": japanese });
}
