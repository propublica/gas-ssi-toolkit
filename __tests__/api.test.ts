/**
 * Tests for src/server/api.ts
 *
 * Requires mocking UrlFetchApp, DriveApp, and Utilities globals.
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
    getProperty: jest.fn(),
  }),
};

// ── Import after mocks ─────────────────────────────────────────

import { callGeminiAPI } from "../src/server/api";

// ── Helpers ────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, code = 200) {
  (UrlFetchApp.fetch as jest.Mock).mockReturnValue({
    getResponseCode: () => code,
    getContentText: () => JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("callGeminiAPI", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends text context appended to the user prompt", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "AI says hello" }] } }],
    });

    const result = callGeminiAPI("key123", "Be helpful", "Summarize this", {
      textContext: "Some document text here",
    });

    expect(result).toBe("AI says hello");

    // Verify the payload sent to UrlFetchApp
    const callArgs = (UrlFetchApp.fetch as jest.Mock).mock.calls[0];
    const payload = JSON.parse(callArgs[1].payload);

    expect(payload.system_instruction.parts[0].text).toBe("Be helpful");
    expect(payload.contents[0].parts[0].text).toContain("Summarize this");
    expect(payload.contents[0].parts[0].text).toContain("--- CONTEXT ---");
    expect(payload.contents[0].parts[0].text).toContain("Some document text here");
  });

  it("sends file as inline_data for FILE mode", () => {
    const mockFile = {
      getMimeType: () => "application/pdf",
      getSize: () => 1024,
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    };
    (DriveApp.getFileById as jest.Mock).mockReturnValue(mockFile);

    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "Analyzed your PDF" }] } }],
    });

    const result = callGeminiAPI("key123", "Be helpful", "What is this?", {
      fileId: "file123abc",
    });

    expect(result).toBe("Analyzed your PDF");

    const callArgs = (UrlFetchApp.fetch as jest.Mock).mock.calls[0];
    const payload = JSON.parse(callArgs[1].payload);
    expect(payload.contents[0].parts).toHaveLength(2);
    expect(payload.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
  });

  it("throws on file size exceeding 25MB", () => {
    const mockFile = {
      getMimeType: () => "application/pdf",
      getSize: () => 30 * 1024 * 1024, // 30MB
      getBlob: () => ({ getBytes: () => [] }),
    };
    (DriveApp.getFileById as jest.Mock).mockReturnValue(mockFile);

    expect(() =>
      callGeminiAPI("key123", "", "analyze", { fileId: "bigfile" }),
    ).toThrow("File too large");
  });

  it("throws on API error response", () => {
    mockFetchResponse({ error: { message: "Invalid API key" } });

    expect(() =>
      callGeminiAPI("badkey", "", "test", { textContext: "ctx" }),
    ).toThrow("Invalid API key");
  });

  it("returns 'No response.' when candidates are empty", () => {
    mockFetchResponse({ candidates: [] });

    const result = callGeminiAPI("key123", "", "test", { textContext: "ctx" });
    expect(result).toBe("No response.");
  });

  it("uses default system prompt when none provided", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
    });

    callGeminiAPI("key123", "", "test", { textContext: "ctx" });

    const callArgs = (UrlFetchApp.fetch as jest.Mock).mock.calls[0];
    const payload = JSON.parse(callArgs[1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
  });
});
