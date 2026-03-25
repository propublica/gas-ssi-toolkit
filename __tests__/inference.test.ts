/**
 * Tests for src/server/inference.ts
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockFetch = jest.fn();
const mockDriveApp = {
  getFileById: jest.fn().mockReturnValue({
    getMimeType: () => "application/pdf",
    getSize: () => 1000,
    getBlob: () => ({ getBytes: () => [1, 2, 3] }),
  }),
};
(globalThis as any).UrlFetchApp = {
  fetch: mockFetch,
};

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue("test-api-key"),
  }),
};

(globalThis as any).DriveApp = mockDriveApp;

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
  mockFetch.mockReturnValue({
    getContentText: () => JSON.stringify(body),
  });
}

function mockOkResponse(text: string): void {
  mockFetchResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

const validResponse = { candidates: [{ content: { parts: [{ text: "ok" }] } }] };

// ── Tests ──────────────────────────────────────────────────────

describe("runInference", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the model response string for a scalar user prompt", () => {
    mockOkResponse("AI response");
    expect(runInference([{ kind: "text", value: "Hello AI" }])?.text).toBe("AI response");
  });

  it("returns null when userPrompts flattens to empty", () => {
    expect(runInference([{ kind: "text", value: null }])).toBeNull();
    expect(runInference([{ kind: "text", value: "" }])).toBeNull();
  });

  it("flattens a vertical range of user prompts", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: [["p1"], ["p2"]] }]);
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
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
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
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
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(1); // text only, no inline_data
  });

  it("omits inlineData from payload when no file parts provided", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }]);
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(1);
  });

  it("passes systemPrompt to the payload", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }], "Be concise");
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("Be concise");
  });

  it("uses default system prompt when systemPrompt is omitted", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }]);
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
  });

  it("returns an error string when invokeGemini throws", () => {
    mockFetchResponse({ error: { message: "quota exceeded" } });
    expect(runInference([{ kind: "text", value: "prompt" }])?.text).toBe("Error: quota exceeded");
  });

  it("returns an error string when Drive fetch throws", () => {
    mockDriveApp.getFileById.mockImplementationOnce(() => {
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
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
    expect(payload.tools).toBeDefined();
    expect(payload.tools[0]).toHaveProperty("google_search");
  });

  it("omits tools from the payload when not provided", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "prompt" }]);
    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
    expect(payload.tools).toBeUndefined();
  });

  it("separates text and file parts into userTexts and inlineData", () => {
    mockFetch.mockReturnValue({
      getContentText: () => JSON.stringify(validResponse),
    });

    runInference(
      [
        { kind: "text", value: "describe this" },
        { kind: "file", value: "https://drive.google.com/file/d/abc123/view" },
        { kind: "text", value: "is it relevant?" },
      ],
      "you are an analyst",
    );

    const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
    // buildGeminiPayload puts all text parts first, then all inline_data parts
    expect(payload.contents[0].parts[0].text).toBe("describe this");
    expect(payload.contents[0].parts[1].text).toBe("is it relevant?");
    expect(payload.contents[0].parts[2].inline_data).toBeDefined();
    expect(payload.system_instruction.parts[0].text).toBe("you are an analyst");
  });

  it("returns null when no non-empty text parts", () => {
    const result = runInference([{ kind: "text", value: "" }]);
    expect(result).toBeNull();
  });

  it("silently filters invalid Drive links from file parts", () => {
    mockOkResponse("ok");
    runInference([
      { kind: "text", value: "prompt" },
      { kind: "file", value: "not-a-drive-link" },
    ]);
    expect(mockDriveApp.getFileById).not.toHaveBeenCalled();
  });
});
