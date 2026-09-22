# Deploying as an Editor Add-on — Design

## Purpose

New doc: `docs/deploying-as-an-editor-add-on.md`. Row 4 of the [documentation
restructure tracker](../../plans/2026-09-21-docs-restructure-tracker.md)
(Linear [AI-118](https://linear.app/propublica/issue/AI-118)). A distributor
guide for an org admin who wants to roll out the SSI Toolkit org-wide as a
Google Workspace Editor add-on, without altering any code.

## Audience

An org/IT admin: technical enough to use a terminal and the GCP console, but
not necessarily a developer of this codebase, and with no assumed interest in
contributing code back.

## Scope decisions from brainstorming

- **Self-contained, not dependent on CONTRIBUTING.md.** This audience has no
  interest in contributing code and won't have read CONTRIBUTING.md's future
  "Local Setup" section (row 5, AI-119). The doc repeats the minimum needed
  rather than assuming that context.
- **Minimal.** Lean on linking to Google's own docs for GCP/Apps Script
  mechanics wherever they already exist; only write out the parts that are
  specific to this toolkit.
- **Dropped from scope: "what to tell your users" section.** Present in the
  original starting hypothesis, but decided during brainstorming to leave out
  for now — setup instructions are the priority. Row 3 (`user-guide.md`,
  AI-117) will still add a one-line pointer to this doc's filename, but
  should not assume this doc has a section matching its own "Installing the
  add-on" content.
- **Out of scope: a simplified release script for distributors.** Already
  called out in the tracker and the issue as a future follow-up — this doc
  documents the manual steps and notes the script as a TODO, not something to
  build here.
- **Dropped: a separate Drive Advanced Service enablement step.**
  `enabledAdvancedServices` is declared in `appsscript.json` and is carried
  over by `clasp push`, so no manual toggle in the Apps Script editor UI is
  needed as a distinct step.
- **Added: linking a standard GCP project.** A script's default,
  Google-managed GCP project cannot back a Marketplace SDK listing — the
  reader must switch their Apps Script project to a standard, user-owned GCP
  project first. Link to Google's own docs for the mechanics rather than
  re-explaining them.
- **Added: Gemini API key setup**, mirroring README's existing "Set your
  Gemini API key" step (Script Properties → `GEMINI_API_KEY`).

## Outline (final)

1. **What this is** — one paragraph contrasting an Editor add-on (installed
   once by an admin, available org-wide) with the container-bound copy
   covered elsewhere in the docs. Links to Google's own Editor add-on
   concepts doc instead of re-explaining Apps Script distribution models.
2. **Set up your project**
   a. Create the Apps Script project as an Editor add-on (link to Google's
      docs for the mechanics).
   b. Switch it to your own standard GCP project and link it — required for
      Marketplace distribution (link to Google's docs).
   c. Set your Gemini API key via Script Properties (one-liner, mirrors
      README's existing step).
3. **Set up the Marketplace listing** — link to Google's Marketplace SDK
   docs for the mechanics; note the listing can be private/unlisted
   (domain-only) rather than public; flag the marketplace-listing asset
   packet (icons, screenshots, etc.) as TK/placeholder — don't block on it.
4. **Deploy your code** — the manual clasp steps to push `main` to their own
   project: clone the repo, `npm install`, create `.clasp.json` with their
   own script ID, `clasp login`, `clasp push`, `clasp create-version`,
   `clasp update-deployment`. Note that a simplified release script is a
   future follow-up, explicitly out of scope for this doc.
5. **The gotcha** — repointing the deployment via `clasp update-deployment`
   does not make the new version live for Marketplace-installed users; the
   admin must also update their own Marketplace SDK App Configuration's
   "Sheets add-on script version" by hand and click Save. Same shape as
   `docs/releasing.md`'s gotcha, but written fresh for the distributor's own
   project — not copied, since the specifics (deployment ID, our template
   Sheet, our exact commands) don't transfer.

## Relationship to sibling docs

- **`docs/user-guide.md`** (row 3, AI-117, not started): will trim
  "Installing the add-on" to one line plus a pointer to this doc's filename.
  No dependency on this doc having a specific matching section.
- **`docs/releasing.md`** (row 2, AI-116, merged): documents ProPublica's own
  release process and the same two-step Marketplace gotcha, but for our
  project specifically (our deployment ID, our template Sheet, our
  `scripts/release.sh`). This doc's gotcha section is independently written
  for the distributor's own project.
- **`CONTRIBUTING.md`** (row 5, AI-119, not started): will get a "Local
  Setup" section for contributor test deployments. Deliberately independent
  of this doc — different audience (contributor vs. admin) and different
  goal (local dev testing vs. org-wide Marketplace distribution).
- **`README.md`** (row 6, AI-120, not started): will link to this doc.

## Open items / placeholders

- The marketplace-listing asset packet (icons, screenshots, etc.) referenced
  in step 3 does not exist yet. The doc flags this as TK and does not block
  on it.

## Out of scope for this issue

- Building a simplified release script for distributors.
- Writing a "what to tell your users" section (deferred).
- Any source code changes — this is a documentation-only effort.
