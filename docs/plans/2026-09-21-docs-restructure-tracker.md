# Documentation Restructure — Tracker

Tracks progress on reorganizing the repo's audience-facing documentation
around a priority order of **container-bound script installers** →
**editor add-on installers/distributors** → **SSI Toolkit developers**.
Installation instructions are currently scattered unhelpfully between
README.md and docs/user-guide.md, with no single authoritative source for
either audience.

Rather than one combined effort, each row below gets its own brainstorm →
(spec, for the architectural ones) → implementation → PR. There is no
single overarching spec document — this tracker is the coordination point
across sessions.

**Branching model:** every row's branch is cut from
`AI-102-docs-restructure-tracker`, not from `develop`, and its PR targets
`AI-102-docs-restructure-tracker`, not `develop` — this deviates from
CLAUDE.md's default (feature branch → `develop`), so say so explicitly if
a session's PR step asks. Rows merge into `AI-102-docs-restructure-tracker`
incrementally as they land; that branch merges into `develop` once, at
the end, as a single PR. If you're starting a fresh session for a row,
make sure your local `AI-102-docs-restructure-tracker` is up to date
before branching from it, since earlier rows may have already merged in.

**Out of scope:** `docs/threat_models/`, `docs/superpowers/`,
`docs/plans/`, and `docs/prototypes/` keep their current location and
content unchanged. This effort only adds pointers to them where
appropriate (see rows 1 and 5). Migrating `CLAUDE.md` to `AGENTS.md`
(also named in the parent issue, AI-102) is a separate effort, tracked
independently of this tracker.

The "Starting hypothesis" column below is this session's initial take on
each doc's scope — not settled. Each row gets its own brainstorming
session before any implementation, and that session can revise, expand,
or reshape the scope, including moving content between rows or merging
or splitting rows. Don't treat these descriptions as a ceiling.

| #   | Doc                                           | Type          | Status      | Issue                                                | Spec | Branch                                   | Starting hypothesis                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------- | ------------- | ----------- | ---------------------------------------------------- | ---- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/architecture.md`                        | Bounded       | Implemented | [AI-115](https://linear.app/propublica/issue/AI-115) | —    | `AI-115-architecture-historical-records` | Add a pointer to `docs/plans/` and `docs/superpowers/specs/` as historical design-decision records — an archive, not maintained documentation.                                                                                                                                                                                                                                                                                                       |
| 2   | `docs/releasing.md`                           | Bounded       | Not started | [AI-116](https://linear.app/propublica/issue/AI-116) | —    | —                                        | Add a high-level description of the git tag + GitHub release step (`release.sh` already does this — annotated tag, `gh release create` — but it's undocumented today). Keep the doc a human-readable guide to running the script and what it does, not an internals walkthrough.                                                                                                                                                                     |
| 3   | `docs/user-guide.md`                          | Bounded       | Not started | [AI-117](https://linear.app/propublica/issue/AI-117) | —    | —                                        | Trim "Installing the add-on" down to one line + pointer to row 4's doc. Everything else (tool-by-tool guidance, tips) stays as-is.                                                                                                                                                                                                                                                                                                                   |
| 4   | `docs/deploying-as-an-editor-add-on.md` (new) | Architectural | Not started | [AI-118](https://linear.app/propublica/issue/AI-118) | —    | —                                        | Distributor guide: what an editor add-on is and why, how to create one (mostly linking to Google's own docs + a TK marketplace-listing asset packet), the manual clasp steps to push `main` → your own Apps Script project, the gotcha that a push isn't live until you repoint the Marketplace listing, and a "what to tell your users" section.                                                                                                    |
| 5   | `CONTRIBUTING.md`                             | Architectural | Not started | [AI-119](https://linear.app/propublica/issue/AI-119) | —    | —                                        | New "Local Setup" section up top, ported from README's current deployment steps (prerequisites, create your own Apps Script project, `.clasp.json`, `npm install`, deploy). Plus a one-line pointer to `docs/threat_models/`, which CLAUDE.md already requires checking before a PR but nothing currently surfaces to a contributor.                                                                                                                 |
| 6   | `README.md`                                   | Architectural | Not started | [AI-120](https://linear.app/propublica/issue/AI-120) | —    | —                                        | Landing-page rewrite: pitch (decomposition-for-investigations framing), evidence section (examples/screenshots — **blocked on Aaron supplying content**), "Get started" pointing at the CBS template rather than raw steps, a pointer to row 4's doc, and a links-out section. Drops "Deployment (for contributors)" and "Development" entirely — that content moves to row 5.                                                                       |
| 7   | `docs/permissions.md` (new, tentative)        | Architectural | Not started | [AI-121](https://linear.app/propublica/issue/AI-121) | —    | —                                        | Explain why each OAuth scope in `appsscript.json` is requested (`spreadsheets`, `drive.readonly`, `drive.file`, `documents`, `script.external_request`, `script.container.ui`) — surfaced from AI-102's "why permissions are requested" ask, not part of the original four-bucket brainstorm. Placement is genuinely open: a new file, folded into README's "unverified app" section, or into CONTRIBUTING.md near the threat-model pointer (row 5). |

**Status values:** not started → brainstorming → spec approved (architectural rows only) → implemented → merged

## Sequencing notes

- Row 6 (README) should land after rows 4 and 5 exist, so its links point
  somewhere real, and is blocked independently on Aaron supplying
  evidence content (example reporting questions, screenshots).
- Row 3 (user-guide.md) references row 4's filename and should land at or
  after row 4, to avoid a dead link.
- Rows 1, 2, and 7 are fully independent and can happen in any order.
- A simplified release script for editor-add-on distributors (referenced
  conceptually in row 4) is explicitly out of scope for this effort. Row
  4 documents the manual clasp steps and notes the script as a future
  follow-up.
