import type { Locale } from "@/lib/i18n";

const english = {
  add: "Add pictures", preview: "Attached picture", saved: "Submitted picture", remove: "Remove picture",
  preparing: "Preparing pictures…", count: "Choose up to 3 pictures per message.",
  format: "Use a JPEG, PNG or WebP picture. Convert HEIC, PDF or other files first.",
  size: "Each picture must be under 20 MB and shrink to 2 MB. Crop it or pick a smaller one.",
  dimensions: "This picture is too large to process safely. Crop or resize it first.",
  prepare: "Could not prepare this picture. Please choose it again or use another picture.",
  requestFailed: "AI could not read these pictures. Try a clearer one or type the details.",
  safety: "Up to 3 pictures. Cover PINs and card numbers first.",
};
export type AiImageMessages = { [K in keyof typeof english]: string };
const cantonese: AiImageMessages = {
  add: "加入圖片", preview: "已附加圖片", saved: "已傳送圖片", remove: "移除圖片",
  preparing: "正在處理圖片…", count: "每個訊息最多加入 3 張圖片。",
  format: "請使用 JPEG、PNG 或 WebP 圖片。HEIC、PDF 等檔案請先轉換格式。",
  size: "每張圖片須小於 20 MB，並可壓縮至 2 MB。請裁剪或選擇較小的圖片。",
  dimensions: "圖片尺寸太大，無法安全處理。請先裁剪或縮細。",
  prepare: "未能處理圖片，請重新選擇或使用另一張圖片。",
  requestFailed: "AI 未能讀取這些圖片。請試用較清晰的圖片，或直接輸入資料。",
  safety: "最多 3 張圖片。請先遮蓋密碼及信用卡號碼。",
};
const japanese: AiImageMessages = {
  add: "画像を追加", preview: "添付画像", saved: "送信した画像", remove: "画像を削除",
  preparing: "画像を準備中…", count: "1つのメッセージにつき画像は3枚までです。",
  format: "JPEG・PNG・WebP画像を使用してください。HEIC・PDFなどは先に変換してください。",
  size: "画像は20MB未満で、2MBまで圧縮できる必要があります。トリミングするか小さい画像を選んでください。",
  dimensions: "画像が大きすぎて安全に処理できません。先に切り抜き・縮小してください。",
  prepare: "画像を準備できませんでした。もう一度選ぶか、別の画像を使用してください。",
  requestFailed: "AIが画像を読み取れませんでした。鮮明な画像を使うか、内容を入力してください。",
  safety: "画像は3枚まで。暗証番号やカード番号は隠してください。",
};
export function aiImageMessages(locale: Locale): AiImageMessages {
  return locale === "ja-JP" ? japanese : locale.startsWith("zh-HK") ? cantonese : english;
}
