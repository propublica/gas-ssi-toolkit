/**
 * Tests for src/server/api.ts
 *
 * GAS globals mocked: UrlFetchApp (callGeminiAPI) and PropertiesService
 * (invokeGemini). DriveApp and Utilities are not used in this module.
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

import {
  buildGeminiPayload,
  callGeminiAPI,
  invokeGemini,
  getCitations,
  getUngroundedSpans,
  getAllSources,
} from "../src/server/api";
import { CONFIG } from "../src/server/config";
import type { GeminiRequest, GeminiResponse } from "../src/server/types";

// ── Helpers ────────────────────────────────────────────────────

function mockFetchResponse(body: unknown) {
  (UrlFetchApp.fetch as jest.Mock).mockReturnValue({
    getContentText: () => JSON.stringify(body),
  });
}

const baseReq: GeminiRequest = {
  apiKey: "key123",
  systemPrompt: "Be helpful",
  userTexts: ["Summarize this"],
};

// ── buildGeminiPayload tests ───────────────────────────────────

describe("buildGeminiPayload", () => {
  it("assembles a single text part", () => {
    const payload = buildGeminiPayload(baseReq);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toBe("Summarize this");
  });

  it("assembles multiple text parts in order", () => {
    const req: GeminiRequest = { ...baseReq, userTexts: ["Prompt", "Context"] };
    const payload = buildGeminiPayload(req);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toBe("Prompt");
    expect(parts[1].text).toBe("Context");
  });

  it("appends inline_data as the final part when provided", () => {
    const req: GeminiRequest = {
      ...baseReq,
      userTexts: ["What is this?"],
      inlineData: [{ mime_type: "application/pdf", data: "base64==" }],
    };
    const payload = buildGeminiPayload(req);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[1].inline_data).toEqual({ mime_type: "application/pdf", data: "base64==" });
  });

  it("appends multiple inline_data parts when inlineData has multiple items", () => {
    const req: GeminiRequest = {
      ...baseReq,
      userTexts: ["Describe both files"],
      inlineData: [
        { mime_type: "application/pdf", data: "file1==" },
        { mime_type: "image/jpeg", data: "file2==" },
      ],
    };
    const payload = buildGeminiPayload(req);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(3); // 1 text + 2 inline_data
    expect(parts[1].inline_data).toEqual({ mime_type: "application/pdf", data: "file1==" });
    expect(parts[2].inline_data).toEqual({ mime_type: "image/jpeg", data: "file2==" });
  });

  it("uses default system prompt when systemPrompt is omitted", () => {
    const req: GeminiRequest = { apiKey: "k", userTexts: ["hi"] };
    const payload = buildGeminiPayload(req);
    expect((payload.system_instruction as any).parts[0].text).toBe("You are a helpful assistant.");
  });

  describe("tool resolution in buildGeminiPayload", () => {
    it("omits tools key when tools array is absent", () => {
      const payload = buildGeminiPayload(baseReq);
      expect(payload.tools).toBeUndefined();
    });

    it("omits tools key when tools array is empty", () => {
      const payload = buildGeminiPayload({ ...baseReq, tools: [] });
      expect(payload.tools).toBeUndefined();
    });

    it("assembles a grounding tool entry for google_search", () => {
      const payload = buildGeminiPayload({ ...baseReq, tools: ["google_search"] });
      const tools = payload.tools as unknown[];
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({ google_search: {} });
    });
  });

  it("passes through generationConfig when provided", () => {
    const req: GeminiRequest = {
      ...baseReq,
      generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
    };
    const payload = buildGeminiPayload(req);
    expect((payload.generationConfig as any).temperature).toBe(0.5);
  });
});

// ── callGeminiAPI tests ────────────────────────────────────────

describe("callGeminiAPI", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the text from the first candidate", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "AI says hello" }] } }],
    });
    expect(callGeminiAPI(baseReq).text).toBe("AI says hello");
  });

  it("returns 'No response.' when candidates are empty", () => {
    mockFetchResponse({ candidates: [] });
    expect(callGeminiAPI(baseReq).text).toBe("No response.");
  });

  it("throws on API error response", () => {
    mockFetchResponse({ error: { message: "Invalid API key" } });
    expect(() => callGeminiAPI({ ...baseReq, apiKey: "bad" })).toThrow("Invalid API key");
  });

  it("uses modelName from request when provided", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    callGeminiAPI({ ...baseReq, modelName: "gemini-1.5-pro" });
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain("gemini-1.5-pro");
  });

  it("falls back to CONFIG.MODEL_NAME when modelName is omitted", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    callGeminiAPI(baseReq);
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain(CONFIG.MODEL_NAME);
  });

  it("assembles text from multiple text parts (code execution interleaving)", () => {
    mockFetchResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: "Let me check." },
              { executable_code: { language: "PYTHON", code: "1+1" } },
              { code_execution_result: { outcome: "OUTCOME_OK", output: "2\n" } },
              { text: "The answer is 2." },
            ],
          },
        },
      ],
    });
    expect(callGeminiAPI(baseReq).text).toBe("Let me check.\n\nThe answer is 2.");
  });

  it("populates codePairs when executable_code and code_execution_result parts are present", () => {
    mockFetchResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: "Sure." },
              { executable_code: { language: "PYTHON", code: "print(42)" } },
              { code_execution_result: { outcome: "OUTCOME_OK", output: "42\n" } },
            ],
          },
        },
      ],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.codePairs).toHaveLength(1);
    expect(resp.codePairs![0].code.code).toBe("print(42)");
    expect(resp.codePairs![0].result.output).toBe("42\n");
  });

  it("populates groundingMetadata for google_search results", () => {
    mockFetchResponse({
      candidates: [
        {
          content: { parts: [{ text: "Found it." }] },
          groundingMetadata: {
            webSearchQueries: ["test query"],
            groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
          },
        },
      ],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata?.webSearchQueries).toEqual(["test query"]);
    expect(resp.groundingMetadata?.groundingChunks![0].web?.uri).toBe("https://example.com");
  });

  it("populates groundingMetadata for url_context results", () => {
    mockFetchResponse({
      candidates: [
        {
          content: { parts: [{ text: "From the URL." }] },
          groundingMetadata: {
            groundingChunks: [
              { retrievedContext: { uri: "https://example.com", title: "Example" } },
            ],
          },
        },
      ],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata?.groundingChunks![0].retrievedContext?.uri).toBe(
      "https://example.com",
    );
  });

  it("returns undefined groundingMetadata and codePairs when not present", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "plain" }] } }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata).toBeUndefined();
    expect(resp.codePairs).toBeUndefined();
  });
});

// ── invokeGemini tests ─────────────────────────────────────────

describe("invokeGemini", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns a GeminiResponse with text from the first candidate", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "result" }] } }] });
    const result = invokeGemini({ userTexts: ["hello"] });
    expect(result.text).toBe("result");
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain("test-api-key");
  });

  it("throws when the API key property is not set", () => {
    (PropertiesService.getScriptProperties().getProperty as jest.Mock).mockReturnValueOnce(null);
    expect(() => invokeGemini({ userTexts: ["hello"] })).toThrow(/GEMINI_API_KEY/);
  });

  it("passes systemPrompt through to the payload", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    invokeGemini({ systemPrompt: "Be concise", userTexts: ["hello"] });
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("Be concise");
  });

  it("passes inlineData through to the payload", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    invokeGemini({
      userTexts: ["describe this"],
      inlineData: [{ mime_type: "application/pdf", data: "base64==" }],
    });
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
  });
});

// ── getCitations tests ─────────────────────────────────────────

describe("getCitations", () => {
  it("returns empty array when no groundingMetadata", () => {
    expect(getCitations({ text: "hello" })).toEqual([]);
  });

  it("returns empty array when groundingSupports is absent", () => {
    expect(
      getCitations({
        text: "hello",
        groundingMetadata: {
          groundingChunks: [{ web: { uri: "https://a.com", title: "A" } }],
        },
      }),
    ).toEqual([]);
  });

  it("maps a single support entry to a citation with resolved sources", () => {
    const response: GeminiResponse = {
      text: "The sky is blue.",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "Source A" } },
          { web: { uri: "https://b.com", title: "Source B" } },
        ],
        groundingSupports: [
          {
            segment: { startIndex: 4, endIndex: 10, text: "sky is" },
            groundingChunkIndices: [0, 1],
          },
        ],
      },
    };
    const citations = getCitations(response);
    expect(citations).toHaveLength(1);
    expect(citations[0].startIndex).toBe(4);
    expect(citations[0].endIndex).toBe(10);
    expect(citations[0].sources).toEqual([
      { uri: "https://a.com", title: "Source A" },
      { uri: "https://b.com", title: "Source B" },
    ]);
  });

  it("resolves retrievedContext chunks (url_context) the same way", () => {
    const response: GeminiResponse = {
      text: "Some claim.",
      groundingMetadata: {
        groundingChunks: [{ retrievedContext: { uri: "https://c.com", title: "Source C" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 4, text: "Some" },
            groundingChunkIndices: [0],
          },
        ],
      },
    };
    expect(getCitations(response)[0].sources[0]).toEqual({
      uri: "https://c.com",
      title: "Source C",
    });
  });

  it("skips chunk indices that point to chunks with neither web nor retrievedContext", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [{}],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 4, text: "text" },
            groundingChunkIndices: [0],
          },
        ],
      },
    };
    expect(getCitations(response)[0].sources).toEqual([]);
  });
});

describe("getUngroundedSpans", () => {
  it("returns empty array when no groundingMetadata", () => {
    expect(getUngroundedSpans({ text: "hello" })).toEqual([]);
  });

  it("returns empty array when groundingSupports is absent", () => {
    expect(
      getUngroundedSpans({
        text: "hello",
        groundingMetadata: { groundingChunks: [] },
      }),
    ).toEqual([]);
  });

  it("returns empty array when groundingSupports is empty array", () => {
    expect(
      getUngroundedSpans({
        text: "Nothing is grounded.",
        groundingMetadata: { groundingSupports: [] },
      }),
    ).toEqual([]);
  });

  it("finds a gap before the first support", () => {
    const spans = getUngroundedSpans({
      text: "Preamble. Cited claim.",
      groundingMetadata: {
        groundingSupports: [
          {
            segment: { startIndex: 10, endIndex: 22, text: "Cited claim." },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Preamble.");
    expect(spans[0].startIndex).toBe(0);
    expect(spans[0].endIndex).toBe(9);
  });

  it("finds a gap after the last support", () => {
    const spans = getUngroundedSpans({
      text: "Cited claim. Trailing remark.",
      groundingMetadata: {
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 12, text: "Cited claim." },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Trailing remark.");
    expect(spans[0].startIndex).toBe(13);
    expect(spans[0].endIndex).toBe(29);
  });

  it("finds a gap between two non-overlapping supports", () => {
    const spans = getUngroundedSpans({
      text: "First. Gap text. Second.",
      groundingMetadata: {
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 6, text: "First." },
            groundingChunkIndices: [0],
          },
          {
            segment: { startIndex: 17, endIndex: 24, text: "Second." },
            groundingChunkIndices: [1],
          },
        ],
      },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Gap text.");
  });

  it("merges overlapping supports before finding gaps", () => {
    const spans = getUngroundedSpans({
      text: "AAAABBBBCCCC",
      groundingMetadata: {
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 8, text: "AAAABBBB" },
            groundingChunkIndices: [0],
          },
          {
            segment: { startIndex: 4, endIndex: 12, text: "BBBBCCCC" },
            groundingChunkIndices: [1],
          },
        ],
      },
    });
    expect(spans).toEqual([]); // fully covered after merge
  });

  it("skips whitespace-only gaps", () => {
    const spans = getUngroundedSpans({
      text: "First.   Second.",
      groundingMetadata: {
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 6, text: "First." },
            groundingChunkIndices: [0],
          },
          {
            segment: { startIndex: 9, endIndex: 16, text: "Second." },
            groundingChunkIndices: [1],
          },
        ],
      },
    });
    expect(spans).toEqual([]); // gap is whitespace only
  });

  it("treats adjacent (touching) supports as a single covered region with no gap", () => {
    const spans = getUngroundedSpans({
      text: "FirstSecond",
      groundingMetadata: {
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 5, text: "First" }, groundingChunkIndices: [0] },
          { segment: { startIndex: 5, endIndex: 11, text: "Second" }, groundingChunkIndices: [1] },
        ],
      },
    });
    expect(spans).toEqual([]); // no gap between adjacent supports
  });

  it("handles supports provided in reverse order (validates sort)", () => {
    const spans = getUngroundedSpans({
      text: "First. Gap text. Second.",
      groundingMetadata: {
        groundingSupports: [
          // Intentionally reversed order
          {
            segment: { startIndex: 17, endIndex: 24, text: "Second." },
            groundingChunkIndices: [1],
          },
          { segment: { startIndex: 0, endIndex: 6, text: "First." }, groundingChunkIndices: [0] },
        ],
      },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Gap text.");
  });
});

describe("getAllSources", () => {
  it("returns empty array when no groundingMetadata", () => {
    expect(getAllSources({ text: "hello" })).toEqual([]);
  });

  it("returns empty array when groundingChunks is absent", () => {
    expect(getAllSources({ text: "hello", groundingMetadata: {} })).toEqual([]);
  });

  it("returns web sources", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "A" } },
          { web: { uri: "https://b.com", title: "B" } },
        ],
      },
    };
    expect(getAllSources(response)).toEqual([
      { uri: "https://a.com", title: "A" },
      { uri: "https://b.com", title: "B" },
    ]);
  });

  it("returns retrievedContext sources", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [{ retrievedContext: { uri: "https://c.com", title: "C" } }],
      },
    };
    expect(getAllSources(response)).toEqual([{ uri: "https://c.com", title: "C" }]);
  });

  it("skips chunks with neither web nor retrievedContext", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://a.com", title: "A" } }, {}],
      },
    };
    expect(getAllSources(response)).toEqual([{ uri: "https://a.com", title: "A" }]);
  });
});
