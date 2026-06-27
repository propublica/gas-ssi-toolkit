export interface RichSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  fontFamily?: string;
  fontSize?: number;
  url?: string;
}

// Known limitation: patterns where an outer italic closes on the same * as an inner
// bold marker (e.g. *italic **bold***) are not parsed correctly. Fixing this requires
// a CommonMark-style two-pass delimiter-run algorithm. Uncommon in AI-generated output.
function processMarkdownInline(segment: string): RichSpan[] {
  const spans: RichSpan[] = [];
  let i = 0;
  let plainStart = 0;

  function flushPlain(end: number): void {
    if (end > plainStart) {
      spans.push({ text: segment.slice(plainStart, end) });
    }
  }

  while (i < segment.length) {
    // [text](url) — inline link; recurse on link text, stamp url
    if (segment[i] === "[") {
      const closeBracket = segment.indexOf("]", i + 1);
      if (closeBracket > i && segment[closeBracket + 1] === "(") {
        // Walk forward counting paren depth so URLs containing ( ) are handled correctly.
        let depth = 1;
        let cp = closeBracket + 2; // first char inside the (
        while (cp < segment.length && depth > 0) {
          if (segment[cp] === "(") depth++;
          else if (segment[cp] === ")") depth--;
          if (depth > 0) cp++;
        }
        const closeParen = depth === 0 ? cp : -1;
        if (closeParen > closeBracket + 1) {
          flushPlain(i);
          const linkText = segment.slice(i + 1, closeBracket);
          const url = segment.slice(closeBracket + 2, closeParen);
          const inner = processMarkdownInline(linkText);
          spans.push(...inner.map((s) => ({ ...s, url })));
          i = closeParen + 1;
          plainStart = i;
          continue;
        }
      }
    }

    // **bold** — check before single * to avoid misparse; recurse + stamp
    if (segment[i] === "*" && segment[i + 1] === "*") {
      const closeIdx = segment.indexOf("**", i + 2);
      if (closeIdx > i + 2) {
        flushPlain(i);
        const inner = processMarkdownInline(segment.slice(i + 2, closeIdx));
        spans.push(...inner.map((s) => ({ ...s, bold: true })));
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // *italic* — single * with matching close; recurse + stamp
    if (segment[i] === "*" && segment[i + 1] !== "*") {
      let closeIdx = i + 1;
      let found = false;
      while (closeIdx < segment.length) {
        closeIdx = segment.indexOf("*", closeIdx);
        if (closeIdx === -1) break;
        // Check if this is a single * (not preceded or followed by another *)
        if (segment[closeIdx - 1] !== "*" && segment[closeIdx + 1] !== "*") {
          flushPlain(i);
          const inner = processMarkdownInline(segment.slice(i + 1, closeIdx));
          spans.push(...inner.map((s) => ({ ...s, italic: true })));
          i = closeIdx + 1;
          plainStart = i;
          found = true;
          break;
        }
        closeIdx++;
      }
      if (found) continue;
    }

    // ~~strikethrough~~ — recurse + stamp
    if (segment[i] === "~" && segment[i + 1] === "~") {
      const closeIdx = segment.indexOf("~~", i + 2);
      if (closeIdx > i + 2) {
        flushPlain(i);
        const inner = processMarkdownInline(segment.slice(i + 2, closeIdx));
        spans.push(...inner.map((s) => ({ ...s, strikethrough: true })));
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // `inline code` — no recursion; content is literal
    if (segment[i] === "`") {
      const closeIdx = segment.indexOf("`", i + 1);
      if (closeIdx > i + 1) {
        flushPlain(i);
        spans.push({ text: segment.slice(i + 1, closeIdx), fontFamily: "Courier New" });
        i = closeIdx + 1;
        plainStart = i;
        continue;
      }
    }

    i++;
  }

  flushPlain(i);
  return spans;
}

type Block =
  | { kind: "heading"; depth: number; content: string }
  | { kind: "bullet"; content: string }
  | { kind: "blank" }
  | { kind: "paragraph"; lines: string[] };

function groupBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const paragraphLines: string[] = [];

  function flushParagraph(): void {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", lines: [...paragraphLines] });
      paragraphLines.length = 0;
    }
  }

  for (const line of text.split("\n")) {
    const headingMatch = line.match(/^(#{1,6}) /);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        depth: headingMatch[1].length,
        content: line.slice(headingMatch[1].length + 1),
      });
    } else if (/^\* /.test(line) || /^- /.test(line)) {
      flushParagraph();
      blocks.push({ kind: "bullet", content: line.slice(2) });
    } else if (line === "") {
      flushParagraph();
      blocks.push({ kind: "blank" });
    } else {
      paragraphLines.push(line);
    }
  }
  flushParagraph();
  return blocks;
}

export function parseMarkdown(text: string): RichSpan[] {
  const spans: RichSpan[] = [];
  const blocks = groupBlocks(text);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.kind === "heading") {
      const fontSize =
        block.depth === 1 ? 13 : block.depth === 2 ? 12 : block.depth === 3 ? 11 : undefined;
      spans.push(
        ...processMarkdownInline(block.content).map((s) => {
          const span: RichSpan = { ...s, bold: true };
          if (fontSize !== undefined) span.fontSize = fontSize;
          return span;
        }),
      );
    } else if (block.kind === "bullet") {
      spans.push({ text: "• " });
      spans.push(...processMarkdownInline(block.content));
    } else if (block.kind === "paragraph") {
      spans.push(...processMarkdownInline(block.lines.join("\n")));
    }
    // blank blocks contribute no spans; the \n separators between blocks carry the whitespace

    if (i < blocks.length - 1) {
      spans.push({ text: "\n" });
    }
  }

  return spans;
}
