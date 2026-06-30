/// <reference types="node" />
import type { GeminiResponse } from "../src/server/types";
import { injectCitations, groundingToMarkdown } from "../src/server/gemini-grounding";

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

// ---- injectCitations ----

describe("injectCitations", () => {
  it("returns text unchanged when no grounding metadata", () => {
    expect(injectCitations(makeResponse({ text: "Hello." }))).toBe("Hello.");
  });

  it("returns text unchanged when groundingSupports is empty", () => {
    expect(
      injectCitations(
        makeResponse({
          text: "Hello.",
          groundingMetadata: { groundingSupports: [], groundingChunks: [] },
        }),
      ),
    ).toBe("Hello.");
  });

  it("injects citation as [text](url) link", () => {
    expect(injectCitations(makeGroundedResponse())).toBe(
      "[Paris is the capital of France.](https://example.com/paris)",
    );
  });

  it("skips citations that overlap existing [text](url) links", () => {
    const response = makeResponse({
      text: "[Paris](https://existing.com) is the capital.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com/paris", title: "Paris" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 7, text: "[Paris]" },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe("[Paris](https://existing.com) is the capital.");
  });

  it("truncates citation at a bullet line, preserving the bullet as plain text", () => {
    const response = makeResponse({
      text: "Key details:\n* Bullet one.\n* Bullet two.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 27, text: "Key details:\n* Bullet one." },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe(
      "[Key details:](https://example.com)\n* Bullet one.\n* Bullet two.",
    );
  });

  it("truncates citation at a trailing newline before a blank line", () => {
    const response = makeResponse({
      text: "Sentence one.\n\nSentence two.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 14, text: "Sentence one.\n" },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe("[Sentence one.](https://example.com)\n\nSentence two.");
  });

  it("merges overlapping citation ranges, keeping first source", () => {
    const response = makeResponse({
      text: "Hello world.",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "A" } },
          { web: { uri: "https://b.com", title: "B" } },
        ],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 5, text: "Hello" },
            groundingChunkIndices: [0],
          },
          {
            segment: { startIndex: 3, endIndex: 11, text: "lo world" },
            groundingChunkIndices: [1],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe("[Hello world](https://a.com).");
  });

  it("uses resolved URI from map in injected citation link", () => {
    const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
    const actualUri = "https://example.com/real-article";
    const response = makeGroundedResponse({
      groundingMetadata: {
        groundingChunks: [{ web: { uri: redirectUri, title: "Real Article" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 31, text: "Paris is the capital of France." },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    const resolvedUris = new Map([[redirectUri, actualUri]]);
    expect(injectCitations(response, resolvedUris)).toBe(
      "[Paris is the capital of France.](https://example.com/real-article)",
    );
  });

  it("falls back to redirect URI when map has no entry for it", () => {
    const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
    const response = makeGroundedResponse({
      groundingMetadata: {
        groundingChunks: [{ web: { uri: redirectUri, title: "Article" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 31, text: "Paris is the capital of France." },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    const resolvedUris = new Map<string, string>();
    expect(injectCitations(response, resolvedUris)).toBe(
      `[Paris is the capital of France.](${redirectUri})`,
    );
  });

  it("preserves heading prefix outside link and truncates before following paragraph", () => {
    const response = makeResponse({
      text: "### Trade Deadline Looming\nBecause the team is struggling heavily.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: {
              startIndex: 0,
              endIndex: 50,
              text: "### Trade Deadline Looming\nBecause the team is st",
            },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe(
      "### [Trade Deadline Looming](https://example.com)\nBecause the team is struggling heavily.",
    );
  });

  it("preserves bullet prefix outside link and truncates before following paragraph", () => {
    const response = makeResponse({
      text: "* Candidates are being evaluated.\nMore details follow.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: {
              startIndex: 0,
              endIndex: 48,
              text: "* Candidates are being evaluated.\nMore details f",
            },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe(
      "* [Candidates are being evaluated.](https://example.com)\nMore details follow.",
    );
  });

  it("snaps startIndex backward to word boundary when citation begins mid-word", () => {
    const response = makeResponse({
      text: "Injury: Marcus Semien is out.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: { startIndex: 10, endIndex: 29, text: "rcus Semien is out." },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe("Injury: [Marcus Semien is out.](https://example.com)");
  });

  it("snaps endIndex forward to word boundary when citation ends mid-word", () => {
    const response = makeResponse({
      text: "Starting pitcher Clay Holmes. While he pitched well.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 33, text: "Starting pitcher Clay Holmes. Whi" },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe(
      "[Starting pitcher Clay Holmes. While](https://example.com) he pitched well.",
    );
  });

  it("truncates citation at a standalone **bold-heading** line when startIndex is at the opening **", () => {
    // Gemini uses **Heading** (not ### Heading) for section titles. Citation spans the
    // heading and into the next paragraph — must truncate at the heading line.
    // "**Carlos Mendoza Fired**" = 24 chars (indices 0-23); \n at 24.
    const response = makeResponse({
      text: "**Carlos Mendoza Fired**\nHe was the Mets manager.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: {
              startIndex: 0,
              endIndex: 45,
              text: "**Carlos Mendoza Fired**\nHe was the Mets ma",
            },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe(
      "[**Carlos Mendoza Fired**](https://example.com)\nHe was the Mets manager.",
    );
  });

  it("snaps backward past ** when startIndex falls inside a bold-heading span", () => {
    // startIndex=2 lands on 'C' (inside **...**). Backward snap must cross ** delimiters
    // so the injected link is [**Carlos Mendoza Fired**](url), not **[Carlos...](url).
    // "**Carlos Mendoza Fired**" = 24 chars; **=0-1, C=2.
    const response = makeResponse({
      text: "**Carlos Mendoza Fired**\nHe was the Mets manager.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: {
              startIndex: 2,
              endIndex: 45,
              text: "Carlos Mendoza Fired**\nHe was the Mets ma",
            },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe(
      "[**Carlos Mendoza Fired**](https://example.com)\nHe was the Mets manager.",
    );
  });

  it("handles bold heading inside a numbered item (4. **Heading**)", () => {
    // startIndex=3 lands on the first * of **Trade Speculation**.
    // "4. **Trade Speculation**" = 24 chars; 4=0 .=1 ' '=2 *=3 *=4 T=5...n=21 *=22 *=23.
    const response = makeResponse({
      text: "4. **Trade Speculation**\nNext paragraph content.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
        groundingSupports: [
          {
            segment: {
              startIndex: 3,
              endIndex: 40,
              text: "**Trade Speculation**\nNext paragraph co",
            },
            groundingChunkIndices: [0],
          },
        ],
      },
    });
    expect(injectCitations(response)).toBe(
      "4. [**Trade Speculation**](https://example.com)\nNext paragraph content.",
    );
  });
});

// ---- groundingToMarkdown ----

describe("groundingToMarkdown", () => {
  it("returns null when no grounding metadata", () => {
    expect(groundingToMarkdown(makeResponse())).toBeNull();
  });

  it("returns null when all grounding arrays are empty", () => {
    expect(
      groundingToMarkdown(
        makeResponse({
          groundingMetadata: { groundingChunks: [], groundingSupports: [], webSearchQueries: [] },
        }),
      ),
    ).toBeNull();
  });

  it("returns search queries as linked text", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [],
        groundingSupports: [],
        webSearchQueries: ["capital of France"],
      },
    });
    const result = groundingToMarkdown(response)!;
    expect(result).toBe(
      `Search queries: ["capital of France"](https://www.google.com/search?q=capital%20of%20France)`,
    );
  });

  it("returns sources as markdown bullet list", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Example Site" } }],
        groundingSupports: [],
        webSearchQueries: [],
      },
    });
    expect(groundingToMarkdown(response)).toBe(
      "Sources (1):\n* [Example Site](https://example.com)",
    );
  });

  it("combines queries and sources separated by double newline", () => {
    const result = groundingToMarkdown(makeGroundedResponse())!;
    expect(result).toContain("Search queries:");
    expect(result).toContain("\n\nSources (1):");
    expect(result).toContain("* [Paris - Wikipedia](https://example.com/paris)");
  });

  it("returns code and output text for code pairs, ignoring other grounding", () => {
    const response = makeResponse({
      codePairs: [
        {
          code: { code: "print(1 + 1)", language: "PYTHON" },
          result: { outcome: "success", output: "2" },
        },
      ],
    });
    const result = groundingToMarkdown(response)!;
    expect(result).toBe("Code (python):\nprint(1 + 1)\n\nOutput:\n2");
  });

  it("joins multiple code pairs with double newline", () => {
    const response = makeResponse({
      codePairs: [
        {
          code: { code: "x = 1", language: "PYTHON" },
          result: { outcome: "success", output: "1" },
        },
        {
          code: { code: "y = 2", language: "PYTHON" },
          result: { outcome: "success", output: "2" },
        },
      ],
    });
    const result = groundingToMarkdown(response)!;
    expect(result).toContain("\n\n");
    expect(result).toContain("Code (python):\nx = 1");
    expect(result).toContain("Code (python):\ny = 2");
  });

  it("uses resolved URI from map in source list", () => {
    const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
    const actualUri = "https://example.com/real-article";
    const response = makeResponse({
      text: "Answer.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: redirectUri, title: "Real Article" } }],
        groundingSupports: [],
      },
    });
    const resolvedUris = new Map([[redirectUri, actualUri]]);
    const result = groundingToMarkdown(response, resolvedUris)!;
    expect(result).toContain(actualUri);
    expect(result).not.toContain(redirectUri);
  });
});
