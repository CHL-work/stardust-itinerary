import { describe, expect, it } from "vitest";

import { adjacentTrips } from "@/lib/app/trip-navigation";

const trip = (id: string, startsOn: string, endsOn: string, name = id) => ({ id, name, startsOn, endsOn });

describe("adjacent trips", () => {
  const trips = [trip("late", "2031-02-01", "2031-02-05"), trip("early", "2030-01-01", "2030-01-05"), trip("middle", "2030-06-01", "2030-06-10")];

  it("orders by travel date, not by the list order the server sends", () => {
    expect(adjacentTrips(trips, "middle")).toEqual({ previous: trips[1], next: trips[0] });
  });

  it("has no previous trip before the earliest and no next trip after the latest", () => {
    expect(adjacentTrips(trips, "early")).toEqual({ previous: null, next: trips[2] });
    expect(adjacentTrips(trips, "late")).toEqual({ previous: trips[2], next: null });
  });

  it("offers nothing for a single trip or a trip outside the list", () => {
    expect(adjacentTrips([trips[0]], "late")).toEqual({ previous: null, next: null });
    expect(adjacentTrips(trips, "unknown")).toEqual({ previous: null, next: null });
  });

  it("gives overlapping and same-day trips one stable order in both directions", () => {
    const longer = trip("a-longer", "2030-01-01", "2030-01-09");
    const shorter = trip("z-shorter", "2030-01-01", "2030-01-03");
    const sameB = trip("same-b", "2030-03-01", "2030-03-02", "Bravo");
    const sameA = trip("same-a", "2030-03-01", "2030-03-02", "Alpha");
    const list = [sameB, longer, sameA, shorter];
    expect(adjacentTrips(list, shorter.id)).toEqual({ previous: null, next: longer });
    expect(adjacentTrips(list, longer.id)).toEqual({ previous: shorter, next: sameA });
    expect(adjacentTrips(list, sameA.id)).toEqual({ previous: longer, next: sameB });
    expect(adjacentTrips(list, sameB.id)).toEqual({ previous: sameA, next: null });
  });

  it("does not reorder the caller's list", () => {
    const list = [...trips];
    adjacentTrips(list, "middle");
    expect(list).toEqual(trips);
  });
});
