import type { Locale } from "@/lib/i18n";
const en = {
  personal: "Personal Calendar", allDay: "All day", continues: "Continues from an earlier day", until: "Until", add: "Add to trip", open: "View in Calendar",
  title: "Import Calendar event", loading: "Loading this Calendar event…", failed: "Could not load this event. Refresh Calendar and try again.", reconnect: "Reconnect Google Calendar in Settings, then try again.",
  source: "Source title and time are retained. You can edit the trip event afterward.", private: "Private event", privateHint: "Only you can see this event unless you share it.",
  viewers: "Share with selected members", type: "Event type", location: "Place", map: "Google Maps link (optional)", save: "Add and link event", saving: "Saving…", cancel: "Cancel",
  publicSubject: "Public venue name for lookup", consent: "This is a public venue name, not private information.",
  searchHelp: "Optional: AI search sends only the public venue name you confirm.",
  find: "Find place with AI", finding: "Looking up the public place…", use: "Use this suggestion", unavailable: "No verified place was found. Enter the place or Maps link manually.",
  aiReview: "An AI place suggestion was used, so this needs owner approval.",
  saveFailed: "Could not confirm the import. Retry the same import; do not add another event.", retry: "Retry same import",
  stale: "The Calendar preview changed. Refresh it and confirm again.", refreshPreview: "Refresh preview",
  existing: "This Calendar event already has an import record. It cannot be added again.", pending: "Awaiting owner approval", approved: "Already added to the trip", rejected: "Import rejected — ask the owner to review it", invalidated: "Import no longer eligible — ask the owner to review it",
  saved: "Calendar event added and linked.", requested: "Calendar import saved for owner approval.", invalidMap: "Enter a valid Google Maps link or leave it blank.",
  calendarCount: "{count} personal Calendar events", activity: "Activity", meal: "Meal", lodging: "Lodging", note: "Note",
};
export type CalendarImportCopy = { [K in keyof typeof en]: string };
const zh: CalendarImportCopy = {
  personal: "私人日曆", allDay: "全日", continues: "由前一日延續", until: "至", add: "加入行程", open: "在日曆查看",
  title: "匯入日曆活動", loading: "正在載入此日曆活動…", failed: "未能載入活動，請重新整理日曆後再試。", reconnect: "請在設定重新連接 Google 日曆後再試。",
  source: "保留來源的名稱及時間，加入行程後可以編輯。", private: "私人活動", privateHint: "除非你分享，否則只有你可以看到此活動。",
  viewers: "分享給指定成員", type: "活動類型", location: "地點", map: "Google 地圖連結（可選）", save: "加入並連結活動", saving: "儲存中…", cancel: "取消",
  publicSubject: "供搜尋的公開場所名稱", consent: "這是公開場地名稱，並非私人資料。",
  searchHelp: "可選：AI 搜尋只會傳送你確認的公開場地名稱。",
  find: "用 AI 尋找地點", finding: "正在搜尋公開場所…", use: "使用此建議", unavailable: "未能核實地點，請自行輸入地點或地圖連結。",
  aiReview: "已使用 AI 地點建議，因此需要管理員批准。",
  saveFailed: "未能確認匯入。請重試同一匯入，切勿另建活動。", retry: "重試同一匯入",
  stale: "日曆預覽已更改，請重新整理後再確認。", refreshPreview: "重新載入預覽",
  existing: "此日曆活動已有匯入紀錄，不能重複新增。", pending: "等待管理員批准", approved: "已加入行程", rejected: "匯入已被拒絕，請管理員重新審閱", invalidated: "匯入已失效，請管理員審閱",
  saved: "日曆活動已加入並連結。", requested: "日曆匯入已提交管理員審批。", invalidMap: "請輸入有效的 Google 地圖連結，或留空。",
  calendarCount: "{count} 個私人日曆活動", activity: "活動", meal: "用餐", lodging: "住宿", note: "備註",
};
const ja: CalendarImportCopy = {
  personal: "個人カレンダー", allDay: "終日", continues: "前日から継続", until: "まで", add: "旅程に追加", open: "カレンダーで表示",
  title: "カレンダーの予定を取り込む", loading: "予定を読み込み中…", failed: "予定を読み込めませんでした。カレンダーを更新して再試行してください。", reconnect: "設定で Google カレンダーを再接続してから再試行してください。",
  source: "元の名前と日時を保持します。取り込み後に旅程で編集できます。", private: "非公開の予定", privateHint: "共有しない限り、この予定はあなただけが見られます。",
  viewers: "選択したメンバーと共有", type: "予定の種類", location: "場所", map: "Google マップのリンク（任意）", save: "追加してリンク", saving: "保存中…", cancel: "キャンセル",
  publicSubject: "検索する公開施設名", consent: "これは公開の会場名で、個人情報ではありません。",
  searchHelp: "任意：AI検索では、確認した公開の会場名だけを送信します。",
  find: "AI で場所を検索", finding: "公開施設を検索中…", use: "この候補を使う", unavailable: "場所を確認できませんでした。場所やマップのリンクを手動で入力してください。",
  aiReview: "AIの場所候補を使ったため、オーナーの承認が必要です。",
  saveFailed: "取り込みを確認できませんでした。同じ取り込みを再試行し、予定を追加しないでください。", retry: "同じ取り込みを再試行",
  stale: "カレンダーのプレビューが変わりました。更新して再確認してください。", refreshPreview: "プレビューを更新",
  existing: "この予定には取り込み記録があり、再追加できません。", pending: "オーナーの承認待ち", approved: "旅程に追加済み", rejected: "取り込みは却下されました。オーナーに確認してください", invalidated: "取り込みは無効です。オーナーに確認してください",
  saved: "予定を追加してリンクしました。", requested: "取り込みをオーナーに承認依頼しました。", invalidMap: "有効な Google マップのリンクを入力するか、空欄にしてください。",
  calendarCount: "個人カレンダーの予定 {count} 件", activity: "アクティビティ", meal: "食事", lodging: "宿泊", note: "メモ",
};
export const calendarImportMessages = (locale: Locale): CalendarImportCopy => locale === "en" ? en : locale === "ja-JP" ? ja : zh;
