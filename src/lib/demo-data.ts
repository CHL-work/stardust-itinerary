export type DemoItineraryItem = {
  id: string;
  time: string;
  duration: string;
  title: string;
  place: string;
  category: "meal" | "travel" | "activity" | "free";
  state: "complete" | "next" | "later";
  mapUrl?: string;
  cost?: string;
};

export const demoTrip = {
  name: "Tokyo Golden Wind · 東京黃金體驗",
  dateLabel: "SUN · OCT 18",
  progressPercent: 42,
  nextEvent: {
    time: "10:30",
    leaveBy: "09:40",
    title: "東京國立博物館",
    place: "上野公園 13-9",
    mapUrl:
      "https://www.google.com/maps/search/?api=1&query=Tokyo+National+Museum",
  },
  itinerary: [
    {
      id: "breakfast",
      time: "08:00",
      duration: "45 min",
      title: "喫茶店早餐",
      place: "Kayaba Coffee · 谷中",
      category: "meal",
      state: "complete",
      cost: "¥4,800",
    },
    {
      id: "museum",
      time: "10:30",
      duration: "2 hr",
      title: "東京國立博物館",
      place: "上野公園 13-9",
      category: "activity",
      state: "next",
      mapUrl:
        "https://www.google.com/maps/search/?api=1&query=Tokyo+National+Museum",
      cost: "¥20,000",
    },
    {
      id: "lunch",
      time: "13:15",
      duration: "75 min",
      title: "午餐 · 鰻魚飯",
      place: "上野區 · 待確認",
      category: "meal",
      state: "later",
      cost: "¥36,000 est.",
    },
    {
      id: "free-time",
      time: "15:00",
      duration: "2 hr",
      title: "谷中銀座自由時間",
      place: "日暮里方向",
      category: "free",
      state: "later",
    },
  ] satisfies DemoItineraryItem[],
  people: ["JO", "KA", "PO", "AV", "IG"],
  appCosts: {
    llm: "$0.0362",
    hosting: "$0.18",
    total: "$0.2162",
    calls: 7,
  },
  expenses: {
    total: "¥128,400",
    yourBalance: "¥6,320",
    pending: 3,
  },
} as const;
