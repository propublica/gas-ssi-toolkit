/**
 * Tests for src/server/api.ts
 *
 * Only UrlFetchApp needs mocking — DriveApp and Utilities are no longer
 * used in this module.
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
};

// ── Import after mocks ─────────────────────────────────────────

import { buildGeminiPayload, callGeminiAPI } from "../src/server/api";
import type { GeminiRequest } from "../src/shared/types";

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
      inlineData: { mime_type: "application/pdf", data: "base64==" },
    };
    const payload = buildGeminiPayload(req);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[1].inline_data).toEqual({ mime_type: "application/pdf", data: "base64==" });
  });

  it("uses default system prompt when systemPrompt is omitted", () => {
    const req: GeminiRequest = { apiKey: "k", userTexts: ["hi"] };
    const payload = buildGeminiPayload(req);
    expect((payload.system_instruction as any).parts[0].text).toBe("You are a helpful assistant.");
  });

  it("includes tools when provided", () => {
    const req: GeminiRequest = {
      ...baseReq,
      tools: [{ name: "myFn", description: "does stuff" }],
    };
    const payload = buildGeminiPayload(req);
    expect((payload.tools as any)[0].function_declarations[0].name).toBe("myFn");
  });

  it("omits tools key when tools array is empty or absent", () => {
    const payload = buildGeminiPayload(baseReq);
    expect(payload.tools).toBeUndefined();
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
    expect(callGeminiAPI(baseReq)).toBe("AI says hello");
  });

  it("returns 'No response.' when candidates are empty", () => {
    mockFetchResponse({ candidates: [] });
    expect(callGeminiAPI(baseReq)).toBe("No response.");
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
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain("gemini-2.0-flash");
  });
});
