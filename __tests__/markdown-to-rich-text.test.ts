/// <reference types="node" />
import { parseMarkdown } from "../src/server/markdown-to-rich-text";

describe("parseMarkdown", () => {
  describe("plain text", () => {
    it("returns single span for plain text", () => {
      expect(parseMarkdown("Hello world")).toEqual([{ text: "Hello world" }]);
    });

    it("returns empty array for empty string", () => {
      expect(parseMarkdown("")).toEqual([]);
    });
  });

  describe("inline formatting", () => {
    it("parses bold", () => {
      expect(parseMarkdown("The **sky** is blue")).toEqual([
        { text: "The " },
        { text: "sky", bold: true },
        { text: " is blue" },
      ]);
    });

    it("parses italic", () => {
      expect(parseMarkdown("A *quick* test")).toEqual([
        { text: "A " },
        { text: "quick", italic: true },
        { text: " test" },
      ]);
    });

    it("parses strikethrough", () => {
      expect(parseMarkdown("~~strike~~ this")).toEqual([
        { text: "strike", strikethrough: true },
        { text: " this" },
      ]);
    });

    it("parses inline code without processing inner markdown", () => {
      expect(parseMarkdown("`**not bold**`")).toEqual([
        { text: "**not bold**", fontFamily: "Courier New" },
      ]);
    });

    it("parses links", () => {
      expect(parseMarkdown("[click here](https://example.com)")).toEqual([
        { text: "click here", url: "https://example.com" },
      ]);
    });

    it("leaves unmatched * as plain text", () => {
      expect(parseMarkdown("Price: $5 * tax")).toEqual([{ text: "Price: $5 * tax" }]);
    });
  });

  describe("nested inline formatting", () => {
    it("parses bold containing italic", () => {
      expect(parseMarkdown("**bold *italic* bold**")).toEqual([
        { text: "bold ", bold: true },
        { text: "italic", bold: true, italic: true },
        { text: " bold", bold: true },
      ]);
    });

    it("parses italic containing bold", () => {
      expect(parseMarkdown("*italic **bold** italic*")).toEqual([
        { text: "italic ", italic: true },
        { text: "bold", italic: true, bold: true },
        { text: " italic", italic: true },
      ]);
    });

    it("parses bold containing strikethrough", () => {
      expect(parseMarkdown("**~~struck~~ bold**")).toEqual([
        { text: "struck", bold: true, strikethrough: true },
        { text: " bold", bold: true },
      ]);
    });

    it("parses italic text inside a link", () => {
      expect(parseMarkdown("[*italic*](https://example.com)")).toEqual([
        { text: "italic", italic: true, url: "https://example.com" },
      ]);
    });
  });

  describe("headings", () => {
    it("parses h1 with bold and fontSize 13", () => {
      expect(parseMarkdown("# Title")).toEqual([{ text: "Title", bold: true, fontSize: 13 }]);
    });

    it("parses h2 with bold and fontSize 12", () => {
      expect(parseMarkdown("## Title")).toEqual([{ text: "Title", bold: true, fontSize: 12 }]);
    });

    it("parses h3 with bold and fontSize 11", () => {
      expect(parseMarkdown("### Title")).toEqual([{ text: "Title", bold: true, fontSize: 11 }]);
    });

    it("parses h4+ as bold with no fontSize", () => {
      expect(parseMarkdown("#### Title")).toEqual([{ text: "Title", bold: true }]);
    });

    it("stamps heading style over inline formatting", () => {
      expect(parseMarkdown("# Hello **world**")).toEqual([
        { text: "Hello ", bold: true, fontSize: 13 },
        { text: "world", bold: true, fontSize: 13 },
      ]);
    });
  });

  describe("bullets", () => {
    it("converts * bullet to bullet prefix", () => {
      expect(parseMarkdown("* item")).toEqual([{ text: "• " }, { text: "item" }]);
    });

    it("converts - bullet to bullet prefix", () => {
      expect(parseMarkdown("- item")).toEqual([{ text: "• " }, { text: "item" }]);
    });

    it("processes inline formatting within bullets", () => {
      expect(parseMarkdown("* **bold** item")).toEqual([
        { text: "• " },
        { text: "bold", bold: true },
        { text: " item" },
      ]);
    });
  });

  describe("multi-line", () => {
    it("consolidates consecutive paragraph lines into a single span", () => {
      expect(parseMarkdown("line1\nline2")).toEqual([{ text: "line1\nline2" }]);
    });

    it("preserves blank lines as double newline separators", () => {
      expect(parseMarkdown("para1\n\npara2")).toEqual([
        { text: "para1" },
        { text: "\n" },
        { text: "\n" },
        { text: "para2" },
      ]);
    });

    it("handles mixed content across lines", () => {
      expect(parseMarkdown("# Heading\n* item\nplain")).toEqual([
        { text: "Heading", bold: true, fontSize: 13 },
        { text: "\n" },
        { text: "• " },
        { text: "item" },
        { text: "\n" },
        { text: "plain" },
      ]);
    });

    it("parses a link whose text spans a line break", () => {
      expect(parseMarkdown("before [link\ntext](https://example.com) after")).toEqual([
        { text: "before " },
        { text: "link\ntext", url: "https://example.com" },
        { text: " after" },
      ]);
    });
  });
});
