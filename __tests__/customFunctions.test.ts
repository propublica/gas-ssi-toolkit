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

import { SSI, TOOL_REGISTRY } from "../src/server/customFunctions";

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
  });

  // ── inlineData normalization ─────────────────────────────────

  describe("inlineData normalization", () => {
    const driveUrl = "https://drive.google.com/file/d/abc123defgh456ijklm789nop/view";
    const driveUrl2 = "https://drive.google.com/file/d/xyz789defgh456ijklm012abc/view";

    it("attaches a single Drive URL as one inline_data part", () => {
      mockOkResponse("ok");
      mockDriveFile();
      SSI("prompt", driveUrl);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(2); // text + inline_data
      expect(payload.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
    });

    it("attaches multiple Drive URLs as multiple inline_data parts", () => {
      mockOkResponse("ok");
      mockDriveFile();
      SSI("prompt", [[driveUrl, driveUrl2]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3); // text + 2 inline_data
    });

    it("omits inline_data parts when inlineData is not provided", () => {
      mockOkResponse("ok");
      SSI("prompt");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(payload.contents[0].parts[0].inline_data).toBeUndefined();
    });
  });

  // ── systemPrompt ─────────────────────────────────────────────

  describe("systemPrompt", () => {
    it("sets system_instruction when provided", () => {
      mockOkResponse("ok");
      SSI("prompt", undefined, "Be concise");
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
      const result = SSI("prompt", undefined, undefined, "nonExistentTool");
      expect(result).toMatch(/\[SSI Error:.*nonExistentTool/);
    });

    it("includes a known tool declaration in the API payload", () => {
      mockOkResponse("ok");
      TOOL_REGISTRY["testTool"] = { name: "testTool", description: "A test tool" };
      SSI("prompt", undefined, undefined, "testTool");
      delete TOOL_REGISTRY["testTool"];
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.tools[0].function_declarations[0].name).toBe("testTool");
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
