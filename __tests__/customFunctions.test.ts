/**
 * Tests for src/server/customFunctions.ts
 *
 * Mocks UrlFetchApp and PropertiesService globally
 * before importing, per the GAS globals pattern used across this test suite.
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
};

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue("test-api-key"),
  }),
};

// ── Import after mocks ─────────────────────────────────────────

import { SSI } from "../src/server/customFunctions";

// ── Helpers ────────────────────────────────────────────────────

function mockFetchResponse(body: unknown): void {
  (UrlFetchApp.fetch as jest.Mock).mockReturnValue({
    getContentText: () => JSON.stringify(body),
  });
}

function mockOkResponse(text: string): void {
  mockFetchResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

// ── Tests ──────────────────────────────────────────────────────

describe("SSI", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── userTexts normalization ──────────────────────────────────

  describe("userTexts normalization", () => {
    it("accepts a single string", () => {
      mockOkResponse("ok");
      SSI("hello");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(payload.contents[0].parts[0].text).toBe("hello");
    });

    it("flattens a vertical range (multiple rows, one column)", () => {
      mockOkResponse("ok");
      SSI([["row1"], ["row2"], ["row3"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3);
      expect(payload.contents[0].parts[0].text).toBe("row1");
      expect(payload.contents[0].parts[2].text).toBe("row3");
    });

    it("flattens a horizontal range (one row, multiple columns)", () => {
      mockOkResponse("ok");
      SSI([["col1", "col2", "col3"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3);
    });

    it("filters empty strings from ranges", () => {
      mockOkResponse("ok");
      SSI([["text", "", "more text"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(2);
    });

    it("passes empty parts when userTexts is null", () => {
      mockOkResponse("ok");
      const result = SSI(null);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toEqual([]);
      expect(result).toBe("ok");
    });
  });

  // ── systemPrompt ─────────────────────────────────────────────

  describe("systemPrompt", () => {
    it("sets system_instruction when provided", () => {
      mockOkResponse("ok");
      SSI("prompt", "Be concise");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.system_instruction.parts[0].text).toBe("Be concise");
    });

    it("uses default system prompt when omitted", () => {
      mockOkResponse("ok");
      SSI("prompt");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
    });
  });

  // ── toolNames ────────────────────────────────────────────────

  describe("toolNames", () => {
    it("returns an error string for an unknown tool name", () => {
      const result = SSI("prompt", undefined, "nonExistentTool");
      expect(result).toMatch(/\[SSI Error:.*nonExistentTool/);
    });

    it("includes google_search in the API payload when specified", () => {
      mockOkResponse("ok");
      SSI("prompt", undefined, "google_search");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      // google_search is a grounding tool — appears as { google_search: {} }
      expect(payload.tools).toBeDefined();
      expect(payload.tools[0]).toHaveProperty("google_search");
    });
  });

  // ── API key ──────────────────────────────────────────────────

  describe("API key", () => {
    it("returns an error string when GEMINI_API_KEY is not set", () => {
      (PropertiesService.getScriptProperties().getProperty as jest.Mock).mockReturnValueOnce(null);
      const result = SSI("prompt");
      expect(result).toMatch(/\[SSI Error:.*GEMINI_API_KEY/);
    });
  });

  // ── error handling ───────────────────────────────────────────

  describe("error handling", () => {
    it("returns an error string on API error response", () => {
      mockFetchResponse({ error: { message: "quota exceeded" } });
      const result = SSI("prompt");
      expect(result).toMatch(/\[SSI Error:.*quota exceeded/);
    });

    it("returns the model text on success", () => {
      mockOkResponse("The answer is 42");
      const result = SSI("What is the answer?");
      expect(result).toBe("The answer is 42");
    });
  });
});
