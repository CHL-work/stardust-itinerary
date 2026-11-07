import { describe, expect, it } from "vitest";
import { ownKeyModel, ownKeyModels } from "@/lib/ai/own-key-model";
import { GUEST_FREE_MODEL } from "@/lib/app/types";

describe("keyed models exclude the keyless slot", () => {
  it("does not list a free model even for a forged provider name", () => {
    expect(ownKeyModels(["openai", "kilo"])).not.toContain(GUEST_FREE_MODEL);
    expect(ownKeyModels(["kilo"])).toEqual([]);
  });
  it("never resolves free as an own or shared model", () => {
    expect(ownKeyModel(GUEST_FREE_MODEL, undefined, new Set(["kilo", "openai"]), false)).toBeNull();
    expect(ownKeyModel(undefined, GUEST_FREE_MODEL, new Set(["kilo"]), false)).toBeNull();
    expect(ownKeyModel(undefined, GUEST_FREE_MODEL, new Set(["kilo", "openai"]), false)).toBe("gpt-6.1-sol");
  });
});
