import { z } from "zod";

const textOrNullSchema = z.union([z.string().max(10_000), z.null()]);

const itineraryContentSchema = z.object({
  title: z.string().trim().min(1).max(240),
  locationName: textOrNullSchema,
  notes: textOrNullSchema,
}).strict();

const translationItemSchema = z.object({
  dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: itineraryContentSchema,
  cantonese: itineraryContentSchema,
}).strict().superRefine((item, context) => {
  if (!/\p{Script=Han}/u.test(item.cantonese.title)) {
    context.addIssue({
      code: "custom",
      path: ["cantonese", "title"],
      message: "A Cantonese event title must contain at least one Han character.",
    });
  }
});

const translationTripSchema = z.object({
  name: z.string().trim().min(1).max(160),
  items: z.array(translationItemSchema).min(1),
}).strict().superRefine((trip, context) => {
  const titleOwners = new Map<string, number>();
  for (const [itemIndex, item] of trip.items.entries()) {
    for (const title of new Set([item.source.title, item.cantonese.title])) {
      const key = `${item.dayDate}\0${title}`;
      const earlierIndex = titleOwners.get(key);
      if (earlierIndex !== undefined && earlierIndex !== itemIndex) {
        context.addIssue({
          code: "custom",
          path: ["items", itemIndex, "source", "title"],
          message: "Source and Cantonese titles must identify exactly one event inside a trip.",
        });
      }
      titleOwners.set(key, itemIndex);
    }
  }
});

const translationPlanSchema = z.object({
  version: z.literal(1),
  exactTripNames: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  expectedItemCount: z.number().int().positive(),
  trips: z.array(translationTripSchema).min(1).max(20),
}).strict().superRefine((plan, context) => {
  const allowedNames = new Set<string>();
  for (const [nameIndex, name] of plan.exactTripNames.entries()) {
    if (allowedNames.has(name)) {
      context.addIssue({
        code: "custom",
        path: ["exactTripNames", nameIndex],
        message: "Allowed trip names must be unique.",
      });
    }
    allowedNames.add(name);
  }
  const plannedNames = new Set(plan.trips.map((trip) => trip.name));
  for (const [nameIndex, name] of plan.exactTripNames.entries()) {
    if (!plannedNames.has(name)) {
      context.addIssue({
        code: "custom",
        path: ["exactTripNames", nameIndex],
        message: "Every allowed trip name must have one translation entry.",
      });
    }
  }
  if (plannedNames.size !== plan.trips.length || plannedNames.size !== allowedNames.size) {
    context.addIssue({
      code: "custom",
      path: ["trips"],
      message: "The plan must contain exactly one entry for every allowed trip name.",
    });
  }
  const itemCount = plan.trips.reduce((total, trip) => total + trip.items.length, 0);
  if (itemCount !== plan.expectedItemCount) {
    context.addIssue({
      code: "custom",
      path: ["trips"],
      message: `The plan must contain exactly ${plan.expectedItemCount} itinerary items.`,
    });
  }
});

export type ItineraryTranslationContent = z.infer<typeof itineraryContentSchema>;
export type ItineraryTranslationPlan = z.infer<typeof translationPlanSchema>;
export type ItineraryTranslationTrip = ItineraryTranslationPlan["trips"][number];

export type CurrentItineraryItem = ItineraryTranslationContent & {
  id: string;
  dayDate: string;
  currentRevision: number;
  mapUrl: string | null;
  visibleToOwner: boolean;
};

export type PlannedItineraryTranslation = {
  itemId: string;
  baseRevision: number;
  before: ItineraryTranslationContent;
  after: ItineraryTranslationContent;
  originalMapUrl: string | null;
  changed: boolean;
};

export function parseItineraryTranslationPlan(input: unknown): ItineraryTranslationPlan {
  return translationPlanSchema.parse(input);
}

export function assertLocalPostgresUrl(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_DIRECT_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_DIRECT_URL must use the postgres or postgresql protocol.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(hostname)) {
    throw new Error("Itinerary translation is local-only; DATABASE_DIRECT_URL must use a loopback host.");
  }
  if (url.searchParams.has("host") || url.searchParams.has("hostaddr")) {
    throw new Error("DATABASE_DIRECT_URL cannot override its loopback host through query parameters.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName || new Set(["postgres", "template0", "template1"]).has(databaseName)) {
    throw new Error("DATABASE_DIRECT_URL must name a dedicated local application database.");
  }
  return url;
}

export function assertLoopbackServerAddress(
  address: string | null,
  configuredAddresses?: string,
): void {
  const normalized = address
    ?.toLowerCase()
    .replace(/^::ffff:/, "")
    .replace(/\/\d+$/, "") ?? null;
  if (normalized === "127.0.0.1" || normalized === "::1") return;

  // PostgreSQL reports NULL for local socket-style connections. In that case,
  // still require the server itself to listen only on loopback interfaces.
  const configured = configuredAddresses
    ?.split(",")
    .map((candidate) => candidate.trim().toLowerCase())
    .filter(Boolean);
  const loopbackOnly = normalized === null
    && configured !== undefined
    && configured.length > 0
    && configured.every((candidate) => new Set(["127.0.0.1", "::1", "localhost"]).has(candidate));
  if (!loopbackOnly) {
    throw new Error(
      "The connected PostgreSQL server did not report a loopback address; refusing local-only maintenance.",
    );
  }
}

export function assertSelectedTripsComplete(
  plan: ItineraryTranslationPlan,
  selectedTrips: Array<{ name: string }>,
): void {
  const selectedNames = selectedTrips.map((trip) => trip.name).sort();
  const expectedNames = [...plan.exactTripNames].sort();
  if (selectedNames.length !== expectedNames.length
      || selectedNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error(
      "The database must contain exactly one copy of every allowed local trip "
      + `(selected ${selectedTrips.length}, expected ${expectedNames.length}).`,
    );
  }
}

function contentMatches(
  current: CurrentItineraryItem,
  expected: ItineraryTranslationContent,
): boolean {
  return current.title === expected.title
    && current.locationName === expected.locationName
    && current.notes === expected.notes;
}

export function prepareTripTranslations(
  trip: ItineraryTranslationTrip,
  currentItems: CurrentItineraryItem[],
): PlannedItineraryTranslation[] {
  if (currentItems.length !== trip.items.length) {
    throw new Error(
      `Trip “${trip.name}” translation must cover every itinerary item `
      + `(database ${currentItems.length}, planned ${trip.items.length}).`,
    );
  }

  const usedMappings = new Set<number>();
  const prepared = currentItems.map((current) => {
    const candidates = trip.items
      .map((mapping, index) => ({ mapping, index }))
      .filter(({ mapping }) => current.dayDate === mapping.dayDate
        && (current.title === mapping.source.title
          || current.title === mapping.cantonese.title));
    if (candidates.length !== 1) {
      throw new Error(`“${current.title}” does not identify exactly one audited translation.`);
    }
    const { mapping, index } = candidates[0];
    if (usedMappings.has(index)) {
      throw new Error(`“${current.title}” matches a translation already used by another event.`);
    }
    usedMappings.add(index);

    if (!current.visibleToOwner) {
      throw new Error(
        `“${current.title}” is private and is not visible to the owner; `
        + "its creator must translate or share it first.",
      );
    }
    const isSource = contentMatches(current, mapping.source);
    const isTranslated = contentMatches(current, mapping.cantonese);
    if (!isSource && !isTranslated) {
      throw new Error(
        `“${current.title}” has content that matches neither the audited source nor Cantonese target.`,
      );
    }

    return {
      itemId: current.id,
      baseRevision: current.currentRevision,
      before: mapping.source,
      after: mapping.cantonese,
      originalMapUrl: current.mapUrl,
      changed: !isTranslated,
    };
  });

  if (usedMappings.size !== trip.items.length) {
    throw new Error(`Trip “${trip.name}” did not match every audited translation.`);
  }
  return prepared;
}
