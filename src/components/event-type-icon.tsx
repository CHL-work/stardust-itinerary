import { Compass, Hotel, NotebookPen, Plane, PlaneLanding, PlaneTakeoff, Route, UtensilsCrossed } from "lucide-react";

type EventTypeIconProps = {
  itemType: string;
  isFlight?: boolean;
  endpoint?: "event" | "departure" | "arrival";
  size?: number;
};

// Use stored facts, never a title/language heuristic. Static imports keep the
// existing icon package tree-shakeable; these SVGs need no images or requests.
export function eventIconKind({ itemType, isFlight = false, endpoint = "event" }: EventTypeIconProps) {
  if (itemType === "transport") {
    if (isFlight) return endpoint === "departure" ? "flight-departure" : endpoint === "arrival" ? "flight-arrival" : "flight";
    return "transport";
  }
  if (itemType === "meal" || itemType === "lodging" || itemType === "note") return itemType;
  return "activity";
}

const icons = {
  activity: Compass,
  meal: UtensilsCrossed,
  lodging: Hotel,
  transport: Route,
  note: NotebookPen,
  flight: Plane,
  "flight-departure": PlaneTakeoff,
  "flight-arrival": PlaneLanding,
};

/** Decorative only: every caller retains its adjacent event/status text. */
export function EventTypeIcon({ size = 18, ...event }: EventTypeIconProps) {
  const kind = eventIconKind(event);
  const Icon = icons[kind];
  return <Icon size={size} className="event-type-icon" data-event-icon={kind} aria-hidden="true" focusable="false" />;
}
