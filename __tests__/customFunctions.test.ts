/**
 * Tests for src/server/customFunctions.ts
 *
 * Mocks UrlFetchApp, DriveApp, Utilities, and PropertiesService globally
 * before importing, per the GAS globals pattern used across this test suite.
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
};

(globalThis as any).DriveApp = {
  getFileById: jest.fn(),
};

(globalThis as any).Utilities = {
  base64Encode: jest.fn().mockReturnValue("base64data=="),
};

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue("test-api-key"),
  }),
};

// ── Import after mocks ─────────────────────────────────────────

import { GEMINI } from "../src/server/customFunctions";

// ── Helpers ────────────────────────────────────────────────────

function mockFetchResponse(body: unknown): void {
  (UrlFetchApp.fetch as jest.Mock).mockReturnValue({
    getContentText: () => JSON.stringify(body),
  });
}

function mockOkResponse(text: string): void {
  mockFetchResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function mockDriveFile(): void {
  (DriveApp.getFileById as jest.Mock).mockReturnValue({
    getMimeType: () => "application/pdf",
    getSize: () => 1024,
    getBlob: () => ({ getBytes: () => [1, 2, 3] }),
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("GEMINI", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── userTexts normalization ──────────────────────────────────

  describe("userTexts normalization", () => {
    it("accepts a single string", () => {
      mockOkResponse("ok");
      GEMINI("hello");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(payload.contents[0].parts[0].text).toBe("hello");
    });

    it("flattens a vertical range (multiple rows, one column)", () => {
      mockOkResponse("ok");
      GEMINI([["row1"], ["row2"], ["row3"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3);
      expect(payload.contents[0].parts[0].text).toBe("row1");
      expect(payload.contents[0].parts[2].text).toBe("row3");
    });

    it("flattens a horizontal range (one row, multiple columns)", () => {
      mockOkResponse("ok");
      GEMINI([["col1", "col2", "col3"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3);
    });

    it("filters empty strings from ranges", () => {
      mockOkResponse("ok");
      GEMINI([["text", "", "more text"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(2);
    });
  });

  // ── inlineData normalization ─────────────────────────────────

  describe("inlineData normalization", () => {
    const driveUrl = "https://drive.google.com/file/d/abc123defgh456ijklm789nop/view";
    const driveUrl2 = "https://drive.google.com/file/d/xyz789defgh456ijklm012abc/view";

    it("attaches a single Drive URL as one inline_data part", () => {
      mockOkResponse("ok");
      mockDriveFile();
      GEMINI("prompt", driveUrl);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(2); // text + inline_data
      expect(payload.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
    });

    it("attaches multiple Drive URLs as multiple inline_data parts", () => {
      mockOkResponse("ok");
      mockDriveFile();
      GEMINI("prompt", [[driveUrl, driveUrl2]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3); // text + 2 inline_data
    });

    it("omits inline_data parts when inlineData is not provided", () => {
      mockOkResponse("ok");
      GEMINI("prompt");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(payload.contents[0].parts[0].inline_data).toBeUndefined();
    });
  });

  // ── systemPrompt ─────────────────────────────────────────────

  describe("systemPrompt", () => {
    it("sets system_instruction when provided", () => {
      mockOkResponse("ok");
      GEMINI("prompt", undefined, "Be concise");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.system_instruction.parts[0].text).toBe("Be concise");
    });

    it("uses default system prompt when omitted", () => {
      mockOkResponse("ok");
      GEMINI("prompt");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
    });
  });

  // ── toolNames ────────────────────────────────────────────────

  describe("toolNames", () => {
    it("returns an error string for an unknown tool name", () => {
      const result = GEMINI("prompt", undefined, undefined, "nonExistentTool");
      expect(result).toMatch(/\[GEMINI Error:.*nonExistentTool/);
    });
  });

  // ── API key ──────────────────────────────────────────────────

  describe("API key", () => {
    it("returns an error string when GEMINI_API_KEY is not set", () => {
      (PropertiesService.getScriptProperties().getProperty as jest.Mock).mockReturnValueOnce(null);
      const result = GEMINI("prompt");
      expect(result).toMatch(/\[GEMINI Error:.*GEMINI_API_KEY/);
    });
  });

  // ── error handling ───────────────────────────────────────────

  describe("error handling", () => {
    it("returns an error string on API error response", () => {
      mockFetchResponse({ error: { message: "quota exceeded" } });
      const result = GEMINI("prompt");
      expect(result).toMatch(/\[GEMINI Error:.*quota exceeded/);
    });

    it("returns the model text on success", () => {
      mockOkResponse("The answer is 42");
      const result = GEMINI("What is the answer?");
      expect(result).toBe("The answer is 42");
    });
  });
});
