# User Guide Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `docs/user-guide.md` so every line tells a reporter when to reach for a tool, how to get a good result, or what will surprise them — replacing the current per-panel numbered walkthroughs that restate the sidebar.

**Architecture:** Single-file documentation rewrite. Two new conceptual sections are added after "Getting oriented"; each of the five tool sections is rebuilt on a fixed skeleton (description → when to reach for this → tips & gotchas), with Run AI Inference alone carrying a middle "three components" section. The bottom Troubleshooting section is deleted and its two informative entries migrate into the Run AI Inference tips list. Seven duplicative screenshots are deleted.

**Tech Stack:** Markdown only. No code changes, no build, no new dependencies.

## Global Constraints

- **Source of truth:** `docs/superpowers/specs/2026-07-28-user-guide-redesign-design.md`. Read it before starting.
- **This is a prose task, so TDD's write-a-failing-test cycle does not apply.** The substitute cycle in every task is: verify the factual claim against source → write the copy → re-verify → commit. Where a step says "verify," run the exact command given and read the output; do not assume.
- **Voice rule:** every tips-and-gotchas item leads with a **bolded takeaway** (imperative or consequence), then explains the mechanism. Never mechanism-first.
- **Anti-echo rule:** restating the UI is permitted only when the doc adds the consequence the panel states flatly. These strings are hard-banned from the doc because the panel renders them and there is no expectation gap: `Sets the AI's role and behavior`, `The content the AI acts on`, `Where the AI's response will be written`, `Good for almost all tasks`, `Best for tasks that require real reasoning`.
- **`=SSI()` must not be mentioned anywhere.** It is live and registered for cell autocomplete but is not part of the alpha.
- **Recipes stay excluded.** The existing one-line note in the intro is the only mention.
- **Do not document the grounding column's naming convention.** The panel already renders `<output>_grounding` as a live badge, so explaining it would be pure echo.
- **Do not add material on accuracy thresholds or when to trust AI output.** That belongs in separate documentation about AI in reporting practice, not in a tool reference read mid-task.
- **Do not modify** `README.md` or any file under `src/`.
- **Front matter of `docs/user-guide.md` is frozen** (title, intro, "Installing the add-on", "Getting oriented" — lines 1–21) with exactly one authorized exception: line 3's tool list, updated in Task 1 Step 2. In particular **line 21 must not change** — it describes the sidebar's actual button order, which really is Import Drive Links, Sample Rows, Extract Text, Format Markdown, and is correct as written.
- **Keep** `docs/images/user-guide/format-markdown-before.png` and `format-markdown-after.png`.
- **No repo tooling covers `docs/`** — `npm run format` and `lint-staged` are scoped to `src/**/*.ts`. Do not run prettier against markdown; it would introduce formatting the repo does not apply elsewhere.
- **Commit after every task.** Branch is `add-user-guide-docs`; stay on it.

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `docs/user-guide.md` | The entire deliverable | Modify (all tasks) |
| `docs/images/user-guide/run-ai-inference-top.png` | Duplicative panel shot | Delete (Task 4) |
| `docs/images/user-guide/run-ai-inference-model-tools.png` | Duplicative panel shot | Delete (Task 4) |
| `docs/images/user-guide/run-ai-inference-rows-run.png` | Duplicative panel shot | Delete (Task 4) |
| `docs/images/user-guide/import-drive-links.png` | Duplicative panel shot | Delete (Task 4) |
| `docs/images/user-guide/extract-text.png` | Duplicative panel shot | Delete (Task 4) |
| `docs/images/user-guide/sample-rows-count-dialog.png` | Duplicative dialog shot | Delete (Task 4) |
| `docs/images/user-guide/sample-rows-seed-dialog.png` | Duplicative dialog shot | Delete (Task 4) |
| `docs/images/user-guide/format-markdown-before.png` | Shows a real transformation | Keep untouched |
| `docs/images/user-guide/format-markdown-after.png` | Shows a real transformation | Keep untouched |

**Implementation decision on button crops.** The spec calls for a sidebar-button crop beside each tool heading, but those files don't exist and can't be generated from the repo. Committing live `![...](btn-*.png)` references would render as broken-image icons for alpha testers. So each tool heading gets an **HTML comment placeholder** instead, which renders as nothing until the author supplies crops and uncomments it. Raise this with the author if they'd rather ship the live references.

---

### Task 1: Front sections and Troubleshooting removal

Adds the two new conceptual sections and deletes the Troubleshooting section. Leaves the five tool sections untouched — the doc is internally inconsistent at the end of this task, which is expected and resolved by Tasks 2 and 3.

**Files:**
- Modify: `docs/user-guide.md` (insert after line 21; delete lines 129–135)

**Interfaces:**
- Consumes: nothing.
- Produces: the `## Working the tools together` and `## Don't forget about other spreadsheet tools` headings. Task 2's Run AI Inference section assumes the workflow chain already explains iterate-on-a-sample, so Task 2's tips list does not repeat the cost-of-re-running argument at length.

- [ ] **Step 1: Confirm the front matter boundary before inserting**

Run: `sed -n '14,23p' docs/user-guide.md`

Expected: line 21 is the `- **Extras** — Import Drive Links, Sample Rows, Extract Text, and Format Markdown` bullet, and line 22 is blank. Insert the new sections after line 21. If the line numbers differ, locate the end of the "Getting oriented" section and insert there instead.

- [ ] **Step 2: Update line 3's tool list to match the new section order**

Task 3 moves Extract Text above Sample Rows, so the intro's enumeration has to follow. Also replace "walks through" — it described the numbered walkthroughs this rewrite deletes.

Replace line 3 exactly:

```markdown
The SSI Toolkit is a Google Sheets sidebar for AI-assisted investigations. This guide covers each tool available in this alpha round: **Run AI Inference**, **Import Drive Links**, **Extract Text**, **Sample Rows**, and **Format Markdown**.
```

This is the only authorized edit to lines 1–21. Leave line 21 alone — it lists the sidebar's real button order, which is unchanged.

- [ ] **Step 3: Insert the "Working the tools together" section**

Insert immediately after the "Getting oriented" section:

```markdown
## Working the tools together

The sidebar splits the toolkit into "Main Tools" and "Extras," which undersells what the Extras are for: they exist to get your material into the sheet so Run AI Inference has something to work on. The payoff at the end of the chain is an ordinary spreadsheet — one you can sort, filter, and pivot like any other.

Say you have a document dump and you want to research it across a few different categories. Here's how these tools chain together into a sheet you can actually work:

1. **Import the documents into the sheet.** Import Drive Links turns a Drive folder into one row per document.
2. **Extract the text.** Extract Text puts the words in the sheet. This is your grounding surface — the thing you check the AI's answers against later.
3. **Decide what you're pulling out, and draft a first-pass prompt.** A chatbot is genuinely useful here. Describe your documents and what you need, and get the wording roughly right before bringing it into the sheet.
4. **Run AI Inference — Test first.** Read the output on those rows, revise the prompt, and test again. Every row is a separate paid API call, so iterate on a handful of rows rather than on the full dataset — a prompt you fix after 5,000 rows costs you 5,000 rows twice. Reach for Sample Rows when you want a fixed subset to iterate against, so successive attempts are comparable. Then run the full set.
5. **Use spreadsheet functions to split and ground the output.** Pull the individual categories out of the AI's answer into their own columns. Then add a column that checks each claim against the extracted text — a `SEARCH()` against the source column will tell you whether a quoted sentence actually appears in the document.
6. **Filter, sort, pivot, report.**
```

- [ ] **Step 4: Insert the "Don't forget about other spreadsheet tools" section**

Insert immediately after the section added in Step 2. Use this copy as-written — it is author-supplied:

```markdown
## Don't forget about other spreadsheet tools

SSI is best leveraged in conjunction with all the trappings of traditional spreadsheet work. Don't forget about [functions](https://support.google.com/docs/table/25273?hl=en) (`=IF()`, `=CONCAT()`, etc), column [filters and sorts](https://support.google.com/docs/answer/3540681?hl=en&co=GENIE.Platform%3DDesktop), [data validation rules](https://spreadsheetpoint.com/data-validation-google-sheets/), your [conditional formatting](https://support.google.com/docs/answer/78413?hl=en&co=GENIE.Platform%3DDesktop), [pivot tables](https://support.google.com/docs/answer/1272900?hl=en&co=GENIE.Platform%3DDesktop), etc. These remain powerful tools in your toolkit. The more you use them, the more likely you are to get reliable results. Remember, **we get better results when we ask the AI to do less**.

And don't forget about existing AI-powered features of Google Sheets. The [`=AI()` function](https://support.google.com/docs/answer/15877199?hl=en) lacks the full featureset of the SSI Toolkit, but is still great for simple text classification or other small tasks — and it's free to use, subject to usage limits. The embedded Gemini chat window is great for helping write those thorny spreadsheet functions like `=IFERROR(SPLIT(REGEXREPLACE($O11, "[\s\S]*?""contextual_snippet"":\s*""([^""]+)""|[\s\S]+", "$1|"), "|"), "")`
```

- [ ] **Step 5: Delete the Troubleshooting section**

Delete the entire `## Troubleshooting` heading and all five bullets beneath it (the last section in the file). Its two informative entries — the row-1 rule and the ↻ refresh button — are re-added in Task 2, so nothing is lost.

- [ ] **Step 6: Verify the structure**

Run: `grep -n '^## ' docs/user-guide.md`

Expected output, in this order:

```
## Installing the add-on
## Getting oriented
## Working the tools together
## Don't forget about other spreadsheet tools
## Run AI Inference
## Import Drive Links
## Sample Rows
## Extract Text
## Format Markdown
```

There must be no `## Troubleshooting` line. Note that Sample Rows currently precedes Extract Text; Task 3 reorders them.

- [ ] **Step 7: Verify no banned string was introduced and `=SSI` is absent**

Run: `grep -nE "SSI\(\)|Sets the AI's role|The content the AI acts on|Where the AI's response" docs/user-guide.md`

Expected: no output (exit status 1).

- [ ] **Step 8: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs: add workflow and spreadsheet-tools sections, drop troubleshooting

Adds a grounded document-dump walkthrough showing how the Extras feed
Run AI Inference, plus a section on the Sheets features that do the
splitting and grounding work. Deletes Troubleshooting, whose entries
were mostly self-explanatory validation alerts."
```

---

### Task 2: Run AI Inference section

**Files:**
- Modify: `docs/user-guide.md` (replace the entire `## Run AI Inference` section)

**Interfaces:**
- Consumes: the `## Working the tools together` section from Task 1 — the iterate-on-a-sample argument lives there and is referenced, not repeated.
- Produces: the `### Tips & gotchas` heading pattern that Task 3 reuses verbatim for the four Extras.

- [ ] **Step 1: Verify the system-prompt-per-row claim before writing it**

This is the most important claim in the document, so confirm it holds.

Run: `sed -n '508p' src/server/index.ts; sed -n '79p' src/server/inference.ts`

Expected:

```
    const systemPrompt = systemPromptIdx >= 0 ? dataValues[i][systemPromptIdx] : undefined;
    systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
```

This confirms the system prompt is read from each row's own cell, so a value present only in row 2 does not apply to later rows. If the code has changed, stop and re-verify the claim before documenting it.

- [ ] **Step 2: Verify the chunk size, test cap, and search price**

Run: `grep -n "CHUNK_SIZE = \|start + 9" src/client/panels/configure-ai-run.ts; grep -n "GROUNDING_PRICE_PER_1000_QUERIES = " src/server/pricing.ts`

Expected:

```
16:export const CHUNK_SIZE = 40;
423:          const cappedEnd = Math.min(sanitized.start + 9, sanitized.end);
GROUNDING_PRICE_PER_1000_QUERIES = 14.0;
```

These fix the numbers 40, 10, and $14 used in the copy below. If any differs, update the copy to match the code.

- [ ] **Step 3: Replace the Run AI Inference section**

Replace everything from `## Run AI Inference` up to (not including) `## Import Drive Links` with:

```markdown
## ▶️ Run AI Inference

<!-- ![Run AI Inference button](images/user-guide/btn-run-ai-inference.png) -->

Sends a Gemini prompt for each row and writes the answer into an output column. Clicking it opens a configuration panel — nothing runs until you press **Test** or **Run AI**.

### When to reach for this

The task is the same question asked once per row: summarize, classify, extract a field, translate, check against a rule. It's the wrong tool for a question about the dataset as a whole, because each row is an independent request that knows nothing about the other rows.

### The three components of AI inference

#### 1. Set your columns

Three columns do three different jobs, and the panel explains each as you fill it in. What it doesn't tell you:

**Text or file.** Each user prompt column carries a small toggle reading `Text ⇄` or `File ⇄`. In **text** mode the cell's characters are sent as they are — so a cell holding a Drive URL sends the AI the URL itself, which it cannot open. In **file** mode the cell is treated as a Drive link: the document is fetched and its contents are sent. Google Docs are converted to PDF and Google Sheets to CSV on the way.

**Order matters.** The `↑` and `↓` buttons change the order the AI receives your columns in.

Checking **Apply markdown formatting** turns the response into real rich text instead of leaving `**asterisks**` sitting in the cell.

#### 2. AI configuration

Choose a model and tools based on what the task needs. The panel describes each model when you expand the section.

For tools: reach for **URL Context** when your own cells contain links you want read, **Google Search** when the answer isn't in your data at all, and **Code Execution** for arithmetic you'd rather not have the model do in its head.

#### 3. Run

**Test** runs the first 10 rows of your range and reports what those rows actually cost and how long they took, plus a projection for the full run. Use it whenever the prompt is new, the model changed, or you've added a tool — and skip it only when you're re-running a setup you've already validated. Change any setting after testing and the results are marked stale until you test again.

**Run AI** then processes every row in your range.

### Tips & gotchas

- **Fill your system prompt down every row.** It's read from each row's own cell, so an instruction typed only into row 2 means every row after it runs with no system prompt at all — silently, with no warning, and returning output that looks perfectly plausible.
- **Rows with nothing in the prompt columns are skipped, not blanked.** The output cell is left exactly as it was, so a leftover value from an earlier run stays put and reads like a fresh answer.
- **Turn on "Prefix with column name" when you feed more than one text column.** It sends each value as `Column name: value` so the AI can tell them apart. Without it, several columns arrive as one undifferentiated block of text.
- **Ask for a constrained answer when you plan to filter.** "Reply only YES, NO, or UNCLEAR" gives you a column you can sort, filter, and pivot. An open-ended question gives you a paragraph you have to read.
- **Point Test at the rows you actually care about.** It takes the first 10 rows of your selection, not a random 10 — so highlight a range starting at a document you know is difficult rather than accepting rows 2–11.
- **Test is not a dry run.** It performs real inference, costs real money, and writes real answers into the output column for those 10 rows.
- **Add a second column for evidence.** Run again asking for the verbatim sentence that supports the answer. Spot-checking then means reading two cells side by side instead of reopening the source document.
- **Extract text first when your documents are text-heavy.** Extracted text is cheaper to send, reusable across runs, searchable in the sheet, and gives you something to check the AI against. Reach for file mode when layout, tables, or images carry the meaning.
- **Google Search costs real money per query.** It's billed at $14 per 1,000 searches — about 1.4 cents each, and a single row can issue more than one. That dwarfs the token cost on Flash Lite, so switching Search on for 5,000 rows is a different decision than for 50. The cost shown also assumes you pay for every query; Google's free monthly grounding allowance is invisible to the add-on, so your real bill may be lower.
- **Don't ask the AI to write formulas.** An answer starting with `=`, `+`, or `-` lands as plain text with an apostrophe in front of it. An answer containing `IMAGE()` or any `IMPORT…()` function is thrown out entirely and replaced with an error — a deliberate guard against a malicious document rewriting your sheet.
- **The output column turns orange and yellow on purpose.** The header gets an orange fill and a note reading "Some cells in this column may be AI-generated"; the answer cells get a pale yellow tint. That's a reminder, not a bug.
- **To stop a run, hit the ✕ at the bottom of the sidebar.** It won't stop on the spot — the toolkit sends rows to the AI in batches of 40, so it finishes the batch it's on first, and up to 39 more rows may still fill in. Closing the sidebar behaves the same way.
- **A failed file leaves an error in the cell.** If a row's Drive file can't be downloaded, `[File error: …]` is written to its output cell and no inference is attempted for that row.
- **A new output column lands at the far right of the sheet**, past every existing column — not beside your data.
- **Watch the row range.** Choosing "Specify range" but leaving either box empty quietly falls back to your highlighted selection. Entering a start row higher than the end row produces the misleading alert "Row 1 is the header row and can't be processed." Row 1 is never processed under any setting.
- **Renamed or deleted a column mid-session?** Hit ↻ in the panel header to reload the column list.
```

- [ ] **Step 4: Verify every bolded lead-in is a takeaway, not a mechanism**

Run: `grep -n '^- \*\*' docs/user-guide.md | sed -n '1,20p'`

Expected: 16 bullets, each opening with an imperative or a consequence ("Fill your…", "Don't ask…", "Test is not a dry run…"). None may open by naming an internal mechanism ("`writeColumn` starts at…", "The `isCancelled` flag…"). Rewrite any that do.

- [ ] **Step 5: Verify the banned strings are still absent**

Run: `grep -nE "SSI\(\)|Sets the AI's role|The content the AI acts on|Where the AI's response|Good for almost all tasks|Best for tasks that require real reasoning" docs/user-guide.md`

Expected: no output (exit status 1). If the model descriptions appear, delete them — the panel renders them already.

- [ ] **Step 6: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs: rebuild Run AI Inference section around judgment and gotchas

Replaces the field-by-field walkthrough with three conceptual
components and a tips list. Documents the per-row system prompt trap,
the fact that Test performs real billed inference, per-query Search
pricing, and the formula-injection guard on AI output."
```

---

### Task 3: The four Extras sections

**Files:**
- Modify: `docs/user-guide.md` (replace the Import Drive Links, Sample Rows, Extract Text, and Format Markdown sections; reorder so Extract Text precedes Sample Rows)

**Interfaces:**
- Consumes: the `### Tips & gotchas` heading pattern established in Task 2.
- Produces: the final section order, which Task 4 verifies.

- [ ] **Step 1: Verify the Import Drive Links overwrite behavior**

The current guide documents this incorrectly, so confirm the truth before writing.

Run: `sed -n '72,87p' src/server/safe-writes.ts`

Expected: `writeColumn` computes `const range = sheet.getRange(2, colIdx, values.length, 1);` — writing always begins at **row 2** and overwrites. It does not append at the next empty row. If this has changed, re-verify before documenting.

- [ ] **Step 2: Verify the Extract Text skip strings and the seed fallback**

Run: `grep -n "Skipped: Unsupported Type\|TRUNCATED" src/server/drive.ts src/server/utils.ts; grep -n "|| 42" src/server/index.ts`

Expected:

```
src/server/drive.ts:64:    return "[Skipped: Unsupported Type]";
src/server/utils.ts:87:  return text.substring(0, maxLength) + "... [TRUNCATED]";
src/server/index.ts:224:  const seed = parseInt(seedResponse.getResponseText()) || 42;
```

The `|| 42` confirms a non-numeric seed — or `0`, which is falsy — becomes 42.

- [ ] **Step 3: Replace the Import Drive Links section**

Replace everything from `## Import Drive Links` up to the next `## ` heading with:

```markdown
## 📂 Import Drive Links

<!-- ![Import Drive Links button](images/user-guide/btn-import-drive-links.png) -->

Walks a Google Drive folder and every subfolder beneath it, writing one file link per row into a column.

### When to reach for this

You have a folder of documents and need them as rows before you can extract text or run AI over them. This is usually the first step of a document-dump investigation.

### Tips & gotchas

- **It overwrites, starting at row 2.** Writing begins at row 2 of the output column and continues down for as many files as it finds, replacing whatever was there. Point it at a column that already holds data and that data is gone.
- **It recurses into every subfolder.** A folder of folders returns everything underneath it, flattened into a single column with no indication of which subfolder each file came from.
- **You can't choose how many rows you get.** There's no row range — the row count is however many files it finds.
- **Split a mixed dump by running it once per file type.** The File Types filter matches by category, so "Images" catches every image format. Selecting nothing at all includes every file.
```

- [ ] **Step 4: Replace the Extract Text section and move it above Sample Rows**

The current file orders these as Sample Rows then Extract Text. Place Extract Text first, since it follows Import Drive Links in the workflow. Use:

```markdown
## 📜 Extract Text

<!-- ![Extract Text button](images/user-guide/btn-extract-text.png) -->

Reads the Drive link in each row and writes that document's text into another column. Google Docs are read directly; PDFs and images go through OCR.

### When to reach for this

You want the words themselves in the sheet — searchable with Ctrl+F, filterable, and usable as a text prompt column. Typically this runs right after Import Drive Links. Skip it if you plan to use file mode in Run AI Inference, which sends documents to the model directly.

### Tips & gotchas

- **Long documents are cut off mid-sentence.** The panel's 49,000-character cap is a Google Sheets limit, and a truncated cell ends with `... [TRUNCATED]`. Nothing else flags it, so don't assume a cell holds a whole document — search the column for that marker before running AI over it.
- **Only three kinds of file work.** Google Docs, PDFs, and images. Everything else — Google Sheets, `.docx`, plain text, audio, video — writes the literal string `[Skipped: Unsupported Type]` into the cell. Filter for that string before trusting the results.
- **Rows without a recognizable Drive link are skipped in silence.** No error, and the output cell is left untouched. A link only counts if it looks like a Drive URL, so a bare file ID pasted without the surrounding URL is ignored.
- **Once it starts, it finishes.** Unlike an AI run, extraction isn't batched — hitting ✕ won't halt it, and every row in your range still gets processed. Rows are written one at a time so you can watch it go, but you can't call it off. Start with a small row range.
- **Give it time.** Google Docs are read directly and come back quickly. PDFs and images have to be converted before their text can be read, so they take noticeably longer — budget real time for a folder of a few hundred scans.
- **"Setup Required" means the Drive service is off.** Enable the Drive API in the Apps Script editor's Services list.
```

- [ ] **Step 5: Replace the Sample Rows section**

Place after Extract Text:

```markdown
## 🎲 Sample Rows

<!-- ![Sample Rows button](images/user-guide/btn-sample-rows.png) -->

Asks how many rows you want, then asks for a seed, then copies your header row plus that many randomly chosen rows into a new sheet named `<your sheet name>_evaluation` and switches you to it. There's no panel — two dialogs, and then you're on a new sheet.

### When to reach for this

Spot-checking. Pull a manageable subset, run a prompt against it, and read the results by hand before committing to the full dataset.

### Tips & gotchas

- **Write the seed down.** The same seed and sample size against an unchanged sheet always returns the same rows, which is how you compare two prompt versions on identical data. Change the seed to draw a different sample of the same size.
- **Running it again appends — it doesn't replace.** A second run adds to the existing `_evaluation` sheet, so repeated runs accumulate, and repeating with the same seed and size accumulates duplicates. Delete or rename the sheet first if you want a clean sample.
- **The header row is copied only when the sheet is first created.**
- **A non-numeric seed, or `0`, silently becomes 42.**
- **It ignores your selection entirely** and samples the whole active sheet. The sample size has to be between 1 and the number of data rows.
```

- [ ] **Step 6: Replace the Format Markdown section**

```markdown
## 📝 Format Markdown

<!-- ![Format Markdown button](images/user-guide/btn-format-markdown.png) -->

Rewrites your currently highlighted cells in place, turning markdown syntax into real formatting. No panel, no column pickers, no confirmation — it acts the moment you click.

### When to reach for this

A run came back full of `**asterisks**` and `## hashes` as literal text because "Apply markdown formatting" was switched off.

![Cells with markdown syntax, before formatting](images/user-guide/format-markdown-before.png)

![The same cells after clicking Format Markdown](images/user-guide/format-markdown-after.png)

### Tips & gotchas

- **Check what's highlighted first.** There's no panel and no confirmation, so it's easy to click with the wrong range selected.
- **The original markdown characters are gone afterward.** The cell is rewritten in place, and undo is the only way back.
- **A lower count than you expected doesn't mean it failed.** "Formatted 6 cell(s)" counts only the cells it actually changed — non-text cells, empty cells, and cells that don't parse as markdown are left untouched and not counted.
```

- [ ] **Step 7: Verify the final section order**

Run: `grep -n '^## ' docs/user-guide.md`

Expected, in exactly this order:

```
## Installing the add-on
## Getting oriented
## Working the tools together
## Don't forget about other spreadsheet tools
## ▶️ Run AI Inference
## 📂 Import Drive Links
## 📜 Extract Text
## 🎲 Sample Rows
## 📝 Format Markdown
```

- [ ] **Step 8: Verify the old walkthrough scaffolding is gone**

Run: `grep -nE "^\*\*Steps:\*\*|^\*\*Good to know:\*\*|from (Main Tools|Extras)\." docs/user-guide.md`

Expected: no output (exit status 1). Any hit means a numbered walkthrough or "Good to know" block survived and must be removed.

Do **not** broaden this to `^[0-9]+\. Click \*\*` — that also matches line 12 of the protected front matter (`2. Click **Install**, and grant the requested permissions…`), which legitimately survives, so the check would never pass.

- [ ] **Step 9: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs: rebuild the four Extras sections

Corrects the Import Drive Links write behavior: it overwrites from row 2
rather than appending at the next empty row, as the guide claimed.
Documents the silent-skip and unsupported-type strings in Extract Text,
the appending _evaluation sheet, and the seed fallback. Moves Extract
Text above Sample Rows to match the workflow order."
```

---

### Task 4: Image cleanup and final sweep

**Files:**
- Delete: seven `.png` files under `docs/images/user-guide/` (listed in File Structure above)
- Modify: `docs/user-guide.md` only if the sweep finds a problem

**Interfaces:**
- Consumes: the finished doc from Tasks 1–3.
- Produces: the final deliverable.

- [ ] **Step 1: Confirm nothing else references the seven images**

Run:

```bash
grep -rn "run-ai-inference-top\|run-ai-inference-model-tools\|run-ai-inference-rows-run\|import-drive-links.png\|user-guide/extract-text.png\|sample-rows-count-dialog\|sample-rows-seed-dialog" --include="*.md" --include="*.ts" --include="*.html" .
```

Expected: no output. If any file still references one, resolve that reference before deleting — do not delete an image another document depends on.

- [ ] **Step 2: Delete the seven duplicative images**

```bash
git rm docs/images/user-guide/run-ai-inference-top.png \
       docs/images/user-guide/run-ai-inference-model-tools.png \
       docs/images/user-guide/run-ai-inference-rows-run.png \
       docs/images/user-guide/import-drive-links.png \
       docs/images/user-guide/extract-text.png \
       docs/images/user-guide/sample-rows-count-dialog.png \
       docs/images/user-guide/sample-rows-seed-dialog.png
```

- [ ] **Step 3: Verify only the two Format Markdown images remain**

Run: `ls docs/images/user-guide/`

Expected exactly:

```
format-markdown-after.png
format-markdown-before.png
```

- [ ] **Step 4: Verify every live image reference resolves to a real file**

Run:

```bash
grep -o '](images/[^)]*)' docs/user-guide.md | tr -d '](' | sed 's/)$//' | while read -r p; do
  [ -f "docs/$p" ] && echo "OK   $p" || echo "MISS $p"
done
```

Expected: two `OK` lines for the Format Markdown images, and no `MISS` lines. The five button-crop paths are inside HTML comments and must not appear here — if one does, it was left uncommented.

- [ ] **Step 5: Verify the guide is shorter than what it replaced**

Run: `wc -l < docs/user-guide.md && git show 21d1449:docs/user-guide.md | wc -l`

`21d1449` is the last commit before this redesign began, so it is a stable reference regardless of how many commits the rewrite took.

Expected: the first number is lower than the second (135). If it isn't, the rewrite has kept material the spec called for cutting — re-read the tool sections for surviving field-by-field description.

- [ ] **Step 6: Read the whole file once, start to finish**

Run: `cat docs/user-guide.md`

Check against the spec's success criteria:
- Every line tells the reader when to use a tool, how to use it well, or what will surprise them. No line only echoes a field label.
- Every tips item leads with a bolded takeaway.
- Import Drive Links documents overwrite-from-row-2.
- The system-prompt-per-row trap is the first item in the Run AI Inference tips list.
- No mention of `=SSI()`, and Recipes appear only in the intro's one-line note.

Fix anything that fails, then re-run this step.

- [ ] **Step 7: Commit**

```bash
git add -A docs/
git commit -m "docs: drop duplicative panel screenshots from the user guide

Removes the five full-panel shots and two dialog shots, which restated a
sidebar that's on screen while the reader reads. Keeps the Format
Markdown before/after pair, which shows a transformation prose can't.
Button-crop references are left commented out pending real crops."
```

- [ ] **Step 8: Report the button-crop status to the author**

The five `btn-*.png` references are committed as HTML comments so nothing renders broken. Tell the author which filenames to supply and where, and that uncommenting is a one-line change per tool:

```
docs/images/user-guide/btn-run-ai-inference.png
docs/images/user-guide/btn-import-drive-links.png
docs/images/user-guide/btn-extract-text.png
docs/images/user-guide/btn-sample-rows.png
docs/images/user-guide/btn-format-markdown.png
```
