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

import { buildGeminiPayload, callGeminiAPI, invokeGemini } from "../src/server/api";
import { CONFIG } from "../src/server/config";
import type { GeminiRequest } from "../src/server/types";

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
      candidates: [{
        content: {
          parts: [
            { text: "Let me check." },
            { executable_code: { language: "PYTHON", code: "1+1" } },
            { code_execution_result: { outcome: "OUTCOME_OK", output: "2\n" } },
            { text: "The answer is 2." },
          ],
        },
      }],
    });
    expect(callGeminiAPI(baseReq).text).toBe("Let me check.\n\nThe answer is 2.");
  });

  it("populates codePairs when executable_code and code_execution_result parts are present", () => {
    mockFetchResponse({
      candidates: [{
        content: {
          parts: [
            { text: "Sure." },
            { executable_code: { language: "PYTHON", code: "print(42)" } },
            { code_execution_result: { outcome: "OUTCOME_OK", output: "42\n" } },
          ],
        },
      }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.codePairs).toHaveLength(1);
    expect(resp.codePairs![0].code.code).toBe("print(42)");
    expect(resp.codePairs![0].result.output).toBe("42\n");
  });

  it("populates groundingMetadata for google_search results", () => {
    mockFetchResponse({
      candidates: [{
        content: { parts: [{ text: "Found it." }] },
        groundingMetadata: {
          webSearchQueries: ["test query"],
          groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
        },
      }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata?.webSearchQueries).toEqual(["test query"]);
    expect(resp.groundingMetadata?.groundingChunks![0].web?.uri).toBe("https://example.com");
  });

  it("populates groundingMetadata for url_context results", () => {
    mockFetchResponse({
      candidates: [{
        content: { parts: [{ text: "From the URL." }] },
        groundingMetadata: {
          groundingChunks: [{ retrievedContext: { uri: "https://example.com", title: "Example" } }],
        },
      }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata?.groundingChunks![0].retrievedContext?.uri).toBe("https://example.com");
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

  it("calls callGeminiAPI with the resolved API key", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "result" }] } }] });
    const result = invokeGemini({ userTexts: ["hello"] });
    expect(result).toBe("result");
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
