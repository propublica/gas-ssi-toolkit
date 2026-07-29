# SSI Toolkit — User Guide

The SSI Toolkit is a Google Sheets sidebar for AI-assisted investigations. This guide covers each tool available in this alpha round: **Run AI Inference**, **Import Drive Links**, **Extract Text**, **Sample Rows**, and **Format Markdown**.

Recipes (the curated, one-click AI workflows) also appear in the sidebar, but they're still being refined and aren't part of this alpha round — feel free to ignore that button for now.

## Installing the add-on

The following directions only apply if your organization distributes SSI Toolkit as a **Google Workspace Editor add-on** (installed once, available across every Sheet you open). If you're working with a **container-bound** copy of the toolkit (attached directly to one specific Sheet), skip ahead to [Getting oriented](#getting-oriented).

1. Open your organization's Marketplace listing for the add-on: `<Marketplace URL — ask your admin>`
2. Click **Install**, and grant the requested permissions when prompted.

## Getting oriented

Open the sidebar using the **📐 Open SSI Toolkit** menu option. If installed as an Editor Add on, the SSI Toolkit will be available as a item under **Extensions**.  

The sidebar organizes its buttons into two groups:

- **Main Tools** — Recipes and Run AI Inference
- **Extras** — Import Drive Links, Sample Rows, Extract Text, and Format Markdown

## Working the tools together

The sidebar splits the toolkit into "Main Tools" and "Extras," which undersells what the Extras are for: they exist to get your material into the sheet so Run AI Inference has something to work on. The payoff at the end of the chain is an ordinary spreadsheet — one you can sort, filter, and pivot like any other.

Say you have a document dump and you want to research it across a few different categories. Here's how these tools chain together into a sheet you can actually work:

1. **Import the documents into the sheet.** Import Drive Links turns a Drive folder into one row per document.
2. **Extract the text.** Extract Text puts the words in the sheet. This is your grounding surface — the thing you check the AI's answers against later.
3. **Decide what you're pulling out, and draft a first-pass prompt.** A chatbot is genuinely useful here. Describe your documents and what you need, and get the wording roughly right before bringing it into the sheet.
4. **Run AI Inference — Test first.** Read the output on those rows, revise the prompt, and test again. Every row is a separate paid API call, so iterate on a handful of rows rather than on the full dataset — a prompt you fix after 5,000 rows costs you 5,000 rows twice. Reach for Sample Rows when you want a fixed subset to iterate against, so successive attempts are comparable. Then run the full set.
5. **Use spreadsheet functions to split and ground the output.** Pull the individual categories out of the AI's answer into their own columns. Then add a column that checks each claim against the extracted text — a `SEARCH()` against the source column will tell you whether a quoted sentence actually appears in the document.
6. **Filter, sort, pivot, report.**

## Don't forget about other spreadsheet tools

SSI is best leveraged in conjunction with all the trappings of traditional spreadsheet work. Don't forget about [functions](https://support.google.com/docs/table/25273?hl=en) (`=IF()`, `=CONCAT()`, etc), column [filters and sorts](https://support.google.com/docs/answer/3540681?hl=en&co=GENIE.Platform%3DDesktop), [data validation rules](https://spreadsheetpoint.com/data-validation-google-sheets/), your [conditional formatting](https://support.google.com/docs/answer/78413?hl=en&co=GENIE.Platform%3DDesktop), [pivot tables](https://support.google.com/docs/answer/1272900?hl=en&co=GENIE.Platform%3DDesktop), etc. These remain powerful tools in your toolkit. The more you use them, the more likely you are to get reliable results. Remember, **we get better results when we ask the AI to do less**.

And don't forget about existing AI-powered features of Google Sheets. The [`=AI()` function](https://support.google.com/docs/answer/15877199?hl=en) lacks the full featureset of the SSI Toolkit, but is still great for simple text classification or other small tasks — and it's free to use, subject to usage limits. The embedded Gemini chat window is great for helping write those thorny spreadsheet functions like `=IFERROR(SPLIT(REGEXREPLACE($O11, "[\s\S]*?""contextual_snippet"":\s*""([^""]+)""|[\s\S]+", "$1|"), "|"), "")`

## Run AI Inference

Runs a Gemini prompt against each selected row and writes the response into an output column. Supports plain text prompts, file/document inputs from Google Drive, and optional extra capabilities like web search.

![Run AI Inference panel — prompts and output](images/user-guide/run-ai-inference-top.png)

![Run AI Inference panel — model and tools](images/user-guide/run-ai-inference-model-tools.png)

![Run AI Inference panel — row range, test/run buttons](images/user-guide/run-ai-inference-rows-run.png)

**Steps:**

1. Click **▶️ Run AI Inference** from Main Tools.
2. *(Optional)* Choose a **System prompt column** — a column whose text sets the AI's role and behavior before it sees any row data.
3. Add one or more **User prompt columns** — the content the AI actually reads for each row. Click **+ Add column** for more than one, and toggle each between **text** (the column's text is inserted into the prompt) and **file** (the column holds a Drive link, and its file contents are sent to the AI). Check **Prefix with column name** if you want the column name to pass into the AI as a label: `<column name>: <my cell data>`.
4. Choose an **Output column** — pick an existing column or type a new name to create one. Check **Apply markdown formatting** if you want the AI's response rendered with headings/bold/etc. rather than as plain text.
5. *(Optional)* Expand **MODEL** to pick between **Gemini 3.1 Flash Lite** (fast, good for most tasks — summarizing, extraction, translation, bulk categorization) and **Gemini 3.1 Pro Preview** (slower, better for real reasoning over ambiguous or conflicting sources).
6. *(Optional)* Expand **TOOLS** to give the AI extra capabilities: **Google Search** (grounds answers in live web results), **URL Context** (fetches and reads URLs mentioned in the prompt), and **Code Execution** (runs Python for calculations). If you select any tool, you can also check **Include grounding column** to write out an extra column of the sources/citations the AI used alongside its answer.
7. Set **Rows to process**. You have the option of either running the AI on the rows currently highlighted on the sheet, or explicitly setting a start and end row directly.
8. Click **Test** to run just the first 10 rows of your selection. This shows actual cost and time for those rows, plus an estimate for the full run — a good way to check quality and cost before committing.
9. When you're satisfied, click **Run AI** to process every selected row. For runs over 200 rows, you'll see a confirmation dialog with a time estimate — keep the sidebar open until it finishes, since closing it stops the run after the current batch.

**Good to know:**

- The Test button always samples the first 10 rows of your current selection, not a random sample.
- If you change any configuration after testing, the test results are marked stale until you test again.

## Import Drive Links

Recursively lists files from a Google Drive folder into a column, one file link per row.

![Import Drive Links panel, configured](images/user-guide/import-drive-links.png)

**Steps:**

1. Click **📂 Import Drive Links** from Extras.
2. Paste a Google Drive folder URL or ID into **Drive Folder**.
3. Choose an **Output Column** — pick an existing column or type a new name to create one.
4. *(Optional)* Under **File Types**, select which kinds to filter by (Google Docs, Google Sheets, PDFs, Images, Audio, Video). Leave blank to include everything.
5. Click **Import Links**.

**Good to know:**

- This tool searches the folder recursively, including subfolders.
- There's no row-range control here — it appends one row per file found, starting from the sheet's next empty row in the output column.

## Sample Rows

Pulls a reproducible random sample of rows from your sheet into a new sheet, useful for testing a prompt on a manageable subset before running it on everything.

![Sample Rows — "Sample Data" prompt](images/user-guide/sample-rows-count-dialog.png)

![Sample Rows — "Random Seed" prompt](images/user-guide/sample-rows-seed-dialog.png)

**Steps:**

1. Click **🎲 Sample Rows** from Extras.
2. When prompted, enter how many rows you'd like to sample.
3. When prompted for a seed, enter a number (or leave it — it defaults to 42). Using the same seed and sample size always produces the same sample, which is useful if you want to compare prompt changes against an identical set of rows.
4. The tool copies your header row plus the sampled rows into a new sheet named `<your sheet name>_evaluation`, and switches you to it.

**Good to know:**

- This tool works on the entire active sheet — it ignores any cell selection.
- If you run it again with the same seed and sample size against an unchanged sheet, you'll get the same rows.
- Running it again appends to the existing `_evaluation` sheet rather than overwriting it.

## Extract Text

Pulls text out of a Google Doc, PDF, or image (via OCR) linked in a column, and writes the extracted text into another column. Pairs naturally with Import Drive Links.

![Extract Text panel, configured](images/user-guide/extract-text.png)

**Steps:**

1. Click **📜 Extract Text** from Extras.
2. Choose the **Source Column** containing the Drive links to extract from.
3. Choose an **Output Column** — pick an existing column or type a new name to create one.
4. Set the **Row Range**. You have the option of either extracting text from the rows currently highlighted on the sheet, or explicitly setting a start and end row directly.
5. Click **Extract Text**.

**Good to know:**

- Extracted text is truncated at 49,000 characters per cell, a limitation of Google Sheets.
- PDFs and Images are OCR'd via a temporary Google Doc conversion — this can take a few seconds per image.

## Format Markdown

Unlike the other tools, Format Markdown doesn't have its own panel or column pickers — it acts directly on whatever cells you currently have highlighted on the sheet.

![Cells with markdown syntax, before formatting](images/user-guide/format-markdown-before.png)

**Steps:**

1. On the sheet itself, select the cell or range of cells you want to format — these should contain plain text written with markdown syntax (headings with `#`, `**bold**`, `*italic*`, `~~strikethrough~~`, `` `inline code` ``, links).
2. Click **📝 Format Markdown** from Extras.
3. Each selected cell is rewritten in place with real formatting (headings, bold, italics, etc.) applied — no output column needed.

![Same cells after clicking Format Markdown](images/user-guide/format-markdown-after.png)

**Good to know:**

- Because it works on your highlighted selection rather than a configured column, it's easy to click without meaning to — double check your selection first.
- Cells that aren't text, or that don't parse as valid markdown, are left untouched.
- You'll see a confirmation like "Formatted 6 cell(s)" when it finishes.
