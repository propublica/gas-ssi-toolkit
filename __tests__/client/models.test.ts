/**
 * @jest-environment jsdom
 */
import { MODEL_CATALOG } from "../../src/client/models";
import type { ModelId } from "../../src/shared/types";

describe("MODEL_CATALOG", () => {
  it("contains an entry for every ModelId", () => {
    const knownIds: ModelId[] = [
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
    ];
    const catalogIds = MODEL_CATALOG.map((m) => m.id);
    expect(catalogIds).toEqual(expect.arrayContaining(knownIds));
    expect(MODEL_CATALOG).toHaveLength(knownIds.length);
  });

  it("each entry has id, name, and description", () => {
    for (const entry of MODEL_CATALOG) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("first entry is the default model", () => {
    expect(MODEL_CATALOG[0].id).toBe("gemini-3.1-flash-lite");
    expect(MODEL_CATALOG[0].name).toBe("Gemini 3.1 Flash Lite");
  });
});
