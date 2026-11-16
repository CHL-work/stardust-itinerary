import { describe, expect, it } from "vitest";

import { suggestDestinationTimeZone } from "@/lib/app/destination-time-zones";

describe("suggested destination time zones (JOB-098)", () => {
  it("uses the offline locality catalog first", () => {
    expect(suggestDestinationTimeZone("Tokyo")).toBe("Asia/Tokyo");
    expect(suggestDestinationTimeZone("New York")).toBe("America/New_York");
    expect(suggestDestinationTimeZone("大阪")).toBe("Asia/Tokyo");
  });

  it("suggests the famous city where the catalog sees namesakes, and single-zone countries", () => {
    expect(suggestDestinationTimeZone("Paris")).toBe("Europe/Paris");
    expect(suggestDestinationTimeZone("  los angeles ")).toBe("America/Los_Angeles");
    expect(suggestDestinationTimeZone("Zürich")).toBe("Europe/Zurich");
    expect(suggestDestinationTimeZone("Japan")).toBe("Asia/Tokyo");
    expect(suggestDestinationTimeZone("ロサンゼルス")).toBe("America/Los_Angeles");
    expect(suggestDestinationTimeZone("倫敦")).toBe("Europe/London");
  });

  it("leaves unknown or multi-zone places for the traveller to choose", () => {
    expect(suggestDestinationTimeZone("Synthetic nowhere")).toBeNull();
    expect(suggestDestinationTimeZone("United States")).toBeNull();
    expect(suggestDestinationTimeZone("")).toBeNull();
  });
});
