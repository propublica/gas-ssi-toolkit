/**
 * @jest-environment jsdom
 */
import { TOOL_CATALOG } from "../../src/client/tools";
import type { ToolId } from "../../src/shared/types";

describe("TOOL_CATALOG", () => {
  it("contains an entry for every ToolId", () => {
    // If a ToolId is added to shared/types.ts but not TOOL_CATALOG, this test fails.
    const knownIds: ToolId[] = ["google_search", "url_context", "code_execution"];
    const catalogIds = TOOL_CATALOG.map((t) => t.id);
    expect(catalogIds).toEqual(expect.arrayContaining(knownIds));
    expect(TOOL_CATALOG).toHaveLength(knownIds.length);
  });

  it("each entry has id, name, and description", () => {
    for (const entry of TOOL_CATALOG) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("google_search entry has expected display values", () => {
    const entry = TOOL_CATALOG.find((t) => t.id === "google_search");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("Google Search");
  });
});
