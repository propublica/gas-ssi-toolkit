# External Installer OAuth Block — Empirical Test Findings

## Background

External users installing the SSI Toolkit via the self-serve template-Sheet
channel (`File → Make a copy` on the public template, added in AI-112) hit
Google's unbypassable "This app is blocked" consent screen. Internal
(Workspace Marketplace) installers are unaffected. The current manifest
(`appsscript.json`) requests:

```
spreadsheets, drive.readonly, drive.file, documents,
script.external_request, script.container.ui
```

The working theory going in: `drive.readonly` is a *restricted* OAuth
scope, and restricted scopes on an unverified app produce the hard,
non-bypassable block, while `spreadsheets`/`documents` (*sensitive*, not
restricted) would only ever produce the softer "Google hasn't verified
this app" warning with an `Advanced → Go to app (unsafe)` bypass, and
`script.external_request`/`script.container.ui` were assumed non-sensitive
and not a factor at all. Empirical testing this session confirmed one part
of that theory, reproduced neither of two other parts, and overturned the
assumption about the two `script.*` scopes entirely. Net result: this was
never primarily a Drive-scope problem.

Test artifacts (manifest variants + two minimal isolated-capability
projects) are in this session's scratch directory under
`scope-test-variants/` and `minimal-scope-experiment/`.

## Test method

**Attempt 1 — direct share (invalidated).** Aaron created a fresh Sheet,
deployed a scope variant, and shared it directly (Editor) with an external
tester's personal Gmail. This does not reproduce the reported bug's
mechanism: the bound script and its GCP project remain owned by the
developer, not the installer, so it doesn't replicate the "independent,
unowned, unconfigured project per installer" situation the real bug
depends on.

**Attempt 2 — corrected flow.** Aaron shared the test Sheet as **Viewer**
only; the external tester performed their own `File → Make a copy`,
producing an independent script bound to their own auto-created GCP
project, then authorized from that copy. Confirmed structurally correct:
the resulting consent screen listed the *tester's own account* as "the
developer," proving the copy is genuinely independent (matches the
"Independence of template copies" fact already established in the threat
model).

**Attempt 3 — minimal isolated-capability experiment.** To find the actual
line between "no warning" and "soft warning," two throwaway projects (not
the SSI Toolkit codebase) were built from scratch with no `oauthScopes`
declared at all (pure scope auto-detection), then progressively given one
new capability at a time — a menu + alert, then a cell write, then an
isolated sidebar call, then an isolated network call — each tested through
the same corrected share → copy → authorize flow.

## Results

### SSI Toolkit scope-isolation matrix

| Variant | Scopes added beyond baseline | Method | Result |
|---|---|---|---|
| a | *(baseline: spreadsheets, documents, external_request, container.ui)* | direct share | Soft warning |
| b | + `drive.file` | direct share | Soft warning |
| c | + `drive.metadata.readonly` (no `drive.readonly`) | direct share | Soft warning |
| d | + `drive.readonly` (= current prod manifest) | direct share | Soft warning |
| e | non-sensitive only (`external_request` + `container.ui`, no business scopes at all) | direct share | Soft warning |
| e | (same) | **corrected flow** | Soft warning (confirmed independent copy) |
| d | + `drive.readonly` (= current prod manifest) | **corrected flow** | **Soft warning — did not reproduce the hard block** |
| — | manifest with no `dependencies`/`enabledAdvancedServices` block | direct share | Soft warning |

### Minimal isolated-capability experiment

No manifest in this set declared `oauthScopes` explicitly — all scopes
below were auto-detected by Apps Script from what the code actually calls.

| Project | Code capability | Auto-detected scope | Result |
|---|---|---|---|
| 1 (baseline) | `SpreadsheetApp.getUi()` menu + `.alert()` only — no data access, no Drive, no network, no sidebar | none needed | **No warning** |
| 2 | + one line: `getRange('A1').setValue(...)` | `spreadsheets` | Soft warning |
| 3 | `HtmlService` sidebar only, isolated (no data write, no network call) | `script.container.ui` | Soft warning |
| 4 | `UrlFetchApp.fetch(...)` only, isolated (no data write, no sidebar) | `script.external_request` | Soft warning |

## Key findings

**1. The soft warning is scope-gated — but the original scope
classification for two "non-sensitive" scopes was wrong.** The minimal
experiment's project 1 (genuinely zero custom scope) showed no warning at
all, so scope selection does matter, in line with the original theory. But
`script.container.ui` and `script.external_request` — assumed
"non-sensitive; not a factor" in the original investigation — each
*independently* triggered the same soft warning as `spreadsheets` did.
That assumption was simply incorrect. This also resolves the SSI Toolkit
matrix's own most confusing result: variant e (zero Drive/Sheets/Docs
scopes, only `container.ui` + `external_request`) warned because those two
scopes are themselves sufficient causes, not because of some
scope-independent verification gate.

**2. This was never primarily a Drive-scope problem.** `container.ui` is
what the sidebar needs (navigation for every tool), and `external_request`
is what every Gemini API call needs — neither is optional in any version
of this toolkit that still does anything useful. Since each is
independently sufficient to trigger the soft warning, **no amount of
Drive/Sheets/Docs scope reduction (the entire premise of Path C) can ever
produce a clean install screen.** Even a hypothetical toolkit with zero
Drive-content functionality at all would still warn, purely from having a
sidebar and calling an external API. Path C, evaluated purely as a
soft-warning fix, does not work — its only remaining potential value is
against the separate *hard* block (see finding 4, which is unconfirmed).

**3. The manifest is authoritative for what's requested — confirmed at
runtime, not just assumed.** With `script.container.ui` removed from the
SSI Toolkit's manifest but the code unchanged, calling `Ui.showSidebar()`
threw a clean runtime error: `"Specified permissions are not sufficient to
call Ui.showSidebar. Required permissions:
https://www.googleapis.com/auth/script.container.ui"`. No silent success,
no surprise re-consent prompt. Apps Script enforces exactly the declared
`oauthScopes` with no code-based auto-expansion once a manifest explicitly
declares scopes, so every scope-variant test in this investigation is valid
evidence for what the authorization screen shows.

**4. The hard block was never reproduced this session — including with
the exact production scope set, via a genuinely independent copy.** This
remains the biggest open gap. Variant d, tested the corrected way, should
have been a clean positive control (it matches what's live in production
and is the scope combination actually reported to cause the block for real
users) — and it came back soft. That means either:
   - something about how the test Sheet was shared still differs from the
     real channel — most likely candidate: every test here used a **named,
     email-invited** share (even for the "viewer, then they copy" flow),
     while the real template is presumably shared via **"anyone with the
     link"** — worth confirming the real template's actual sharing setting
     and retesting with a tester who reaches it via the raw link, never
     personally invited; or
   - Google's enforcement isn't a clean deterministic function of
     (scope + verification status) alone and also weighs the authorizing
     account's own risk signals — in which case a hard block may not be
     reliably reproducible on demand with any account under our control,
     even a fresh one.

Neither has been tested yet.

**5. Verification (of either weight) does not compose with the current
distribution model.** OAuth verification is a property of one specific
OAuth client (GCP project), owned by whoever submits it — and every
`File → Make a copy` installer mints their *own* independent, auto-created
GCP project that the toolkit's maintainers don't own and can't verify on
the installer's behalf. Verifying the template's own project has zero
effect on any copy's project. Practically:
   - **Full verification + annual CASA** (keep `drive.readonly`) only pays
     off if paired with moving distribution off the copy model onto a
     single, centrally-owned deployment (e.g. a Marketplace listing) —
     which is what the original Path B already specified.
   - A **lighter "brand verification only" tier** (Google's docs confirm
     CASA is required specifically for restricted scopes, not sensitive
     ones) becomes available *if* `drive.readonly` is dropped — but per
     finding 1, `container.ui`/`external_request` are themselves scopes the
     verification process needs to cover regardless, and this route still
     requires the same centralization as full Path B. It cannot be bolted
     onto the self-serve copy channel as-is.
   - If distribution instead becomes "a code package a developer deploys
     into their own org's Workspace," a Workspace-domain installer can set
     their own copy's OAuth consent screen **User Type to "Internal"** —
     which is entirely exempt from the warning, for free, with no Google
     review at all. This doesn't help an installer on a personal Gmail
     account (Internal audience isn't available to them), so it only
     solves the problem for the subset of installers who belong to an
     actual Workspace org.

## Combined conclusion

Given findings 1–2 and 5 together: **as long as distribution stays the
self-serve "make a copy" model, there is no fix for the soft warning at
all** — not through any manifest change (every capability the toolkit
needs independently triggers it), and not through verification (which
cannot attach to a copy the toolkit's maintainers don't own). The only
things that change this:
- moving to a single, centrally-owned deployment and completing
  verification there (Path B, in either weight), or
- moving to a self-deploy code package and documenting the free
  "Internal" audience fix for Workspace-domain installers specifically
  (helps that subset only), or
- accepting the warning as permanent for the self-serve channel and
  documenting the per-user manual fix (Path A).

Path C, as originally scoped (Drive-scope reduction), does not solve the
soft warning under any distribution model and only remains potentially
relevant to the still-unconfirmed hard block.

## Open items

1. Confirm the real public template Sheet's actual sharing configuration
   (link-based vs. named) and retest the production scope set (variant d)
   against a tester who was never personally invited — the one remaining
   way to actually reproduce the hard block and validate whether Path
   C-style scope cuts would even help it.
2. If the hard block still won't reproduce, investigate whether
   account-level risk signals (not just scope + verification status) are
   in play — this would put a ceiling on how confidently any fix can be
   validated pre-launch.
3. `drive.metadata.readonly` was never runtime-tested — only its effect on
   the consent screen was confirmed (soft warning, same as everything
   else). Whether `getAllFilesRecursive` actually works against that
   narrower scope at the API level is still an open code-level question,
   and now a lower-priority one given finding 2.
4. The untested raw-REST `text/plain` export idea (replacing
   `DocumentApp.openById().getBody().getText()` to drop the `documents`
   scope) was not explored this session, and is similarly lower-priority
   now.
5. Whether `script.container.ui`/`script.external_request` classify as
   "sensitive" (requiring a scope-justification writeup during
   verification) or some other tier was not confirmed — matters for sizing
   the brand-verification checklist if Path B (light) is ever pursued.
