import { placeTimeZone } from "@/lib/app/place-time-zones";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";

/**
 * Well-known destinations the offline locality catalog leaves unresolved because they share a name with smaller
 * places (Paris, Texas; London, Ontario), and single-zone countries people type as a destination. Used only to
 * suggest a destination's time zone in a visible, editable field (JOB-098); event clocks never use it.
 */
const aliases: Readonly<Record<string, string>> = {
  paris: "Europe/Paris", london: "Europe/London", rome: "Europe/Rome", barcelona: "Europe/Madrid", madrid: "Europe/Madrid",
  amsterdam: "Europe/Amsterdam", vienna: "Europe/Vienna", venice: "Europe/Rome", florence: "Europe/Rome", naples: "Europe/Rome",
  athens: "Europe/Athens", dublin: "Europe/Dublin", zurich: "Europe/Zurich", geneva: "Europe/Zurich", seville: "Europe/Madrid",
  santorini: "Europe/Athens", mykonos: "Europe/Athens", dubrovnik: "Europe/Zagreb", bali: "Asia/Makassar", macau: "Asia/Macau",
  macao: "Asia/Macau", penang: "Asia/Kuala_Lumpur", nara: "Asia/Tokyo", sydney: "Australia/Sydney", melbourne: "Australia/Melbourne",
  "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles", "las vegas": "America/Los_Angeles",
  boston: "America/New_York", washington: "America/New_York", "washington dc": "America/New_York", "washington d.c.": "America/New_York",
  vancouver: "America/Vancouver", lima: "America/Lima", marrakech: "Africa/Casablanca", maldives: "Indian/Maldives",
  hawaii: "Pacific/Honolulu", guam: "Pacific/Guam",
  japan: "Asia/Tokyo", korea: "Asia/Seoul", "south korea": "Asia/Seoul", taiwan: "Asia/Taipei", thailand: "Asia/Bangkok",
  vietnam: "Asia/Ho_Chi_Minh", philippines: "Asia/Manila", malaysia: "Asia/Kuala_Lumpur", china: "Asia/Shanghai", india: "Asia/Kolkata",
  france: "Europe/Paris", italy: "Europe/Rome", spain: "Europe/Madrid", uk: "Europe/London", "united kingdom": "Europe/London",
  england: "Europe/London", germany: "Europe/Berlin", switzerland: "Europe/Zurich", greece: "Europe/Athens", portugal: "Europe/Lisbon",
  netherlands: "Europe/Amsterdam", iceland: "Atlantic/Reykjavik", "new zealand": "Pacific/Auckland", egypt: "Africa/Cairo",
  morocco: "Africa/Casablanca", turkey: "Europe/Istanbul", uae: "Asia/Dubai",
  巴黎: "Europe/Paris", 倫敦: "Europe/London", 伦敦: "Europe/London", 羅馬: "Europe/Rome", 罗马: "Europe/Rome",
  悉尼: "Australia/Sydney", 雪梨: "Australia/Sydney", 墨爾本: "Australia/Melbourne", 墨尔本: "Australia/Melbourne",
  洛杉磯: "America/Los_Angeles", 洛杉矶: "America/Los_Angeles", 三藩市: "America/Los_Angeles", 舊金山: "America/Los_Angeles",
  旧金山: "America/Los_Angeles", 澳門: "Asia/Macau", 澳门: "Asia/Macau", 峇里: "Asia/Makassar", 峇里島: "Asia/Makassar",
  巴厘岛: "Asia/Makassar", 日本: "Asia/Tokyo", 韓國: "Asia/Seoul", 韩国: "Asia/Seoul", 台灣: "Asia/Taipei", 台湾: "Asia/Taipei",
  泰國: "Asia/Bangkok", 泰国: "Asia/Bangkok", パリ: "Europe/Paris", ロンドン: "Europe/London", ローマ: "Europe/Rome",
  シドニー: "Australia/Sydney", ロサンゼルス: "America/Los_Angeles", 韓国: "Asia/Seoul",
};

/** A suggested IANA zone for a destination the traveller typed, or null to let them choose. */
export function suggestDestinationTimeZone(name: string | null | undefined): string | null {
  const text = name?.trim();
  if (!text || text.length > 160) return null;
  const key = text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
  // Only Latin accents are dropped ("Zürich"); kana voicing marks stay.
  const alias = aliases[key] ?? aliases[key.normalize("NFD").replace(/[̀-ͯ]/gu, "").normalize("NFC")];
  return placeTimeZone(text) ?? (alias ? canonicalTripTimeZone(alias) : null);
}
