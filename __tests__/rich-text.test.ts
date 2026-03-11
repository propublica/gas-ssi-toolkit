/// <reference types="node" />
import type { GeminiGroundingSupport, GeminiResponse } from "../src/server/types";
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

    const linkA = links.find((r) => r.url === "https://a.com");
    const linkB = links.find((r) => r.url === "https://b.com");
    expect(linkA).toBeDefined();
    expect(linkB).toBeDefined();

    const idxA = result.text.indexOf("Site A");
    const idxB = result.text.indexOf("Site B");
    expect(linkA?.startIndex).toBe(idxA);
    expect(linkA?.endIndex).toBe(idxA + "Site A".length);
    expect(linkB?.startIndex).toBe(idxB);
    expect(linkB?.endIndex).toBe(idxB + "Site B".length);
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

  it("handles retrievedContext chunks (no web property)", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [
          { retrievedContext: { uri: "https://docs.example.com/page", title: "Docs Page" } },
        ],
        groundingSupports: [],
        webSearchQueries: [],
      },
    });
    const result = buildGroundingCellContent(response)!;
    expect(result.text).toContain("Docs Page");
    const link = result.ranges.find((r) => r.url === "https://docs.example.com/page");
    expect(link).toBeDefined();
    const idx = result.text.indexOf("Docs Page");
    expect(link?.startIndex).toBe(idx);
    expect(link?.endIndex).toBe(idx + "Docs Page".length);
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

  it("strips '* ' bullet prefix and replaces with bullet character", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "* item one\n* item two" }));
    expect(result.text).toBe("• item one\n• item two");
    expect(result.ranges.filter((r) => r.italic)).toHaveLength(0);
  });

  it("strips '- ' bullet prefix and replaces with bullet character", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "- item one" }));
    expect(result.text).toBe("• item one");
    expect(result.ranges.filter((r) => r.italic)).toHaveLength(0);
  });

  it("handles bullet with bold label: '* **Key:** description'", () => {
    const result = buildInferenceCellContent(
      makeResponse({ text: "* **Standardization:** A universal format." }),
    );
    expect(result.text).toBe("• Standardization: A universal format.");
    const bold = result.ranges.find((r) => r.bold);
    expect(bold).toBeDefined();
    expect(result.text.slice(bold!.startIndex, bold!.endIndex)).toBe("Standardization:");
  });

  it("parses [text](url) inline link — strips syntax, keeps text, adds url range", () => {
    const result = buildInferenceCellContent(
      makeResponse({ text: "See [the docs](https://example.com/docs) for more." }),
    );
    expect(result.text).toBe("See the docs for more.");
    const link = result.ranges.find((r) => r.url === "https://example.com/docs");
    expect(link).toBeDefined();
    const idx = result.text.indexOf("the docs");
    expect(link!.startIndex).toBe(idx);
    expect(link!.endIndex).toBe(idx + "the docs".length);
  });

  it("parses multiple [text](url) links in a line", () => {
    const result = buildInferenceCellContent(
      makeResponse({ text: "[A](https://a.com) and [B](https://b.com)" }),
    );
    expect(result.text).toBe("A and B");
    const links = result.ranges.filter((r) => r.url);
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe("https://a.com");
    expect(links[1].url).toBe("https://b.com");
  });

  it("skips citation injection when the span overlaps an existing [text](url) link", () => {
    // The entire model-generated link "[the docs](...)" spans chars 0-36.
    // The grounding citation also targets chars 0-36 — direct overlap.
    // Option A: skip the citation rather than produce nested/malformed markup.
    const response = makeResponse({
      text: "[the docs](https://example.com/docs) is good",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://citation.com", title: "Citation" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 36, text: "[the docs](https://example.com/docs)" },
            groundingChunkIndices: [0],
          },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    // The inline link is preserved.
    const inlineLink = result.ranges.find((r) => r.url === "https://example.com/docs");
    expect(inlineLink).toBeDefined();
    // The citation is skipped — only one URL range present.
    const citation = result.ranges.find((r) => r.url === "https://citation.com");
    expect(citation).toBeUndefined();
    expect(result.ranges.filter((r) => r.url)).toHaveLength(1);
  });
});

describe("buildInferenceCellContent grounding — missing startIndex", () => {
  it("treats absent startIndex as 0 (proto3 default omission)", () => {
    const response = makeResponse({
      text: "Paris is the capital.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
        groundingSupports: [
          // startIndex intentionally omitted — simulates Gemini proto3 behaviour
          {
            segment: { endIndex: 5, text: "Paris" },
            groundingChunkIndices: [0],
          } as unknown as GeminiGroundingSupport,
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const citation = result.ranges.find((r) => r.url === "https://example.com");
    expect(citation).toBeDefined();
    expect(citation!.startIndex).toBe(0);
    expect(citation!.endIndex).toBe(5);
  });
});

// ============================================================
// Citation injection (pre-processing step)
// ============================================================

describe("buildInferenceCellContent — citation injection", () => {
  it("injects a citation as a url range when there is no existing link overlap", () => {
    // Citation covers "Paris" (0..5). No existing [text](url) in raw text.
    // Injection: "[Paris](url) is the capital."
    // After parsing: text="Paris is the capital.", ranges=[{0,5,url}]
    const response = makeResponse({
      text: "Paris is the capital.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Paris" } }],
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 5, text: "Paris" }, groundingChunkIndices: [0] },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const link = result.ranges.find((r) => r.url === "https://example.com");
    expect(link).toBeDefined();
    expect(link!.startIndex).toBe(0);
    expect(link!.endIndex).toBe(5);
  });

  it("citation spanning bold markdown maps to the correct clean-text range", () => {
    // Text: "The **sky** is blue." — citation at 0..15 covers "The **sky** is "
    // Injection: "[The **sky** is ](url) blue."
    // After parsing: text="The sky is blue.", citation range 0..11, bold range 4..7
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
    expect(result.text).toBe("The sky is blue.");
    const link = result.ranges.find((r) => r.url === "https://example.com");
    expect(link).toBeDefined();
    expect(link!.startIndex).toBe(0);
    expect(link!.endIndex).toBe(11); // "The sky is " = 11 chars
    const bold = result.ranges.find((r) => r.bold);
    expect(bold).toEqual({ startIndex: 4, endIndex: 7, bold: true });
  });

  it("merges overlapping citations before injection", () => {
    // Two overlapping citations (0..8) and (5..12) merge into (0..12).
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
    expect(links[0].url).toBe("https://a.com"); // first URI wins
  });

  it("handles non-overlapping citation adjacent to an existing link", () => {
    // Existing link: chars 0..36 "[the docs](https://example.com/docs)"
    // Citation: chars 37..44 " is good" — does NOT overlap the existing link
    const response = makeResponse({
      text: "[the docs](https://example.com/docs) is good",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://citation.com", title: "Citation" } }],
        groundingSupports: [
          {
            segment: { startIndex: 37, endIndex: 44, text: "is good" },
            groundingChunkIndices: [0],
          },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    // Both the inline link and the adjacent citation should be present.
    const inlineLink = result.ranges.find((r) => r.url === "https://example.com/docs");
    const citation = result.ranges.find((r) => r.url === "https://citation.com");
    expect(inlineLink).toBeDefined();
    expect(citation).toBeDefined();
  });
});
