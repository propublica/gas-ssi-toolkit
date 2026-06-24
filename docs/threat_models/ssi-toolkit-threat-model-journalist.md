# SSI Toolkit — Journalist Threat Model

| Field | Value |
| --- | --- |
| Project | SSI Toolkit (Google Apps Script add-on for Google Sheets) |
| Scope | Journalist-facing bad outcomes — misuse patterns and workflow failures |
| Version | 1.0 |
| Last updated | 2026-06-16 |

---

## Consequence Tags

| Tag | Meaning |
| --- | --- |
| **JH** | **Journalistic Harm** — incorrect assertions, flawed methodology, publishable errors |
| **OW** | **Operational Waste** — wasted time, effort, or compute |
| **CR** | **Compliance / Ethics Risk** — data exposure, legal exposure, source risk |

## Mitigation Strategies

| Strategy | Meaning |
| --- | --- |
| **Prevent** | The tool can block or warn before the bad outcome occurs |
| **Reduce** | The tool can make the bad outcome harder to fall into |
| **Educate** | Guidance or copy can address this — not a code change |
| **Accept** | Out of scope for the tool to address |

---

## Phase 0 — Problem Assessment
*Deciding whether and how to use the tool*

| ID | Bad Outcome | Tags | Mitigation | Description |
| --- | --- | --- | --- | --- |
| BO01 | Poor problem decomposition | OW JH | Educate, Reduce | The reporter cannot translate their reporting question into discrete computational steps. They ask the AI to do too much in one pass, struggle to identify which steps are inference-appropriate vs. spreadsheet-appropriate, and end up with outputs too poorly formatted to act on. |
| BO02 | Wrong tool for the job | OW | Educate | The reporter reaches for SSI on a task better suited to NotebookLM, Gemini chat, a database query, or a simple regex. They get mediocre results from a tool optimized for something else. |
| BO03 | AI over-reliance (manual or expert would be better) | OW JH | Educate | The reporter uses AI where manual review or a subject-matter expert would be faster, cheaper, and more reliable. They trust the tool's authority over their own or a colleague's judgment. |

---

## Phase 1 — Data Preparation
*What goes into the tool*

| ID | Bad Outcome | Tags | Mitigation | Description |
| --- | --- | --- | --- | --- |
| BO04 | Sensitive data exposure | CR | Prevent | The reporter uploads confidential documents, PII, source-identifying material, or embargoed information to Gemini servers without understanding the data-handling implications. |
| BO05 | Unrepresentative or dirty input data | JH | Accept | The reporter runs inference on data that hasn't been inspected or cleaned. AI produces confident-looking output on bad input — missing values, duplicates, encoding errors, or a dataset that doesn't actually represent the population they're reporting on. |
| BO06 | Unauthorized data use | CR | Accept | The reporter processes data they lack legal or ethical permission to use (scraped content under restrictive ToS, licensed datasets, third-party records with privacy constraints). |

---

## Phase 2 — Task Configuration
*Writing prompts and configuring the run*

| ID | Bad Outcome | Tags | Mitigation | Description |
| --- | --- | --- | --- | --- |
| BO07 | Poor prompt writing | JH OW | Educate, Reduce | The reporter writes vague, ambiguous, or underspecified prompts. Output is inconsistent across rows, instructions are misread, edge cases are handled unpredictably. The reporter doesn't know what "reliable" looks like so they can't tell the output is broken. |
| BO08 | Biased prompt framing | JH | Educate | The reporter's prompt inadvertently steers the AI toward a predetermined answer — leading language, confirmation framing, or hypotheses baked into the question. The AI obliges. The methodology looks systematic but is doing something closer to narrative laundering. |
| BO09 | Prompt overfitting | JH | Educate, Reduce | The reporter iterates their prompt against a small set of hand-checked rows until it looks right, then runs it on the full dataset without verifying generalization. The prompt performs well on the cases it was tuned against and silently fails on everything else. |
| BO18 | Unspecified output format | JH OW | Prevent, Reduce, Educate | The reporter doesn't constrain the output shape in their prompt. They get free-form paragraphs when they needed a categorical value, a number, or a yes/no. The run can't be aggregated, filtered, or compared downstream — making it analytically useless even if the underlying reasoning was sound. |

---

## Phase 3 — Execution
*Running the batch and watching it go*

| ID | Bad Outcome | Tags | Mitigation | Description |
| --- | --- | --- | --- | --- |
| BO17 | Lack of inference budget awareness | OW CR | Prevent | The reporter doesn't realize that each row is a paid API call. They iterate prompts on large datasets, re-run batches while debugging, or run the full dataset before sampling to validate — burning through budget without a cost estimate or confirmation step. Compounds with BO09 (prompt overfitting), where many full runs happen during iteration. |
| BO10 | Non-determinism not understood | JH | Educate | The reporter doesn't realize the same prompt on the same data can produce different results across runs. They treat a single pass as definitive, don't run a reproducibility check, and can't explain to an editor why the numbers shifted when they re-ran it. |
| BO11 | Scale behavior differences | JH | Educate, Reduce | The reporter tests on 10 rows, runs on 10,000. They don't verify behavior holds at scale or spot-check a representative sample of the full run. Systematic errors on edge cases (rare formats, unusual values) are invisible until after publication. |

---

## Phase 4 — Evaluation & Validation
*Reviewing what came back*

| ID | Bad Outcome | Tags | Mitigation | Description |
| --- | --- | --- | --- | --- |
| BO12 | Insufficient validation strategy | JH | Educate, Reduce | The reporter doesn't validate output in a way appropriate for their specific use case. This includes too-small or non-random spot-checks, but also failing to ground AI-extracted output against source material (e.g., cross-checking inference results against OCR'd text). They've done *a* review but not the right one. (See BO13 for hallucination-specific failures; BO14 for error-rate blindness.) |
| BO13 | Hallucination acceptance | JH | Educate, Accept | The reporter treats AI output as authoritative fact rather than probabilistic inference. Fabricated names, dates, citations, or characterizations pass through unchallenged because they look plausible. |
| BO14 | Lack of false positive/negative awareness | JH | Educate, Reduce | The reporter validates that some outputs look right but doesn't characterize the error rate. They can't tell editors how reliable the findings are, can't size their verification burden, and don't know if a 15% false positive rate would change their conclusions. |

---

## Phase 5 — Use & Documentation
*What happens after the run*

| ID | Bad Outcome | Tags | Mitigation | Description |
| --- | --- | --- | --- | --- |
| BO15 | No methodology documentation | JH | Reduce | The reporter can't explain or reproduce their AI-assisted analysis. They have no record of what prompt was used, what model, what settings, on what data version. They can't respond to questions from editors, fact-checkers, or subjects of the story. |
| BO16 | AI-generated prose passed without sufficient review | JH | Educate, Reduce, Accept | The reporter uses AI-drafted summaries or language directly in reporting without adequate review. Hallucinated characterizations, invented quotes, or framing artifacts from the model enter copy. |

---

## Notes

- **BO12 vs. BO13/BO14**: BO12 is about *approach and coverage* in validation; BO13 is about *trusting factual claims*; BO14 is about *not quantifying error rates*. They're related but distinct failure modes.
- **Phase 0 BOs** (BO01–BO03) are the hardest to address through UI affordances alone — they require education, examples, and possibly guided onboarding flows.
- **Phase 2–4 BOs** (BO07–BO14) are the most addressable through in-product interventions: prompt guidance, sample-review steps, validation prompts, confidence displays.
- Risk prioritization (likelihood × severity) is deferred to a separate threat assessment.
- User stories are a natural next layer — each BO can generate one or more stories that specify *who does what, under what misapprehension, and what goes wrong as a result*.
