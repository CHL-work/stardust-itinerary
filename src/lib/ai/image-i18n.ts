import type { Locale } from "@/lib/i18n";

const english = {
  add: "Add pictures", preview: "Attached picture", saved: "Submitted picture", remove: "Remove picture",
  preparing: "Preparing pictures…", count: "Choose up to 3 pictures per message.",
  format: "Use a JPEG, PNG or WebP picture. Convert HEIC, PDF or other files first.",
  size: "Each original picture must be at most 20 MB and compress to 2 MB. Crop it or choose a smaller picture.",
  dimensions: "This picture is too large to process safely. Crop or resize it first.",
  prepare: "Could not prepare this picture. Please choose it again or use another picture.",
  requestFailed: "AI could not read these pictures. Try a clearer or cropped picture, or type the important details. Check pending changes before trying again.",
  safety: "Up to 3 pictures. Say which events or expenses to create, who paid and who shares. Hide passwords, booking PINs and card details first. Pictures are saved privately with your chat and sent to the selected AI provider; new events and expenses still need owner approval.",
};
export type AiImageMessages = { [K in keyof typeof english]: string };
const cantonese: AiImageMessages = {
  add: "加入圖片", preview: "已附加圖片", saved: "已傳送圖片", remove: "移除圖片",
  preparing: "正在處理圖片…", count: "每個訊息最多加入 3 張圖片。",
  format: "請使用 JPEG、PNG 或 WebP 圖片。HEIC、PDF 等檔案請先轉換格式。",
  size: "原圖不可超過 20 MB，壓縮後不可超過 2 MB。請裁剪或選擇較細圖片。",
  dimensions: "圖片尺寸太大，無法安全處理。請先裁剪或縮細。",
  prepare: "未能處理圖片，請重新選擇或使用另一張圖片。",
  requestFailed: "AI 未能讀取圖片。請使用較清晰或裁剪後的圖片，或直接輸入重要資料。重試前請先查看待批變更。",
  safety: "最多 3 張圖片。請寫明要建立的活動或開支、付款人及分帳成員。請先遮蓋密碼、預約 PIN 及信用卡資料。圖片會私人儲存於你的對話，並傳送至所選 AI 供應商；新增活動及開支仍須管理員批准。",
};
const japanese: AiImageMessages = {
  add: "画像を追加", preview: "添付画像", saved: "送信した画像", remove: "画像を削除",
  preparing: "画像を準備中…", count: "1つのメッセージにつき画像は3枚までです。",
  format: "JPEG・PNG・WebP画像を使用してください。HEIC・PDFなどは先に変換してください。",
  size: "元の画像は20 MB以下、圧縮後は2 MB以下にしてください。切り抜くか、小さい画像を選んでください。",
  dimensions: "画像が大きすぎて安全に処理できません。先に切り抜き・縮小してください。",
  prepare: "画像を準備できませんでした。もう一度選ぶか、別の画像を使用してください。",
  requestFailed: "AIが画像を読み取れませんでした。鮮明な画像や切り抜いた画像を使うか、重要な内容を文章で入力してください。再試行する前に承認待ちの変更を確認してください。",
  safety: "画像は3枚まで。作成する予定・費用、支払った人、分担する人を文章で指定してください。パスワード・予約用暗証番号・カード情報は先に隠してください。画像は自分の会話に非公開で保存され、選択したAI提供元に送信されます。新しい予定・費用には引き続き管理者の承認が必要です。",
};
export function aiImageMessages(locale: Locale): AiImageMessages {
  return locale === "ja-JP" ? japanese : locale.startsWith("zh-HK") ? cantonese : english;
}
