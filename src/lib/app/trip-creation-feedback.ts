import { createTripSchema } from "@/lib/app/validation";
import { canSubmitTripCreation, type TripCreationFormState } from "./trip-creation-form-state";

export const tripCreationFields = ["name", "destinationName", "startsOn", "endsOn", "timeZone", "defaultCurrency", "maxMembers"] as const;
export type TripCreationField = typeof tripCreationFields[number];
export type TripCreationFailure = { kind: "fields"; fields: TripCreationField[] }
  | { kind: "auth" | "limit" | "forbidden" | "invalid" | "uncertain" };

export function tripCreationLocalDate(instant: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

function invalidFields(issues: unknown): TripCreationFailure {
  const fields = Array.isArray(issues) ? tripCreationFields.filter((field) => issues.some((issue) =>
    issue && typeof issue === "object" && Array.isArray(issue.path) && issue.path[0] === field)) : [];
  return fields.length ? { kind: "fields", fields } : { kind: "invalid" };
}

/** Never render arbitrary server prose or automatically replay an uncertain creation. */
export async function submitTripCreation(input: unknown, defaults?: TripCreationFormState): Promise<TripCreationFailure | null> {
  if (defaults && !canSubmitTripCreation(defaults)) return { kind: "fields", fields: [!defaults.zone || defaults.currency ? "timeZone" : "defaultCurrency"] };
  const parsed = createTripSchema.safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error.issues);
  if (parsed.data.endsOn < tripCreationLocalDate(new Date(), parsed.data.timeZone)) return { kind: "fields", fields: ["endsOn"] };
  try {
    const response = await fetch("/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
    const body = await response.json().catch(() => null);
    if (response.status === 201 && typeof body?.tripId === "string" && typeof body?.memberId === "string") return null;
    if (response.status === 401) return { kind: "auth" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409 && body?.error === "The daily limit of 10 new trips has been reached.") return { kind: "limit" };
    if (response.status === 400) {
      if (body?.error === "A new trip cannot end before today in its local time zone.") return { kind: "fields", fields: ["endsOn"] };
      return invalidFields(body?.issues);
    }
    return { kind: "uncertain" };
  } catch { return { kind: "uncertain" }; }
}
