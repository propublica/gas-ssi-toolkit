/**
 * Tests for src/server/gemini-auth.ts
 *
 * GAS globals mocked: PropertiesService. No UrlFetchApp — this module makes no
 * network calls.
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockGetProperty = jest.fn();

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({ getProperty: mockGetProperty }),
};

// ── Import after mocks ─────────────────────────────────────────

import {
  API_KEY_PROPERTY,
  MISSING_API_KEY_MESSAGE,
  geminiAuthHeaders,
  hasGeminiApiKey,
} from "../src/server/gemini-auth";

// ── Tests ──────────────────────────────────────────────────────

describe("constants", () => {
  it("names the GEMINI_API_KEY script property", () => {
    expect(API_KEY_PROPERTY).toBe("GEMINI_API_KEY");
  });

  // Pinned wording: customFunctions.test.ts asserts /\[SSI Error:.*GEMINI_API_KEY/
  // against the message this constant produces.
  it("uses the established missing-key wording", () => {
    expect(MISSING_API_KEY_MESSAGE).toBe("GEMINI_API_KEY script property not set");
  });
});

describe("geminiAuthHeaders", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the key in an x-goog-api-key header", () => {
    mockGetProperty.mockReturnValue("secret-key");
    expect(geminiAuthHeaders()).toEqual({ "x-goog-api-key": "secret-key" });
  });

  it("reads the key from the GEMINI_API_KEY script property", () => {
    mockGetProperty.mockReturnValue("secret-key");
    geminiAuthHeaders();
    expect(mockGetProperty).toHaveBeenCalledWith("GEMINI_API_KEY");
  });

  it("throws MISSING_API_KEY_MESSAGE when the property is unset", () => {
    mockGetProperty.mockReturnValue(null);
    expect(() => geminiAuthHeaders()).toThrow(MISSING_API_KEY_MESSAGE);
  });

  it("throws when the property is an empty string", () => {
    mockGetProperty.mockReturnValue("");
    expect(() => geminiAuthHeaders()).toThrow(MISSING_API_KEY_MESSAGE);
  });
});

describe("hasGeminiApiKey", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when the key is set", () => {
    mockGetProperty.mockReturnValue("secret-key");
    expect(hasGeminiApiKey()).toBe(true);
  });

  it("returns false when the key is unset", () => {
    mockGetProperty.mockReturnValue(null);
    expect(hasGeminiApiKey()).toBe(false);
  });

  it("returns false for an empty string", () => {
    mockGetProperty.mockReturnValue("");
    expect(hasGeminiApiKey()).toBe(false);
  });

  it("does not throw when the key is unset", () => {
    mockGetProperty.mockReturnValue(null);
    expect(() => hasGeminiApiKey()).not.toThrow();
  });
});
