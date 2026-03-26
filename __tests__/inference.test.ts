/**
 * Tests for src/server/inference.ts
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

(globalThis as any).DriveApp = {
  getFileById: jest.fn().mockReturnValue({
    getMimeType: () => "application/pdf",
    getSize: () => 1000,
    getBlob: () => ({ getBytes: () => [1, 2, 3] }),
  }),
};

(globalThis as any).Utilities = {
  base64Encode: jest.fn().mockReturnValue("encoded=="),
};

(globalThis as any).Drive = {
  Files: { export: jest.fn() },
};

(globalThis as any).SpreadsheetApp = {
  openById: jest.fn(),
};

(globalThis as any).MimeType = {
  GOOGLE_DOCS: "application/vnd.google-apps.document",
  GOOGLE_SHEETS: "application/vnd.google-apps.spreadsheet",
  PDF: "application/pdf",
};

// ── Import after mocks ─────────────────────────────────────────

import { runInference } from "../src/server/inference";

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

describe("runInference", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the model response string for a scalar user prompt", () => {
    mockOkResponse("AI response");
    expect(runInference([{ kind: "text", value: "Hello AI" }])?.text).toBe("AI response");
  });

  it("returns null when all inputs flatten to empty", () => {
    expect(runInference([{ kind: "text", value: null }])).toBeNull();
    expect(runInference([{ kind: "text", value: "" }])).toBeNull();
  });

  it("flattens a vertical range of user prompts", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: [["p1"], ["p2"]] }]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(2);
    expect(payload.contents[0].parts[0].text).toBe("p1");
    expect(payload.contents[0].parts[1].text).toBe("p2");
  });

  it("encodes a valid drive link as inlineData", () => {
    mockOkResponse("ok");
    runInference([
      { kind: "text", value: "prompt" },
      { kind: "file", value: "https://drive.google.com/file/d/abc123/view" },
    ]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[1].inline_data).toEqual({
      mime_type: "application/pdf",
      data: "encoded==",
    });
  });

  it("filters out invalid drive links silently", () => {
    mockOkResponse("ok");
    runInference([
      { kind: "text", value: "prompt" },
      { kind: "file", value: "not-a-drive-link" },
    ]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(1); // text only, no inline_data
  });

  it("omits inlineData from payload when no file inputs given", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(1);
  });

  it("passes systemPrompt to the payload", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }], "Be concise");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("Be concise");
  });

  it("uses default system prompt when systemPrompt is omitted", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
  });

  it("returns an error string when invokeGemini throws", () => {
    mockFetchResponse({ error: { message: "quota exceeded" } });
    expect(runInference([{ kind: "text", value: "prompt" }])?.text).toBe("Error: quota exceeded");
  });

  it("returns an error string when Drive fetch throws", () => {
    (DriveApp.getFileById as jest.Mock).mockImplementationOnce(() => {
      throw new Error("File not found");
    });
    expect(
      runInference([
        { kind: "text", value: "prompt" },
        { kind: "file", value: "https://drive.google.com/file/d/abc123/view" },
      ])?.text,
    ).toBe("Error: File not found");
  });

  it("passes tools to the payload when provided", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }], undefined, ["google_search"]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.tools).toBeDefined();
    expect(payload.tools[0]).toHaveProperty("google_search");
  });

  it("omits tools from the payload when not provided", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.tools).toBeUndefined();
  });
});
