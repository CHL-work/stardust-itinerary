import type { Locale } from "@/lib/i18n";

const english = {
  tab: "AI",
  title: "Your AI conversations",
  conversations: "Conversations",
  newConversation: "New conversation",
  continueConversation: "Continue conversation",
  currentConversation: "Current",
  archivedConversation: "Previous",
  emptyConversations: "Your conversations will appear here after your first message.",
  emptyMessages: "Ask a question to start planning your trip.",
  selectConversation: "Choose a conversation to read its messages.",
  loadOlder: "Load older messages",
  loadMoreConversations: "More conversations",
  loading: "Loading conversation…",
  loadFailed: "Could not load your conversation. Please try again.",
  retry: "Try again",
  you: "You",
  assistant: "AI",
  privateNotice: "Only your own conversations for this trip appear here. The owner can still review the separate audit log. Reading history does not use AI tokens.",
  continueNotice: "You are reading a previous conversation. Continue it to use its saved context for your next question.",
  busyNotice: "Your AI request is still running. You can read any conversation; wait for it to finish before switching or starting a new one.",
  latestMessages: "Latest messages",
  messageFailed: "This request failed. It was not automatically sent again.",
  messageInterrupted: "This request was interrupted. Check pending changes before trying again.",
  messageRunning: "AI is still working on this message…",
  viewHistory: "View all conversations",
  modelLabel: "Model",
};

export type AiHistoryMessages = { [K in keyof typeof english]: string };

const cantonese: AiHistoryMessages = {
  tab: "AI",
  title: "你的 AI 對話",
  conversations: "對話紀錄",
  newConversation: "開始新對話",
  continueConversation: "繼續這段對話",
  currentConversation: "目前對話",
  archivedConversation: "過往對話",
  emptyConversations: "傳送第一個問題後，你的對話會顯示在這裏。",
  emptyMessages: "問個問題，開始規劃旅程。",
  selectConversation: "選擇一段對話查看訊息。",
  loadOlder: "載入較早訊息",
  loadMoreConversations: "更多對話",
  loading: "正在載入對話…",
  loadFailed: "未能載入你的對話，請重試。",
  retry: "重試",
  you: "你",
  assistant: "AI",
  privateNotice: "這裏只顯示你在此旅程的對話。管理員仍可查看獨立的審計紀錄。查看舊訊息不會使用 AI tokens。",
  continueNotice: "你正在閱讀過往對話。按「繼續這段對話」，下一個問題就會使用它的已儲存上下文。",
  busyNotice: "你的 AI 請求仍在處理。你可以閱讀其他對話；請等待完成後再切換或開始新對話。",
  latestMessages: "最新訊息",
  messageFailed: "此請求失敗，系統沒有自動重新傳送。",
  messageInterrupted: "此請求已中斷。請先檢查待批變更，再決定是否重試。",
  messageRunning: "AI 仍在處理這個問題…",
  viewHistory: "查看全部對話",
  modelLabel: "模型",
};

const japanese: AiHistoryMessages = {
  tab: "AI",
  title: "あなたのAI会話",
  conversations: "会話履歴",
  newConversation: "新しい会話",
  continueConversation: "この会話を続ける",
  currentConversation: "現在の会話",
  archivedConversation: "以前の会話",
  emptyConversations: "最初のメッセージを送信すると、ここに会話が表示されます。",
  emptyMessages: "質問を送信して旅行の計画を始めましょう。",
  selectConversation: "会話を選んでメッセージを表示してください。",
  loadOlder: "以前のメッセージを読み込む",
  loadMoreConversations: "さらに会話を表示",
  loading: "会話を読み込み中…",
  loadFailed: "会話を読み込めませんでした。もう一度お試しください。",
  retry: "再試行",
  you: "あなた",
  assistant: "AI",
  privateNotice: "この旅行での自分の会話だけが表示されます。オーナーは別の監査ログを確認できます。履歴の閲覧でAIトークンは消費しません。",
  continueNotice: "以前の会話を表示しています。「この会話を続ける」を押すと、次の質問で保存済みの文脈を使用します。",
  busyNotice: "AIリクエストを処理中です。他の会話は閲覧できます。会話の切り替えや新規作成は完了後に行ってください。",
  latestMessages: "最新のメッセージ",
  messageFailed: "このリクエストは失敗しました。自動再送信はしていません。",
  messageInterrupted: "このリクエストは中断されました。再試行の前に承認待ちの変更を確認してください。",
  messageRunning: "AIがこのメッセージを処理中です…",
  viewHistory: "すべての会話を表示",
  modelLabel: "モデル",
};

export function aiHistoryMessages(locale: Locale): AiHistoryMessages {
  if (locale === "ja-JP") return japanese;
  // Privacy and request reliability copy stays neutral in both Cantonese modes.
  if (locale === "zh-HK" || locale === "zh-HK-lihkg") return cantonese;
  return english;
}
