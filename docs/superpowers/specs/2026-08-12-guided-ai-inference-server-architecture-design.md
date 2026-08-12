# Guided AI Inference — Server Architecture & RPC Boundary Design

**Session 2 of 3** in a planned arc: (1) [wireframe](2026-08-10-guided-ai-inference-wireframe-design.md), (2) server architecture & RPC boundary [this doc], (3) development steps. This doc covers server-side data structures and the client↔server RPC boundary only — client-side structure (new `PanelId`, whether to generalize `RecipePrepCook`'s state machine, panel/component design) is explicitly out of scope and reserved for a later session.

## Purpose

Session 1 committed to two backend behaviors without giving them an implementation home: unconditional XML-tag wrapping of every Step 1 input, and per-cell Drive-link auto-detection replacing the freeform panel's explicit Text/File kind declaration. This session designs those, plus how the three steps' data reassembles into a `RunConfig`, under one guiding constraint: **maximize reuse of existing server structures** rather than building a parallel RPC surface for the guided flow. A follow-up session may explore a from-scratch RPC design for comparison; this one does not.

## Core finding: the guided flow needs almost no new RPCs

Two existing server functions already do almost everything Steps 1–3 need:

- **`prepRecipe`** (`src/server/index.ts`) already generalizes to "write a column from a Drive folder" (`fillStrategy: {kind: "list-drive-folder"}`) and "write a static value to every row" (`fillStrategy: {kind: "fill-value"}`) — exactly Step 1's Drive-folder import and Step 2's system-prompt write.
- **`runBatchAI`** already implements Test (10-row cap) and Run AI (full range, chunked) against a `RunConfig` — exactly Step 3's terminal action. The 10-row cap and `CHUNK_SIZE` chunking logic already live client-side in `ConfigureAIRunPanel` and are directly reusable, not server concerns.

The only genuinely new RPC is a small helper Step 3 needs for its default row range, because nothing existing computes it (see below). Everything else is either a new call site against an existing RPC, or an internal change to how `runBatchAI`'s pipeline builds requests.

## Step-by-step RPC mapping

| Step | Server action | RPC |
|---|---|---|
| 1 — existing-column rows | none — client-only bookkeeping; the column reference flows straight into `RunConfig.promptCols` | *(no RPC)* |
| 1 — Drive-folder row(s) | one `PrepColSpec` per folder row, `fillStrategy: {kind: "list-drive-folder", inputId}` | `prepRecipe` (unchanged) |
| 2 — system prompt | one `PrepColSpec`, `fillStrategy: {kind: "fill-value", value: promptText}` | `prepRecipe` (unchanged) |
| 3 — default row range | `sheet.getLastRow()`-based, independent of anything Step 1 wrote | `getDefaultRowRange()` (new) |
| 3 — Test / Run AI | identical mechanics to `ConfigureAIRunPanel` today | `runBatchAI` (unchanged signature) |

Every `promptCols` entry the guided flow assembles — whether it references an existing column or the Drive-folder column Step 1 just created — gets `kind: "auto"`, uniformly. There is no kind distinction anywhere in the guided flow's `RunConfig`, matching the wireframe's "no kind concept" decision.

`prepRecipe`'s returned `rowRange` is intentionally **ignored** by the guided flow. That field reflects only what a specific `prepRecipe` call wrote (e.g. 1 row, if the user picked zero Drive folders and referenced only pre-existing columns) — it is not a substitute for "how many data rows does this sheet actually have." Step 1 may call `prepRecipe` zero times (no Drive-folder rows selected) or once (with one `PrepColSpec` per folder row); either way, Step 3 computes its own default independently.

### Why a new RPC for the default row range, not a repurposed one

Step 3's default is "row 2 through the sheet's highest populated row" — a full-sheet computation, unrelated to any particular prep action. Nothing today computes this:

- `prepRecipe`'s `rowRange` means "the range this specific prep call wrote," a meaning existing recipes depend on. Repurposing it to mean "the whole sheet" would break that contract for every existing recipe.
- `getActiveRangeInfo` means "the user's current UI selection," and returns `undefined` when there isn't one. Changing that fallback to "highest populated row" would silently change behavior for the freeform panel's `handleRun`/`handleTest`, which today treat `undefined` as "nothing to process."

So this is one new, small, single-purpose function alongside `getActiveRangeInfo`/`getJobProgress` in `index.ts`:

```ts
export function getDefaultRowRange(): { start: number; end: number } | null {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null; // header only, or empty sheet
  return { start: 2, end: lastRow };
}
```

## Shared type changes (`src/shared/types.ts`)

```ts
export interface PromptColumnSpec {
  col: string;
  kind: "text" | "file" | "auto"; // was "text" | "file"
}

export interface RunConfig {
  // ...unchanged fields...
  /**
   * When true (default), each prompt part is wrapped in an XML-style tag named
   * after its source column, e.g. <case_notes>...</case_notes>. Replaces the
   * former prefixWithColName boolean — colon-style "col: value" prefixing no
   * longer exists as an option. Undefined is treated as true.
   */
  wrapPromptsInTags?: boolean;
  // prefixWithColName removed entirely — no replacement default of false;
  // the new field's default is true.
}

export type RunStatsConfigSnapshot = Pick<
  RunConfig,
  "promptCols" | "systemPromptCol" | "tools" | "wrapPromptsInTags" | "model"
>;
```

`PromptInput` (`src/server/types.ts`) mirrors `PromptColumnSpec["kind"]` by direct type reference, so it picks up `"auto"` with no separate edit.

`src/shared/run-stats.ts`'s `buildConfigSnapshot` changes one line:

```ts
// was: prefixWithColName: config.prefixWithColName ?? false,
wrapPromptsInTags: config.wrapPromptsInTags ?? true,
```

This is a real default flip (off → on), not just a rename — reflecting the decision that XML-tag wrapping is now the standard behavior for both the freeform panel (checkbox defaults checked) and the guided flow (no toggle, always on).

## Server-logic changes

### `src/server/utils.ts` — new pure helper

```ts
/**
 * Deterministic column-title → XML-tag-name mapping. Column headers are not
 * valid tag names (spaces, #, /, leading digits, or empty titles are all
 * legal headers) — this is the single place that rule is applied.
 */
export function sanitizeTagName(title: string, fallbackIndex: number): string {
  const stripped = title.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (stripped === "") return `input_${fallbackIndex}`;
  return /^[0-9]/.test(stripped) ? `_${stripped}` : stripped;
}
```

Pure and synchronous — no `GoogleAppsScript` dependency — so it's directly unit-testable like `extractId`/`isValidDriveLink`.

### `src/server/inference.ts` — `buildUserParts`

Two changes, both additive to the existing text/file branching:

1. **New `"auto"` branch.** Flatten the cell value via the existing `flattenArg`; classify each resulting string with the existing `isValidDriveLink`. Matches resolve as file parts via the same `fileUriMap`/`prepareDriveAttachments` paths `"file"` already uses; non-matches become plain text parts. Order is preserved within the column's contribution.
2. **Tag wrapping.** When the caller indicates `wrapPromptsInTags` is on, each `PromptInput`'s contributed parts (whatever mix of text/file they resolve to) are wrapped as a unit: `{text: "<Tag>"}`, ...the input's parts..., `{text: "</Tag>"}`, where `Tag = sanitizeTagName(input.label, index)`. This repurposes `input.label` — previously only present to drive the removed colon-prefix behavior — as the tag-name source instead. `buildInferenceRequest` gains the `wrapPromptsInTags` parameter and threads it through.

### `src/server/index.ts` — `runBatchAI`

1. **Wave-1 file-ID scanning.** The loop that collects Drive file IDs to prefetch currently gates on `input.kind === "file"`. It needs to also fire for `input.kind === "auto"` — the existing `isValidDriveLink` filter inside that branch already discards non-links, so this is widening the gate, not adding new filtering logic.
2. **Per-row `PromptInput` assembly.** `label` is now set unconditionally to `pc.col` (previously conditional on the now-removed `prefixWithColName`), since it's needed for tag naming whenever `wrapPromptsInTags` is on. `config.wrapPromptsInTags` is read once and passed into `buildInferenceRequest`.
3. **New `getDefaultRowRange()` export**, as shown above.

## What this deliberately does not solve here

These are real consequences of the changes above, but they land in client code or a later session, not this one:

- **`ConfigureAIRunPanel`'s file-size warning** (`stats.config.promptCols.some((pc) => pc.kind === "file")` in `renderTestStats`) under-fires once `"auto"` exists — an auto-detected file column won't trip it. Whoever does the client-side work next needs to widen this check to `kind === "file" || kind === "auto"`.
- **Distinct Drive-folder column titles.** If a user adds more than one Drive-folder row in Step 1, the client must assign each a distinct `colTitle` (e.g. "Drive Link", "Drive Link 2") before calling `prepRecipe` — `prepRecipe` itself has no opinion on this, it just writes whatever distinct titles it's given.
- **Tag-name collisions.** Two differently-titled columns can sanitize to the same tag (e.g. "Note Col" and "note_col" both become `note_col`). `sanitizeTagName` does not deduplicate against sibling columns in the same request — accepted as a minor prompt-clarity edge case, not a correctness or security issue, consistent with this flow's general bias toward simplicity over guarding against unlikely inputs.
- **No progress reporting during `prepRecipe`'s Drive-folder scan.** `prepRecipe` takes no `jobId` and never calls `writeJobProgress`, unlike `importDriveLinks`/`extractText`. A large folder import in Step 1 will have no progress indicator — a pre-existing gap in `prepRecipe` (already true for today's document-summarization recipe), not a regression introduced here, and not addressed by this design.
