# Citation Injection Fix Design

**Date:** 2026-06-29
**Status:** Approved

## Problem

`injectCitations` wraps Gemini grounding citation ranges as `[text](url)` inline links using raw character offsets. Because it operates on the raw markdown text, it can produce structurally invalid markdown in three ways:

**Bug 1 — Multi-line spanning.** `truncateToFirstBlock` only truncates when the *next* line starts a new block construct. It doesn't detect that the *current* line is already a heading or bullet, which should itself be a hard boundary. A citation starting on `### Trade Deadline Looming` runs unchecked into the following paragraph, producing `[### Trade Deadline Looming\nBecause the team...](url)` — a link that spans a block boundary.

**Bug 2 — Block-prefix wrapping.** When a citation's `startIndex` falls at the start of a heading or bullet line, the block prefix characters (`### `, `* `, `- `) get wrapped inside the link: `[### Managerial Search](url)`. That line now starts with `[`, not `#`, so `groupBlocks` can't detect it as a heading — the `###` appears as visible literal text in the cell.

**Bug 3 — Mid-word splits.** Gemini's character offsets are not word-aligned. A `startIndex` landing mid-word produces `Ma[rcus Semien...](url)` (broken link opening mid-word); an `endIndex` landing mid-word produces `...Whil](url)e he gave up` (broken link closing mid-word, stranding the remainder as plain text).

All three produce visible markdown syntax characters in the rendered cell.

## Approach

`parseMarkdown` stays completely untouched. The fix is to make `injectCitations` produce valid markdown in all cases — three targeted changes, all confined to `src/server/gemini-grounding.ts`.

## Fix 1 — `truncateToFirstBlock`: detect heading/bullet start

Add a check at the top of the function: if `lines[0]` itself matches a heading or bullet prefix, return only `lines[0]`. A citation that starts on a block-level line must not cross into the next line, regardless of what follows.

```
before: only checks lines[1..n] for block-opening markers
after:  also returns lines[0] immediately if it is a heading or bullet
```

This covers the `[Trade Deadline Looming\n...](url)` case: the heading line is returned immediately, truncating the span before the paragraph text.

## Fix 2 — `injectCitations`: block-prefix skip

After calling `truncateToFirstBlock`, detect if the span text begins with a block-level prefix (`#{1,6} `, `* `, `- `). If so, advance the injection start point past the prefix and preserve the prefix characters outside the link.

A citation on `### Managerial Search` produces:
```
### [Managerial Search](url)
```
instead of:
```
[### Managerial Search](url)
```

The parser's `groupBlocks` sees `### ` at the line start, detects the heading correctly, and processes `[Managerial Search](url)` as inline link content.

## Fix 3 — `injectCitations`: word-boundary snapping

After the prefix skip, add a `snapToWordBoundaries` helper that adjusts the content span:

- **Start:** scan backward from the content start (i.e. `startIndex + prefixLength`, after Fix 2 has removed any block prefix from consideration) while the preceding character is a word character (`\w`). This expands to include the full starting word — `rcus Semien...` becomes `Marcus Semien...`. The scan stops at non-`\w` characters (spaces, `*`, `#`) so it cannot reach backward past a block prefix.
- **End:** scan forward from `endIndex` while the current character is a word character. This expands to include the full ending word — `Whil` becomes `While`.

Snapping expands rather than contracts so that the linked text is always a grammatically complete token. The expansion is safe to apply after reverse-order processing because we're only extending into territory that wasn't covered by the citation, never into adjacent citations that were already processed.

## Composed injection loop

The three fixes apply in order within the existing reverse-iteration loop:

1. Get raw span: `truncateToFirstBlock(result.slice(startIndex, endIndex))` — **Fix 1** is now reliable
2. Detect and measure block prefix in raw span — **Fix 2**
3. Apply `snapToWordBoundaries` to the content portion (after prefix) — **Fix 3**
4. Reconstruct: `prefix + [snappedContent](url)` replaces only the content range in `result`

## Files changed

| File | Change |
|---|---|
| `src/server/gemini-grounding.ts` | Fix `truncateToFirstBlock`; add `snapToWordBoundaries` helper; update injection loop |
| `src/server/markdown-to-rich-text.ts` | None |
| `src/server/index.ts` | None |

## Tests

New test cases for `injectCitations` in `__tests__/gemini-grounding.test.ts`:

- Citation whose segment starts at a heading line — result is `### [content](url)`, not `[### content](url)`
- Citation whose segment starts at a bullet line — result is `* [content](url)`, not `[* content](url)`
- Citation spanning a heading and the following paragraph — truncated to the heading line only
- Citation whose `startIndex` is mid-word — result starts at the word boundary
- Citation whose `endIndex` is mid-word — result ends at the word boundary
- Citation whose segment starts mid-word AND at a block prefix (combined case)

New test case for `truncateToFirstBlock` (or moved to its own `describe` block):

- Input starts with a heading line followed by a paragraph — returns only the heading line
- Input starts with a bullet line followed by a paragraph — returns only the bullet line
- Existing behaviour unchanged: plain paragraph truncates at a blank line or heading that follows

## Out of scope

**Citations landing inside inline formatting delimiters.** A citation whose `startIndex` falls between `**` and the bold text (e.g. offset 2 of `**Kodai Senga:**`) would still produce `**[Kodai Senga:**...](url)` with visible `**`. This requires the open-delimiter character (`*`, `~`) to be included in the word-boundary scan, or a separate delimiter-alignment pass. Not yet observed in testing; deferred.

**Parse-first approach.** An alternative design would apply citation URLs after parsing, treating them as data rather than injecting them as markdown syntax. This eliminates the entire class of pre-parse injection bugs and maps cleanly to the Interactions API's `annotations[]` format (see issue #119). It is the right long-term architecture but requires threading a `segmentOffset` parameter through the recursive inline processor. Deferred in favour of the targeted fix; the Interactions API migration is the natural moment to revisit.

## Future: Interactions API migration

The Interactions API returns citations as `annotations[]` co-located with `content[].text` (see issue #119). The normalization point — converting API-specific citation format to `{startIndex, endIndex, url}[]` — is currently inside `injectCitations`. When migrating, that normalization becomes a new adapter (`extractCitations` or equivalent) that produces the same shape, and the rest of `injectCitations` (including these three fixes) remains unchanged.
