/// <reference types="node" />
import type { GeminiResponse } from "../src/server/types";
import { buildInferenceCellContent, buildGroundingCellContent } from "../src/server/rich-text";

// ---- helpers ----

function makeResponse(overrides: Partial<GeminiResponse> = {}): GeminiResponse {
  return { text: "Hello world.", ...overrides };
}

function makeGroundedResponse(overrides: Partial<GeminiResponse> = {}): GeminiResponse {
  return {
    text: "Paris is the capital of France.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com/paris", title: "Paris - Wikipedia" } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 31, text: "Paris is the capital of France." },
          groundingChunkIndices: [0],
        },
      ],
      webSearchQueries: ["capital of France"],
    },
    ...overrides,
  };
}

// ============================================================
// buildInferenceCellContent
// ============================================================

describe("buildInferenceCellContent", () => {
  it("returns plain text with no ranges for a simple response", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "Hello world." }));
    expect(result.text).toBe("Hello world.");
    expect(result.ranges).toHaveLength(0);
  });

  it("strips **bold** markers and produces a bold range", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "The **sky** is blue." }));
    expect(result.text).toBe("The sky is blue.");
    const bold = result.ranges.find((r) => r.bold);
    expect(bold).toEqual({ startIndex: 4, endIndex: 7, bold: true });
  });

  it("strips *italic* markers and produces an italic range", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "A *quick* test." }));
    expect(result.text).toBe("A quick test.");
    const italic = result.ranges.find((r) => r.italic);
    expect(italic).toEqual({ startIndex: 2, endIndex: 7, italic: true });
  });

  it("strips ## heading prefix and produces a bold range", () => {
    const result = buildInferenceCellContent(
      makeResponse({ text: "## Section Title\nBody text." }),
    );
    expect(result.text).toBe("Section Title\nBody text.");
    expect(result.ranges[0]).toEqual({ startIndex: 0, endIndex: 13, bold: true });
  });

  it("adds url range for a citation, remapped through markdown position map", () => {
    // "The **sky** is blue." → cleanText "The sky is blue." (len 16)
    // groundingSupport: segment 0..15 (covers "The **sky** is" in original)
    // original idx 0 → clean 0, original idx 15 → clean 11
    const response = makeResponse({
      text: "The **sky** is blue.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 15, text: "The **sky** is" },
            groundingChunkIndices: [0],
          },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const link = result.ranges.find((r) => r.url);
    expect(link).toBeDefined();
    expect(link?.url).toBe("https://example.com");
    // remapped: 0→0, 15→11
    expect(link?.startIndex).toBe(0);
    expect(link?.endIndex).toBe(11);
  });

  it("merges overlapping citation ranges and keeps the first URI", () => {
    const response = makeResponse({
      text: "Hello world.",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "A" } },
          { web: { uri: "https://b.com", title: "B" } },
        ],
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 8, text: "Hello wo" }, groundingChunkIndices: [0] },
          { segment: { startIndex: 5, endIndex: 12, text: "world." }, groundingChunkIndices: [1] },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const links = result.ranges.filter((r) => r.url);
    expect(links).toHaveLength(1);
    expect(links[0].startIndex).toBe(0);
    expect(links[0].endIndex).toBe(12);
    expect(links[0].url).toBe("https://a.com");
  });

  it("skips citations with no sources", () => {
    const response = makeResponse({
      text: "Hello world.",
      groundingMetadata: {
        groundingChunks: [],
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 5, text: "Hello" }, groundingChunkIndices: [] },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    expect(result.ranges.filter((r) => r.url)).toHaveLength(0);
  });

  it("returns text with no ranges when groundingMetadata is absent", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "Plain text." }));
    expect(result.ranges.filter((r) => r.url)).toHaveLength(0);
  });
});

// ============================================================
// buildGroundingCellContent
// ============================================================

describe("buildGroundingCellContent", () => {
  it("returns null when response has no grounding data", () => {
    expect(buildGroundingCellContent(makeResponse())).toBeNull();
  });

  it("returns null when groundingMetadata has empty arrays", () => {
    const response = makeResponse({
      groundingMetadata: { groundingChunks: [], groundingSupports: [], webSearchQueries: [] },
    });
    expect(buildGroundingCellContent(response)).toBeNull();
  });

  it("includes search query text and a Google Search url range", () => {
    const response = makeGroundedResponse();
    const result = buildGroundingCellContent(response)!;
    expect(result.text).toContain('"capital of France"');
    const queryLink = result.ranges.find((r) => r.url?.startsWith("https://www.google.com/search"));
    expect(queryLink).toBeDefined();
    expect(queryLink?.url).toBe("https://www.google.com/search?q=capital%20of%20France");
    // The link should cover the quoted query text
    const quotedQuery = '"capital of France"';
    const idx = result.text.indexOf(quotedQuery);
    expect(queryLink?.startIndex).toBe(idx);
    expect(queryLink?.endIndex).toBe(idx + quotedQuery.length);
  });

  it("includes source title text and a url range pointing to the source URI", () => {
    const response = makeGroundedResponse();
    const result = buildGroundingCellContent(response)!;
    expect(result.text).toContain("Paris - Wikipedia");
    const sourceLink = result.ranges.find((r) => r.url?.startsWith("https://example.com/paris"));
    expect(sourceLink).toBeDefined();
    const titleText = "Paris - Wikipedia";
    const idx = result.text.indexOf(titleText);
    expect(sourceLink?.startIndex).toBe(idx);
    expect(sourceLink?.endIndex).toBe(idx + titleText.length);
  });

  it("does not include an Unverified section", () => {
    const response = makeGroundedResponse();
    const result = buildGroundingCellContent(response)!;
    expect(result.text).not.toContain("Unverified");
  });

  it("formats code execution as plain text without markdown fences", () => {
    const response = makeResponse({
      codePairs: [
        {
          code: { language: "PYTHON", code: "print(1+1)" },
          result: { outcome: "OUTCOME_OK", output: "2\n" },
        },
      ],
    });
    const result = buildGroundingCellContent(response)!;
    expect(result.text).toContain("Code (python):");
    expect(result.text).toContain("print(1+1)");
    expect(result.text).toContain("Output:");
    expect(result.text).toContain("2\n");
    expect(result.text).not.toContain("```");
    expect(result.ranges).toHaveLength(0);
  });

  it("handles multiple sources with individual url ranges", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "Site A" } },
          { web: { uri: "https://b.com", title: "Site B" } },
        ],
        groundingSupports: [],
        webSearchQueries: [],
      },
    });
    const result = buildGroundingCellContent(response)!;
    const links = result.ranges.filter((r) => r.url);
    expect(links).toHaveLength(2);
    expect(links.map((r) => r.url)).toEqual(
      expect.arrayContaining(["https://a.com", "https://b.com"]),
    );
  });

  it("handles multiple search queries with individual url ranges", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [],
        groundingSupports: [],
        webSearchQueries: ["query one", "query two"],
      },
    });
    const result = buildGroundingCellContent(response)!;
    const links = result.ranges.filter((r) => r.url?.includes("google.com"));
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe("https://www.google.com/search?q=query%20one");
    expect(links[1].url).toBe("https://www.google.com/search?q=query%20two");
  });

  it("returns only code section — no search/source sections — when codePairs present", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://x.com", title: "X" } }],
        groundingSupports: [],
        webSearchQueries: ["something"],
      },
      codePairs: [
        {
          code: { language: "PYTHON", code: "x=1" },
          result: { outcome: "OUTCOME_OK", output: "1" },
        },
      ],
    });
    const result = buildGroundingCellContent(response)!;
    expect(result.text).not.toContain("Search queries");
    expect(result.text).not.toContain("Sources");
    expect(result.text).toContain("Code");
  });
});

// ============================================================
// parseMarkdown edge cases (via buildInferenceCellContent)
// ============================================================

describe("buildInferenceCellContent markdown edge cases", () => {
  it("does not treat unmatched * as italic", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "Price: $5 * tax" }));
    expect(result.text).toBe("Price: $5 * tax");
    expect(result.ranges.filter((r) => r.italic)).toHaveLength(0);
  });

  it("handles # heading at the very start", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "# Title" }));
    expect(result.text).toBe("Title");
    expect(result.ranges[0]).toEqual({ startIndex: 0, endIndex: 5, bold: true });
  });

  it("handles multiple bold spans", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "**A** and **B**" }));
    expect(result.text).toBe("A and B");
    const bold = result.ranges.filter((r) => r.bold);
    expect(bold).toHaveLength(2);
    expect(bold[0]).toEqual({ startIndex: 0, endIndex: 1, bold: true });
    expect(bold[1]).toEqual({ startIndex: 6, endIndex: 7, bold: true });
  });
});
