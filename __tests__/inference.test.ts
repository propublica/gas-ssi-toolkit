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

import { runInference, buildInferenceRequest } from "../src/server/inference";

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

  describe("label prefix", () => {
    it("prefixes a text part with the label and a colon-space separator", () => {
      mockOkResponse("ok");
      runInference([{ kind: "text", value: "hello", label: "Summary" }]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts[0].text).toBe("Summary: hello");
    });

    it("prefixes every part when a labeled input flattens to multiple texts", () => {
      mockOkResponse("ok");
      runInference([{ kind: "text", value: [["first"], ["second"]], label: "Notes" }]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts[0].text).toBe("Notes: first");
      expect(payload.contents[0].parts[1].text).toBe("Notes: second");
    });

    it("does not prefix text parts when label is absent", () => {
      mockOkResponse("ok");
      runInference([{ kind: "text", value: "hello" }]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts[0].text).toBe("hello");
    });

    it("does not prefix file parts when label is set", () => {
      mockOkResponse("ok");
      runInference([
        { kind: "file", value: "https://drive.google.com/file/d/abc123/view", label: "Attachment" },
      ]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(payload.contents[0].parts[0].inline_data).toBeDefined();
      expect(payload.contents[0].parts[0].text).toBeUndefined();
    });
  });
});

describe("buildInferenceRequest", () => {
  it("returns a GeminiRequest for a text input", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "Hello" }]);
    expect(req).not.toBeNull();
    expect(req!.userParts).toEqual([{ text: "Hello" }]);
  });

  it("returns null when all inputs are empty", () => {
    expect(buildInferenceRequest([{ kind: "text", value: "" }])).toBeNull();
    expect(buildInferenceRequest([{ kind: "text", value: null }])).toBeNull();
  });

  it("includes systemPrompt in the returned request", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "Q" }], "Be concise");
    expect(req!.systemPrompt).toBe("Be concise");
  });

  it("includes tools in the returned request", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "Q" }], undefined, ["google_search"]);
    expect(req!.tools).toEqual(["google_search"]);
  });

  it("uses file URI from fileUriMap for file inputs", () => {
    // extractId requires 25+ char IDs (real Drive IDs are always this length)
    const realFileId = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs";
    const fileUriMap = new Map([
      [
        realFileId,
        {
          uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
          mimeType: "application/pdf",
        },
      ],
    ]);
    const req = buildInferenceRequest(
      [{ kind: "file", value: `https://drive.google.com/file/d/${realFileId}/view` }],
      undefined,
      undefined,
      fileUriMap,
    );
    expect(req).not.toBeNull();
    expect(req!.userParts).toEqual([
      {
        file_data: {
          file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
          mime_type: "application/pdf",
        },
      },
    ]);
  });

  it("skips file inputs with no URI in fileUriMap", () => {
    const fileUriMap = new Map<string, { uri: string; mimeType: string }>();
    // Use a realistic 25+ char ID that is NOT in the map
    const req = buildInferenceRequest(
      [
        {
          kind: "file",
          value: "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view",
        },
      ],
      undefined,
      undefined,
      fileUriMap,
    );
    // No parts — returns null
    expect(req).toBeNull();
  });

  it("uses prepareDriveAttachments (inline path) when no fileUriMap provided", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 1000,
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
      getName: () => "test.pdf",
    });
    (Utilities.base64Encode as jest.Mock).mockReturnValue("encoded==");

    // Use a realistic 25+ char ID so extractId can parse it
    const req = buildInferenceRequest([
      {
        kind: "file",
        value: "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view",
      },
    ]);
    expect(req).not.toBeNull();
    expect(req!.userParts[0]).toHaveProperty("inline_data");
  });

  it("prefixes text parts with label when label is set", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "content", label: "Article" }]);
    expect(req!.userParts[0]).toEqual({ text: "Article: content" });
  });

  it("does not add apiKey (caller responsibility)", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "Q" }]);
    expect(req).not.toHaveProperty("apiKey");
  });
});
