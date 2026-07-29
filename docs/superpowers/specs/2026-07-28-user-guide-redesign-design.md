# User Guide Redesign — Design

## Problem

`docs/user-guide.md` reads as a transcription of the sidebar. Every tool section is a
numbered walkthrough that traces its panel top-to-bottom in field order, so a reporter
with the sidebar open reads the same labels twice.

Meanwhile the guide omits nearly every behavior that would actually surprise a reporter —
including one that destroys data, one that silently drops the system prompt from most rows,
and one that is documented incorrectly. It also offers no advice: there is nothing in it
about how to get a good result, only about which buttons exist.

## Goal

Rewrite the guide so every line either tells a reporter **when to reach for a tool**, **how
to get a good result from it**, or **what will surprise them**. Field-level instruction
stays in the UI. Judgment, technique, and consequences live in the doc.

## Audience and reading context

Alpha-testing reporters, reading **with the sidebar already open, mid-task**. They land in a
section directly rather than reading front to back. This dictates short, scannable,
panel-keyed sections and rules out extended narrative.

## Format

Sections 1–3 of the current doc (title/intro, "Installing the add-on", "Getting oriented")
are kept as-is. A new cross-tool workflow section follows them. Every tool section is then
rebuilt on this skeleton:

```text
## <Emoji> <Panel name>          [image: sidebar button crop]

<Short description: what the tool does, and what happens the moment you click.>

### When to reach for this

### The three components of AI inference     ← Run AI Inference only

### Tips & gotchas
```

### Rules governing the rewrite

1. **Restating the UI is fine when the doc adds the consequence; never when it just
   echoes.** The test is not "does the panel say this" but "does the reader's expectation
   diverge from what the panel states flatly." The Extract Text panel says "Truncated at
   49,000 characters" — a bare fact. The reader's assumption is *I'll get the document's
   text*, and the reality is *your longest documents get cut off mid-sentence and you won't
   be told which ones*. That belongs in the doc. Deleting a step that says "Choose an
   Output Column — pick an existing column or type a new name" does not, because there is
   no gap between expectation and behavior.
2. **No numbered step lists for panel-driven tools.** Import Drive Links, Extract Text, and
   Run AI Inference render labeled fields with helper text; steps that recite them go.
3. **The description absorbs the "what happens when I click" job.** For Sample Rows it says
   two modal dialogs fire in sequence and a new sheet appears; for Format Markdown, that it
   acts immediately on the highlighted cells. After that, the UI takes over.
4. **Nothing in the middle slot for the four Extras.** Only Run AI Inference has enough
   internal structure to warrant it.

### Voice

Tips and gotchas are one interleaved list per tool, ordered by what a reporter needs to
know first — silent-wrong-answer traps, then technique, then cost, then cosmetics. Each
item leads with a **bolded takeaway**, then explains the mechanism. Never the reverse:

> ~~A response beginning with `=`, `+`, or `-` is written with a leading apostrophe so
> Sheets shows it as text. A response containing `IMAGE(` is discarded and replaced with an
> error string.~~
>
> **Don't ask the AI to write formulas.** An answer starting with `=` lands as plain text
> with an apostrophe in front of it. An answer containing `IMAGE()` or any `IMPORT…()`
> function is thrown out entirely and replaced with an error — a deliberate guard against a
> malicious document rewriting your sheet.

Tips and gotchas are deliberately not split into separate subsections. The most valuable
items are both at once: "fill the system prompt down" is a technique *and* a trap, and
splitting it would either duplicate it or bury half of it.

## Document outline

```text
# SSI Toolkit — User Guide
  <intro + alpha scope note>                    unchanged
  ## Installing the add-on                      unchanged
  ## Getting oriented                           unchanged
  ## Working the tools together                 NEW
  ## Don't forget about other spreadsheet tools NEW

  ## ▶️ Run AI Inference
  ## 📂 Import Drive Links
  ## 📜 Extract Text
  ## 🎲 Sample Rows
  ## 📝 Format Markdown
```

## Content plan

### Working the tools together

Grounded in one concrete scenario rather than described abstractly. The sidebar's flat
"Main Tools / Extras" split hides the fact that the Extras exist to feed Run AI Inference,
and that the payoff of the whole chain is an ordinary spreadsheet you can sort and filter.

Framing: *say you have a document dump and you want to research it across a few different
categories. Here's how these tools chain together into a sheet you can actually work.*

1. **Import the documents into the sheet** — Import Drive Links turns a Drive folder into
   one row per document.
2. **Extract the text** — Extract Text puts the words in the sheet. This is your grounding
   surface: the thing you check the AI's answers against later.
3. **Decide what you're pulling out, and draft a first-pass prompt.** A chatbot is genuinely
   useful for this part — describe your documents and what you need, and iterate on the
   wording there before bringing it into the sheet.
4. **Run AI Inference — Test first.** Read the output on those rows, revise the prompt, test
   again. Reach for Sample Rows when you want a fixed subset to iterate against so
   successive attempts are comparable. Then run the full set.
5. **Use spreadsheet functions to split and ground the output.** Pull the individual
   categories out of the AI's answer into their own columns, and add a column that checks
   each claim against the extracted text — a `SEARCH()` against the source column will tell
   you whether a quoted sentence actually appears in the document.
6. **Filter, sort, pivot, report.**

Make the cost point explicit at step 4: every row is a separate paid API call, so iterate on
a handful of rows, not on the full dataset. A prompt you fix after 5,000 rows costs you
5,000 rows twice.

Step 5 hands off directly to the next section.

### Don't forget about other spreadsheet tools

Author-supplied copy, to be used close to as-written:

> SSI is best leveraged in conjunction with all the trappings of traditional spreadsheet
> work. Don't forget about [functions](https://support.google.com/docs/table/25273?hl=en)
> (`=IF()`, `=CONCAT()`, etc), column [filters and
> sorts](https://support.google.com/docs/answer/3540681?hl=en&co=GENIE.Platform%3DDesktop),
> [data validation rules](https://spreadsheetpoint.com/data-validation-google-sheets/), your
> [conditional
> formatting](https://support.google.com/docs/answer/78413?hl=en&co=GENIE.Platform%3DDesktop),
> [pivot tables](https://support.google.com/docs/answer/1272900?hl=en&co=GENIE.Platform%3DDesktop),
> etc. These remain powerful tools in your toolkit. The more you use them, the more likely
> you are to get reliable results. Remember, **we get better results when we ask the AI to
> do less**.
>
> And don't forget about existing AI-powered features of Google Sheets. The [`=AI()`
> function](https://support.google.com/docs/answer/15877199?hl=en) lacks the full featureset
> of the SSI Toolkit, but is still great for simple text classification or other small tasks
> – and it's free to use. The embedded Gemini chat window is great for helping write those
> thorny spreadsheet functions like
> `=IFERROR(SPLIT(REGEXREPLACE($O11, "[\s\S]*?""contextual_snippet"":\s*""([^""]+)""|[\s\S]+", "$1|"), "|"), "")`

Placed immediately after "Working the tools together" because step 5 of that chain depends
on exactly these features — the two sections reinforce each other, and the `REGEXREPLACE`
example above is a concrete instance of the splitting work step 5 describes.

**One open item before publishing:** confirm that `=AI()` is in fact free for the
organization's Workspace edition. Gemini-in-Workspace availability has varied by tier, and
an incorrect "it's free to use" in an alpha guide is the kind of claim a reporter will act
on. If it turns out to be edition-dependent, soften to "included with many Workspace plans."

### ▶️ Run AI Inference

**Description.** Sends a Gemini prompt for each row and writes the answer into an output
column. Clicking it opens a configuration panel — nothing runs until you press Test or
Run AI.

**When to reach for this.** The task is the same question asked once per row: summarize,
classify, extract a field, translate, check against a rule. It is the wrong tool for a
question about the dataset as a whole, because each row is an independent request that
knows nothing about the other rows.

**The three components.**

1. **Set your columns.** Frame these as *roles*, not fields — the panel's helper text
   already defines each one (`configure-ai-run.ts:564,569,578`). What it omits:
   - **Text vs. file** is the only control in the panel with no explanatory copy anywhere.
     It renders as a bare toggle reading `Text ⇄` / `File ⇄` (`prompt-col-list.ts:72,97`).
     Text mode sends the cell's characters — if the cell holds a Drive URL, the AI receives
     the URL as a string and cannot open it. File mode treats the cell as a Drive link,
     fetches the document, and sends its contents.
   - **Column order matters.** The `↑`/`↓` buttons change the order the AI receives the
     columns in, and nothing in the UI says so.
   - **Apply markdown formatting** turns the response into real rich text instead of
     leaving `**asterisks**` in the cell.

2. **AI configuration.** Frame model and tools as *what does this task need*, not as an
   options list. `MODEL_CATALOG` descriptions already render in the panel
   (`client/models.ts:25`) and must not be restated. What the panel doesn't say: pick URL
   Context when your own cells contain links you want read, and Search when the answer
   isn't in your data at all. Cost implications go in the tips list below.

3. **Run.** Why the Test button exists and when to use it:
   - It runs the **first 10 rows** of your range and reports real cost and elapsed time for
     those rows, plus a projection for the full run (`configure-ai-run.ts:423,460-467`).
     The first 10, not a random 10.
   - Change any setting afterward and the results go stale — "Configuration changed since
     last test" (`configure-ai-run.ts:502`).
   - Test whenever the prompt is new, the model changed, or a tool was added. Skip it only
     when re-running a configuration you've already validated.

**Tips & gotchas**, in order:

| Item | Source |
| --- | --- |
| **Fill your system prompt down every row.** It's read from each row's own cell, so an instruction typed only into row 2 means every row after it runs with no system prompt at all — silently, with no warning and plausible-looking output. | `inference.ts:79`, `index.ts:508` |
| **Rows with nothing in the prompt columns are skipped, not blanked.** The output cell is left exactly as it was, so a leftover value from an earlier run stays put and looks like a fresh answer. | `inference.ts:76`, `index.ts:515` |
| **Turn on "Prefix with column name" when you feed more than one text column.** It sends each value as `Column name: value` so the AI can tell them apart; without it, several columns arrive as undifferentiated blobs of text. | `inference.ts:29` |
| **Ask for a constrained answer when you plan to filter.** "Reply only YES, NO, or UNCLEAR" gives a column you can sort, filter, and pivot. An open-ended answer gives you a paragraph you have to read. | prompting practice |
| **Point Test at the rows you actually care about.** It takes the first 10 of your selection, so highlight a range starting at a document you know is hard rather than accepting rows 2–11. | `configure-ai-run.ts:423` |
| **Test is not a dry run.** It performs real inference, costs real money, and writes real answers into the output column for those 10 rows. | `configure-ai-run.ts:424` |
| **Add a second column for evidence.** Run again asking for the verbatim sentence that supports the answer. Spot-checking then means reading two cells side by side instead of reopening the source document. | technique |
| **Extract text first when documents are text-heavy.** Extracted text is cheaper to send, reusable across runs, and searchable in the sheet — and it gives you something to check the AI's answers against. Reach for file mode when layout, tables, or images carry the meaning; in file mode Google Docs are converted to PDF and Sheets to CSV before sending. | `index.ts:463-464` |
| **Google Search costs real money per query.** $14 per 1,000 searches — about 1.4 cents each, and one row can issue more than one. On Flash Lite that dwarfs token cost, so enabling Search for 5,000 rows is a different decision than for 50. The displayed cost also assumes you pay for every query; Google's free 5,000/month grounding quota is invisible to the add-on, so the real bill may be lower. | `pricing.ts:31-35` |
| **Don't ask the AI to write formulas.** An answer starting with `=`, `+`, or `-` lands as plain text with an apostrophe in front. An answer containing `IMAGE()` or any `IMPORT…()` function is thrown out entirely and replaced with an error — a deliberate guard against a malicious document rewriting your sheet. | `safe-writes.ts:13,29-35` |
| **The output column turns orange and yellow on purpose.** The header gets an orange fill and a note reading "Some cells in this column may be AI-generated"; the answer cells get a pale yellow tint. Not a bug. | `utils.ts:159-171` |
| **To stop a run, hit the ✕ at the bottom of the sidebar.** It won't stop on the spot — the toolkit sends rows to the AI in batches of 40, so it finishes the batch it's on before halting, and up to 39 more rows may still fill in. Closing the sidebar behaves the same way. | `configure-ai-run.ts:16,398`, `job-store.ts:83` |
| **A failed file leaves an error in the cell.** If a row's Drive file can't be downloaded, `[File error: …]` is written to its output cell and no inference is attempted for that row. | `index.ts:503` |
| **A new output column lands at the far right of the sheet**, past every existing column — not beside your data. | `safe-writes.ts:106` |
| **Row-range surprises.** Choosing "Specify range" but leaving either box empty silently falls back to your highlighted selection. Entering a start row higher than the end row produces the misleading alert "Row 1 is the header row and can't be processed." Row 1 is never processed under any setting. | `row-range.ts:7-9,88-90` |
| **Renamed or deleted a column mid-session?** Hit ↻ in the panel header to reload the column list. | `configure-ai-run.ts:304` |

### 📂 Import Drive Links

**Description.** Walks a Drive folder and every subfolder beneath it, writing one file link
per row into a column.

**When to reach for this.** You have a folder of documents and need them as sheet rows
before you can extract text or run AI over them. Usually the first step of a document-dump
investigation.

**Tips & gotchas:**

| Item | Source |
| --- | --- |
| **It overwrites, starting at row 2.** Writing always begins at row 2 of the output column and continues down for as many files as it finds, replacing whatever was there. Point it at a column that already holds data and that data is gone. *(The current guide states the opposite — see Corrections below.)* | `safe-writes.ts:79` |
| **It recurses into every subfolder.** A folder of folders returns everything underneath it, flattened into one column with no indication of which subfolder each file came from. | `utils.ts:62-65` |
| **You can't choose how many rows you get.** There's no row range — the row count is however many files are found. | `index.ts:111` |
| **Split a mixed dump by running it once per file type.** The File Types filter matches by MIME prefix, so "Images" catches every image format. Selecting nothing includes every file. | `import-drive-links.ts:15-22`, `utils.ts:56-59` |

### 📜 Extract Text

**Description.** Reads the Drive link in each row and writes that document's text into
another column. Google Docs are read directly; PDFs and images go through OCR.

**When to reach for this.** You want the words themselves in the sheet — searchable with
Ctrl+F, filterable, and usable as a text prompt column. Typically right after Import Drive
Links. Skip it if you plan to use file mode in Run AI Inference, which sends documents to
the model directly.

**Tips & gotchas:**

| Item | Source |
| --- | --- |
| **Long documents are cut off mid-sentence.** The panel's 49,000-character cap is a Sheets limit, and a truncated cell ends with `... [TRUNCATED]`. Nothing else flags it, so don't assume a cell holds the whole document — check for that marker before running AI over the column. | `utils.ts:87`, `extract-text.ts:152` |
| **Only three kinds of file work.** Google Docs, PDFs, and images. Everything else — Google Sheets, `.docx`, plain text, audio, video — writes the literal string `[Skipped: Unsupported Type]` into the cell. Filter the column for that string before trusting the run. | `drive.ts:64` |
| **Rows without a recognizable Drive link are skipped in silence.** No error, and the output cell is left untouched. A link only counts if it contains `drive.google.com` or `/d/`, so a bare file ID pasted without its URL is ignored. | `index.ts:167-169`, `utils.ts:25-27` |
| **Once it starts, it finishes.** Unlike an AI run, extraction isn't batched — hitting ✕ shows "Stopping…" but every row in your range still gets processed. Rows are written and flushed one at a time, so you can watch it go, but you can't call it off. Start with a small row range. | `index.ts:154-175`, `configure-ai-run.ts:398` |
| **Give it time.** Google Docs are read directly and come back quickly. PDFs and images have to be converted before their text can be read, so they take noticeably longer — budget real time for a folder of a few hundred scans. | `drive.ts:44-61` |
| **"Setup Required" means the Drive service is off.** Enable Drive API in the Apps Script editor's Services list. | `drive.ts:16-30` |

### 🎲 Sample Rows

**Description.** Asks how many rows you want, then asks for a seed, then copies your header
row plus that many randomly chosen rows into a new sheet named `<sheet name>_evaluation`
and switches you to it. No panel — two dialogs, then you're on a new sheet.

**When to reach for this.** Spot-checking. Pull a manageable subset, run a prompt against
it, and read the results by hand before committing to the full dataset.

**Tips & gotchas:**

| Item | Source |
| --- | --- |
| **Write the seed down.** The same seed and sample size against an unchanged sheet always returns the same rows, which is how you compare two prompt versions on identical data. Change the seed to draw a different sample of the same size. | `utils.ts:72-80` |
| **Running it again appends — it doesn't replace.** A second run adds to the existing `_evaluation` sheet, so repeated runs accumulate, and repeating with the same seed and size accumulates duplicates. Delete or rename the sheet first if you want a clean sample. | `index.ts:236` |
| **The header row is copied only when the sheet is first created.** | `index.ts:227-231` |
| **A non-numeric seed, or `0`, silently becomes 42.** | `index.ts:224` |
| **It ignores your selection entirely** and samples the whole active sheet. The sample size must be between 1 and the number of data rows. | `index.ts:197,208-215` |

### 📝 Format Markdown

**Description.** Rewrites your currently highlighted cells in place, converting markdown
syntax into real formatting. No panel, no column pickers, no confirmation — it acts the
moment you click.

**When to reach for this.** A run came back full of `**asterisks**` and `## hashes` as
literal text because "Apply markdown formatting" was off. Keep the existing before/after
images here.

**Tips & gotchas:**

| Item | Source |
| --- | --- |
| **Check what's highlighted first.** There's no panel and no confirmation, so it's easy to click with the wrong range selected. | `index.ts:278` |
| **The original markdown characters are gone afterward.** The cell is rewritten in place; undo is the only way back. | `index.ts:301` |
| **A lower count than expected doesn't mean it failed.** "Formatted N cell(s)" counts only cells it actually changed — non-text cells, empty cells, and cells that don't parse as markdown are left untouched and not counted. | `index.ts:286-302` |

## Corrections to the current guide

One factual error must be fixed, not just reworded: the current Import Drive Links section
says the tool "appends one row per file found, starting from the sheet's next empty row in
the output column." It does not. `writeColumn` always writes from row 2 down
(`safe-writes.ts:79`), overwriting existing values. As written, the guide invites data loss.

## Images

Current state: nine screenshots, five full-panel shots (three for Run AI Inference, one
each for Import Drive Links and Extract Text) plus two Sample Rows dialog shots.

- **Remove** the five full-panel shots and the two dialog shots — they duplicate a panel
  that is on screen while the reader reads.
- **Keep** `format-markdown-before.png` and `format-markdown-after.png`. They show a
  transformation prose can't convey.
- **Add** a small crop of each tool's sidebar button beside its `##` heading. Pure
  identification; cannot duplicate anything.

Button crops don't exist yet and can't be generated from the repo. The implementation
leaves references at `docs/images/user-guide/btn-<tool>.png` for the author to supply, and
deletes the removed image files from `docs/images/user-guide/`.

## Troubleshooting section

Deleted. Four of its five entries are self-explanatory validation alerts ("Please select an
output column") that gain nothing from documentation. The two carrying information — the
row-1 rule and the ↻ refresh button — move into the Run AI Inference tips list.

## Out of scope

- The "Evaluate as needed" material on accuracy thresholds. It belongs in separate
  documentation about AI in reporting practice, not a tool reference read mid-task.
- Recipes. Still being refined and excluded from this alpha round; the existing one-line
  note in the intro stays.
- The `=SSI()` custom function. It is live and registered for cell autocomplete
  (`rollup.config.js:99`), but it is not part of the alpha and must not be mentioned — including
  in the spreadsheet-tools section, where it would otherwise sit naturally beside `=AI()`.
- The grounding column's naming convention. The panel already renders `<output>_grounding`
  as a live badge (`configure-ai-run.ts:609`), so documenting it would be pure echo.
- `README.md`. Its scope split with the user guide was settled in commit 21d1449.

## Success criteria

- Every line in a tool section tells the reader when to use it, how to use it well, or what
  will surprise them. No line only echoes a field label.
- Every tips item leads with a bolded takeaway, not a mechanism.
- The Import Drive Links overwrite behavior is documented correctly.
- The system-prompt-per-row trap appears prominently in the Run AI Inference list.
- Every item in the tables above appears in the rewritten doc, and every claim is traceable
  to the cited source.
