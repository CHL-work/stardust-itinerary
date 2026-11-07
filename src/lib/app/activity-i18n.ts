import type { Locale } from "@/lib/i18n";
import { localizedCatalog } from "@/lib/locale-packs";
import type { ActivityAction, ActivityCategory, ActivityField } from "./activity-types";

type ActivityCopy = {
  title: string; settingsHint: string; open: string; back: string; refresh: string; empty: string; latest: string;
  system: string; changed: string; current: string; requestCurrent: string; removed: string; unavailable: string;
  loading: string; loadFailed: string; openEvent: string; openExpense: string; openRequest: string; requestDetail: string;
  recordedAt: string; amount: string; startsAt: string; endsAt: string; status: string;
  categories: Record<ActivityCategory, string>; actions: Record<ActivityAction, string>; fields: Record<ActivityField, string>;
  statuses: Record<string, string>;
};
const en: ActivityCopy = {
  title: "Trip activity", settingsHint: "Owner-only history of trip changes, with links to records you can currently view.",
  open: "View activity", back: "Back to Settings", refresh: "Refresh", empty: "No activity available.", latest: "Latest 50 visible records · owner only",
  system: "System", changed: "Changed fields", current: "Current record details, not a historical snapshot.", requestCurrent: "Current request details. This view does not approve or edit anything.",
  removed: "Removed from the trip. The audit record is retained.", unavailable: "The related record is no longer available to you.",
  loading: "Opening record…", loadFailed: "Could not open this record. Refresh and try again.",
  openEvent: "View event", openExpense: "View expense", openRequest: "View request", requestDetail: "Request details · read only",
  recordedAt: "Recorded", amount: "Full bill amount", startsAt: "Event / expense time", endsAt: "Ends", status: "Current status",
  categories: { event: "Event", expense: "Expense", request: "Request", member: "Member", permissions: "Permissions", calendar: "Google Calendar", trip: "Trip", ai: "AI", payment: "Repayment", system: "App" },
  actions: { created: "Created", updated: "Updated", requested: "Change requested", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", restored: "Restored", removed: "Removed", voided: "Voided", synced: "Synced", failed: "Failed", connected: "Connected", disconnected: "Disconnected", joined: "Joined", disabled: "Disabled", enabled: "Enabled", changed: "Changed" },
  fields: { title: "name", time: "date / time", location: "location", type: "event type", status: "status", visibility: "privacy", audience: "shared members", amount: "amount", currency: "currency", payer: "payer", shares: "shares", linkedExpense: "linked expense", linkedEvent: "linked event", notes: "notes", lock: "owner lock" },
  statuses: { pending: "Pending approval", approved: "Approved", rejected: "Rejected", superseded: "Superseded", draft: "Draft", planned: "Planned", cancelled: "Cancelled", completed: "Completed", posted: "Recorded", void: "Voided" },
};
const hk: ActivityCopy = {
  title: "旅程操作紀錄", settingsHint: "只有管理員可查看旅程變更紀錄，並開啟目前有權查看的項目。", open: "查看操作紀錄", back: "返回設定", refresh: "重新整理", empty: "暫無可查看的操作紀錄。", latest: "最近 50 項可查看紀錄 · 僅限管理員",
  system: "系統", changed: "已變更欄位", current: "以下為目前項目資料，並非當時的歷史版本。", requestCurrent: "以下為目前申請資料；查看不會批准或修改項目。",
  removed: "項目已從旅程移除，操作紀錄仍會保留。", unavailable: "相關項目已不存在，或你已無權查看。", loading: "正在開啟項目…", loadFailed: "未能開啟項目，請重新整理後再試。",
  openEvent: "查看活動", openExpense: "查看開支", openRequest: "查看申請", requestDetail: "申請詳情 · 唯讀", recordedAt: "記錄時間", amount: "整筆帳單金額", startsAt: "活動／開支時間", endsAt: "結束", status: "目前狀態",
  categories: { event: "活動", expense: "開支", request: "申請", member: "成員", permissions: "權限", calendar: "Google 日曆", trip: "旅程", ai: "AI", payment: "還款", system: "應用程式" },
  actions: { created: "已新增", updated: "已更新", requested: "已提交變更申請", approved: "已批准", rejected: "已拒絕", cancelled: "已取消", restored: "已恢復", removed: "已移除", voided: "已作廢", synced: "已同步", failed: "未能完成", connected: "已連接", disconnected: "已中斷連接", joined: "已加入", disabled: "已停用", enabled: "已啟用", changed: "已變更" },
  fields: { title: "名稱", time: "日期／時間", location: "地點", type: "活動類型", status: "狀態", visibility: "私隱設定", audience: "分享成員", amount: "金額", currency: "貨幣", payer: "付款人", shares: "分帳", linkedExpense: "連結開支", linkedEvent: "連結活動", notes: "備註", lock: "管理員鎖定" },
  statuses: { pending: "待批准", approved: "已批准", rejected: "已拒絕", superseded: "已被取代", draft: "草稿", planned: "已計劃", cancelled: "已取消", completed: "已完成", posted: "已記錄", void: "已作廢" },
};
const ja: ActivityCopy = {
  title: "旅行の操作履歴", settingsHint: "オーナー専用の変更履歴です。現在閲覧できる項目を開けます。", open: "操作履歴を見る", back: "設定に戻る", refresh: "更新", empty: "表示できる操作履歴はありません。", latest: "閲覧可能な最新50件 · オーナー専用",
  system: "システム", changed: "変更された項目", current: "現在の項目情報です。操作時点の履歴データではありません。", requestCurrent: "現在の申請情報です。閲覧しても承認や編集は行いません。",
  removed: "旅行から削除済みです。操作履歴は保持されています。", unavailable: "関連項目が存在しないか、閲覧権限がありません。", loading: "項目を開いています…", loadFailed: "項目を開けませんでした。更新して再試行してください。",
  openEvent: "予定を見る", openExpense: "費用を見る", openRequest: "申請を見る", requestDetail: "申請の詳細 · 閲覧のみ", recordedAt: "記録日時", amount: "請求の合計額", startsAt: "予定・費用の日時", endsAt: "終了", status: "現在の状態",
  categories: { event: "予定", expense: "費用", request: "申請", member: "メンバー", permissions: "権限", calendar: "Google カレンダー", trip: "旅行", ai: "AI", payment: "精算", system: "アプリ" },
  actions: { created: "作成", updated: "更新", requested: "変更申請", approved: "承認", rejected: "却下", cancelled: "キャンセル", restored: "復元", removed: "削除", voided: "無効化", synced: "同期", failed: "失敗", connected: "接続", disconnected: "接続解除", joined: "参加", disabled: "利用停止", enabled: "有効化", changed: "変更" },
  fields: { title: "名称", time: "日時", location: "場所", type: "予定の種類", status: "状態", visibility: "公開範囲", audience: "共有メンバー", amount: "金額", currency: "通貨", payer: "支払者", shares: "分担額", linkedExpense: "関連費用", linkedEvent: "関連予定", notes: "メモ", lock: "オーナーロック" },
  statuses: { pending: "承認待ち", approved: "承認済み", rejected: "却下済み", superseded: "置き換え済み", draft: "下書き", planned: "予定済み", cancelled: "キャンセル済み", completed: "完了", posted: "記録済み", void: "無効" },
};
export function activityMessages(locale: Locale): ActivityCopy { return localizedCatalog(locale, "activity", { en, "zh-HK": hk, "ja-JP": ja }); }
