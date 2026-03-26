/**
 * Tests for buildGeminiPayload — function-calling tool path.
 *
 * This file mocks the TOOL_REGISTRY to include a function-calling entry,
 * exercising the function_declarations assembly branch in buildGeminiPayload.
 * Kept separate from api.test.ts to avoid module-mock interference.
 */

jest.mock("../src/server/tools", () => ({
  TOOL_REGISTRY: {
    google_search: {
      kind: "function",
      declaration: { name: "google_search", description: "Run a web search" },
    },
  },
}));

import { buildGeminiPayload } from "../src/server/api";
import type { GeminiRequest } from "../src/server/types";
import type { ToolId } from "../src/shared/types";

const baseReq: GeminiRequest = {
  apiKey: "key",
  parts: [{ kind: "text", text: "hello" }],
};

describe("buildGeminiPayload — function-calling tool", () => {
  it("assembles a function_declarations entry when the tool is a function kind", () => {
    const payload = buildGeminiPayload({ ...baseReq, tools: ["google_search" as ToolId] });
    const tools = payload.tools as unknown[];
    expect(tools).toHaveLength(1);
    const entry = tools[0] as { function_declarations: unknown[] };
    expect(entry).toHaveProperty("function_declarations");
    expect(entry.function_declarations[0]).toEqual({
      name: "google_search",
      description: "Run a web search",
    });
  });

  it("omits grounding entries and includes only function_declarations when all tools are functions", () => {
    const payload = buildGeminiPayload({ ...baseReq, tools: ["google_search" as ToolId] });
    const tools = payload.tools as unknown[];
    // Should not have a plain { google_search: {} } grounding entry
    expect(tools[0]).not.toHaveProperty("google_search");
  });
});
