# User Guide Redesign — Design

## Problem

`docs/user-guide.md` reads as a transcription of the sidebar. Every tool section is a
numbered walkthrough that traces its panel top-to-bottom in field order, so a reporter
with the sidebar open reads the same labels twice. In several places the doc restates
helper text that the panel already renders verbatim — the Extract Text section documents
"Truncated at 49,000 characters" and "PDFs and images are OCR'd," both of which appear as
`field-helper` copy in `src/client/panels/extract-text.ts:147,152`.

The genuinely useful content is present but buried in the "Good to know" bullets, and the
guide omits most of the toolkit's actually surprising behaviors — including one that can
destroy data and one that is documented incorrectly.

## Goal

Rewrite the guide so it contains only what the sidebar cannot tell you: when to reach for
a tool, what the one ambiguous control in each panel means, and which behaviors will
surprise a reporter. The UI carries field-level instruction; the doc carries judgment and
sharp edges.

## Audience and reading context

Alpha-testing reporters, reading **with the sidebar already open, mid-task**. They land in
a section directly rather than reading front to back. This dictates short, scannable,
panel-keyed sections and rules out extended narrative or a conceptual preamble.

## Format

Sections 1–3 of the current doc (title/intro, "Installing the add-on", "Getting oriented")
are kept as-is. Every tool section is rebuilt on this skeleton:

```
## <Emoji> <Panel name>          [image: sidebar button crop]

<Short description: what the tool does, and what happens the moment you click.>

### When to reach for this

### The three components of AI inference     ← Run AI Inference only

### Tips, tricks & pitfalls
```

Three rules govern the rewrite:

1. **No numbered step lists for panel-driven tools.** Import Drive Links, Extract Text,
   and Run AI Inference all render labeled fields with helper text. Steps that recite
   those fields are deleted outright.
2. **The description absorbs the "what happens when I click" job.** This is the only place
   the doc needs to cover flow. For Sample Rows it states plainly that two modal dialogs
   fire in sequence and a new sheet appears; for Format Markdown, that it acts immediately
   on the highlighted cells with no panel and no confirmation. After that, the UI takes
   over.
3. **Nothing in the middle slot for the four Extras.** Only Run AI Inference has enough
   internal structure to warrant it.

## Content plan

### Run AI Inference

**Description.** Sends a Gemini prompt for each row and writes the answer into an output
column. Clicking it opens a configuration panel; nothing runs until you press Test or
Run AI.

**When to reach for this.** The task is the same question asked once per row — summarize,
classify, extract a field, translate, compare against a rule. Not the right tool for a
question about the dataset as a whole, since each row is a separate, independent request
with no knowledge of the others.

**The three components.**

1. **Set your columns.** Frame these as *roles*, not fields — the panel's helper text
   already defines each one (`configure-ai-run.ts:564,569,578`), so the doc's job is only
   what the helper text omits:
   - **Text vs. file** is the one control in the panel with no explanatory copy anywhere.
     It renders as a bare toggle button labeled `Text ⇄` / `File ⇄`
     (`prompt-col-list.ts:72,97`). Text mode sends the cell's characters; if the cell holds
     a Drive URL, the AI receives the URL string and cannot open it. File mode treats the
     cell as a Drive link, fetches the document, and sends its contents.
   - **Prompt column order matters** — the `↑`/`↓` buttons reorder how the AI receives the
     columns, and nothing in the UI says so.
   - **Apply markdown formatting** converts the response to real rich text (bold,
     headings, links) instead of leaving `**asterisks**` in the cell.

2. **AI configuration.** Frame model and tools as *what does this task need*, not as an
   options list. The model descriptions in `MODEL_CATALOG` (`client/models.ts:25`) already
   render in the panel, so the doc should not restate them. What the panel does not say:
   - Google Search is billed per search query at $14 per 1,000 (`pricing.ts:35`) — about
     1.4 cents each, and a single row can issue more than one. On Flash Lite that dwarfs
     token cost, so turning Search on for a 5,000-row run is a materially different
     decision than for 50 rows.
   - Choose URL Context when your own cells contain links you want read; choose Search
     when the answer isn't in your data at all.
   - The grounding column name is derived, not chosen: `<output column>_grounding`
     (`index.ts:362`).

3. **Run.** Why the Test button exists and when to use it:
   - It runs the **first 10 rows** of your range and reports the real cost and elapsed
     time for those rows, plus a projection for the full run
     (`configure-ai-run.ts:423,460-467`). It is the first 10, not a random 10.
   - **Test is not a dry run.** It performs real inference and writes real results into
     the output column for those rows. Nothing is discarded afterward.
   - Change any setting after testing and the results are marked stale —
     "Configuration changed since last test" (`configure-ai-run.ts:502`).
   - Use it whenever the prompt is new, the model changed, or a tool was added. Skip it
     only when re-running a configuration you've already validated.

**Tips, tricks & pitfalls.** Sourced below.

### Import Drive Links

**Description.** Walks a Drive folder and every subfolder beneath it, writing one file
link per row into a column.

**When to reach for this.** You have a folder of documents and need them as sheet rows
before you can extract text or run AI over them. It's the usual first step of a
document-dump workflow.

### Extract Text

**Description.** Reads the Drive link in each row and writes that document's text into
another column. Handles Google Docs natively; PDFs and images go through OCR.

**When to reach for this.** You want the words themselves in the sheet — searchable with
Ctrl+F, filterable, and usable as a text prompt column. Typically runs right after Import
Drive Links. Not needed if you plan to use file mode in Run AI Inference, which sends the
document to the model directly.

### Sample Rows

**Description.** Asks how many rows you want, then asks for a seed, then copies your
header row plus that many randomly chosen rows into a new sheet named
`<sheet name>_evaluation` and switches you to it. No panel — two dialogs, then you're on a
new sheet.

**When to reach for this.** Spot-checking. Pull a manageable subset, run a prompt against
it, and read the results by hand before committing to the full dataset. The seed makes
the sample reproducible, so you can compare two prompt versions against identical rows.

### Format Markdown

**Description.** Rewrites your currently highlighted cells in place, converting markdown
syntax into real formatting. No panel, no column pickers, no confirmation — it acts the
moment you click.

**When to reach for this.** An AI run produced `**asterisks**` and `## hashes` as literal
text because "Apply markdown formatting" was off. Keep the before/after images here.

## Pitfalls inventory

Every item below was verified against source. Items marked **(new)** are absent from the
current guide.

### Run AI Inference

| Behavior | Source |
|---|---|
| **(new)** The output column header turns orange and gets a note reading "Some cells in this column may be AI-generated"; the output cells turn pale yellow. Expected, not a bug. | `utils.ts:159-171` |
| **(new)** A response beginning with `=`, `+`, or `-` is written with a leading apostrophe so Sheets shows it as text. A response containing `IMAGE(`, `IMPORTDATA(`, `IMPORTXML(`, `IMPORTHTML(`, `IMPORTRANGE(`, or `IMPORTFEED(` is discarded and replaced with `[SSI Error: ...]`. Asking the AI to write spreadsheet formulas will not work. | `safe-writes.ts:13,29-35` |
| **(new)** A new output column is appended at the far right of the sheet, past every existing column — not next to your data. | `safe-writes.ts:106` |
| **(new)** Runs execute in 40-row chunks. Cancelling (the ✕ on the job strip) stops after the current chunk finishes, so up to 39 more rows may still be processed. | `configure-ai-run.ts:16`, `job-store.ts:83` |
| **(new)** A row whose Drive file fails to download gets `[File error: ...]` written into its output cell and is skipped — no inference is attempted, and the cell is not left blank. | `index.ts:503` |
| **(new)** In file mode, Google Docs are converted to PDF and Google Sheets to CSV before being sent to the model. | `index.ts:463-464` |
| **(new)** The cost figure assumes you pay for every Search query. Google's free grounding quota (5,000/month, account-wide) is invisible to the add-on, so a displayed cost can overstate what you're actually billed. | `pricing.ts:31-35` |
| **(new)** Choosing "Specify range" but leaving either row box empty silently falls back to your highlighted selection. | `row-range.ts:88-90` |
| **(new)** Entering a start row greater than the end row produces the misleading alert "Row 1 is the header row and can't be processed." | `row-range.ts:7-9` |
| **(new)** A prompt column row with no column selected is silently ignored. | `prompt-col-list.ts:41` |
| The confirmation dialog appears above 200 rows and warns that closing the sidebar stops the run. | `configure-ai-run.ts:19,351` |
| Row 1 is the header row and is never processed. | `row-range.ts:7` |
| If a column was renamed or deleted, use the ↻ button to reload the column list. | `configure-ai-run.ts:304` |

### Import Drive Links

| Behavior | Source |
|---|---|
| **(new) CORRECTION.** The current guide says links are appended "starting from the sheet's next empty row." That is wrong. Writing always begins at **row 2** and overwrites whatever is in the output column. Importing into a column that already holds data destroys it. | `safe-writes.ts:79` |
| **(new)** The File Types filter matches by MIME prefix, so "Images" captures every image format. Selecting nothing includes every file. | `import-drive-links.ts:15-22`, `utils.ts:56-59` |
| Recursive — includes every subfolder. | `utils.ts:62-65` |
| No row range control; the row count is determined by how many files are found. | `index.ts:111` |

### Extract Text

| Behavior | Source |
|---|---|
| **(new)** Rows whose cell isn't a recognizable Drive link are skipped silently — no error, and the output cell is left untouched. | `index.ts:167-169` |
| **(new)** A link is recognized only if it contains `drive.google.com` or `/d/`. A bare file ID pasted without the surrounding URL is skipped. | `utils.ts:25-27` |
| **(new)** Unsupported file types write the literal string `[Skipped: Unsupported Type]` into the cell. Google Docs, PDFs, and images work; Google Sheets, `.docx`, plain text, audio, and video do not. | `drive.ts:64` |
| **(new)** Cells hitting the panel's stated 49,000-character cap end with the marker `... [TRUNCATED]`. Write this as one bullet about the marker — the cap itself is already in the panel's helper text and must not be restated on its own. | `utils.ts:87`, `extract-text.ts:152` |
| **(new)** Rows are written one at a time with a flush, so you watch the column fill in. There is no cancel. | `index.ts:173-174` |
| Requires the Drive advanced service; you'll get a "Setup Required" alert if it's off. | `drive.ts:16-30` |

### Sample Rows

| Behavior | Source |
|---|---|
| **(new)** Running it a second time **appends** to the existing `_evaluation` sheet rather than replacing it, so repeated runs accumulate — and with the same seed and size, they accumulate duplicates. | `index.ts:236` |
| **(new)** The header row is copied only when the `_evaluation` sheet is first created. | `index.ts:227-231` |
| **(new)** A non-numeric seed, or `0`, silently becomes 42. | `index.ts:224` |
| **(new)** The sample size must be between 1 and the number of data rows; anything else is rejected with an alert. | `index.ts:208-215` |
| Operates on the whole active sheet and ignores any cell selection. | `index.ts:197` |
| Same seed + same size + unchanged sheet = same rows. | `utils.ts:72-80` |

### Format Markdown

| Behavior | Source |
|---|---|
| **(new)** It overwrites the cell, so the original markdown characters are gone. Undo is the only way back. | `index.ts:301` |
| **(new)** The "Formatted N cell(s)" count includes only cells actually changed, so a lower number than expected means some cells were skipped, not that it failed. | `index.ts:286-302` |
| Acts on the current selection with no confirmation — check what's highlighted first. | `index.ts:278` |
| Non-text cells, empty cells, and cells that don't parse are left untouched. | `index.ts:289-299` |

## Images

Current state: nine screenshots, five of which are full-panel shots (three for Run AI
Inference, one each for Import Drive Links and Extract Text) plus two Sample Rows dialog
shots.

- **Remove** the five full-panel shots and the two dialog shots. They duplicate a panel
  that is on screen while the reader reads.
- **Keep** `format-markdown-before.png` and `format-markdown-after.png`. They show a
  transformation that prose can't convey.
- **Add** a small crop of each tool's sidebar button beside its `##` heading. Pure
  identification; cannot duplicate anything.

The button crops do not exist yet and cannot be generated from the repo — the
implementation leaves image references in place at
`docs/images/user-guide/btn-<tool>.png` for the author to supply. Deleted image files are
removed from `docs/images/user-guide/` in the same change.

## Troubleshooting section

Deleted. Four of its five entries are self-explanatory validation alerts ("Please select
an output column") that gain nothing from documentation. The two that carry information
move into the relevant tool's pitfalls list: the row-1 header rule, and the ↻ refresh
button for stale columns.

## Out of scope

- The "Evaluate as needed" material on accuracy thresholds. It belongs in separate
  documentation about AI in reporting practice, not in a tool reference read mid-task.
- Recipes. Still being refined and excluded from this alpha round; the existing one-line
  note in the intro stays.
- `README.md`. Its scope split with the user guide was settled in commit 21d1449.

## Success criteria

- No tool section restates a field label or helper string that the sidebar renders.
- The Import Drive Links overwrite behavior is documented correctly.
- Every pitfall in the guide is traceable to source, and every **(new)** row above appears
  in the rewritten doc.
- The guide is shorter than the 135 lines it replaces.
