# Template Sheet Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone get a working personal copy of the SSI Toolkit without installing Node/clasp or creating an Apps Script project by hand, by copying a pre-built, container-bound template Google Sheet.

**Architecture:** A second, separate container-bound Apps Script project (bound to a public-facing template Google Sheet, owned by Aaron's ProPublica account) receives the same compiled `dist/` bundle as the canonical project. `scripts/release.sh` gains one step that pushes to this second script ID right after its existing HEAD deploy. The template Sheet itself is shared as Restricted (never "Anyone with link," per org policy); people request access via Google's native "Request access" prompt, which Aaron approves individually, then `File → Make a copy` gives them a fully independent copy with their own script properties and API key.

**Tech Stack:** Bash (`scripts/release.sh`), `@google/clasp`, Google Sheets/Apps Script (manual setup — no Apps Script API automation), Markdown docs.

**Spec:** `docs/superpowers/specs/2026-09-09-template-sheet-onboarding-design.md`

## Global Constraints

- Sharing on the template Sheet must be **Restricted** — never "Anyone with link" (org Workspace policy forbids public sharing; see spec Non-goals).
- `scripts/release.sh` remains **human-only**: these tasks edit it, but nobody (including Claude) runs it as part of this plan. Verification of the new step is manual/syntax-only.
- No first-run API-key wizard, no Marketplace changes, no version-visibility work — all explicitly out of scope per the spec.
- Each copy made via `File → Make a copy` must be fully independent (own script properties, own `GEMINI_API_KEY`) — nothing in this plan introduces shared state between copies.

---

### Task 1: Stand up the template Apps Script project (manual, human-only)

**Files:** None — this task happens entirely in the Google Sheets/Apps Script UI and Drive sharing settings. No repo files change.

**Interfaces:**
- Produces: `TEMPLATE_SCRIPT_ID` (the new project's Script ID) and `TEMPLATE_SHEET_URL` (the Sheet's share link) — both required as inputs to Task 2 and Tasks 3–4 respectively. Record them somewhere (e.g. a password manager note or a scratch file outside the repo) before moving on.

- [ ] **Step 1: Create the Sheet and bind the script**

In your ProPublica Google account: create a new Google Sheet (suggested title: "SSI Toolkit — Template"). Open **Extensions → Apps Script** to create its bound Apps Script project.

- [ ] **Step 2: Enable the Drive Advanced Service**

In the script editor: **Editor** → **Services** → find **Drive API** → select **V3** → **Add**. (Mirrors README's existing step 2 for the developer path — every Apps Script project needs this enabled independently; it is not something that can be inherited from another project.)

- [ ] **Step 3: Copy the Script ID**

In the script editor: **Project Settings** → copy the **Script ID**. This is `TEMPLATE_SCRIPT_ID` — record it now.

- [ ] **Step 4: Set sharing to Restricted**

On the Sheet itself: **Share** → confirm general access is **Restricted** (this is the default — the point of this step is to explicitly confirm it, not change it). Copy the share link. This is `TEMPLATE_SHEET_URL` — record it now.

- [ ] **Step 5: Smoke-test the deploy pipeline**

From the repo root, on your machine (not via `release.sh` — this is a one-time manual proof that the config shape works, done before Task 2 wires it into the release script):

```zsh
npm run build
cp .clasp.json .clasp.json.bak
cat > .clasp.json << EOF
{
  "scriptId": "TEMPLATE_SCRIPT_ID",
  "rootDir": "./dist"
}
EOF
clasp push
mv .clasp.json.bak .clasp.json
```

(Replace `TEMPLATE_SCRIPT_ID` with the real value from Step 3.) Open the template Sheet and confirm the **📐 SSI Toolkit** menu appears. Then, in the script editor, check **Editor → Services** and confirm **Drive API** is still listed (this empirically settles an open question from the design spec — whether `appsscript.json`'s advanced-service declaration survives a `clasp push` the same way it does for the canonical project; it should, since the declaration lives in the pushed manifest itself, but this step is the actual proof rather than an assumption). Finally, confirm your original `.clasp.json` was restored (`cat .clasp.json` should show the canonical project's script ID, not the template's).

**Do not set a real `GEMINI_API_KEY` on the template project's Script Properties at any point** — not now, not later for your own testing. The README and the Start Here tab (Step 6 below) both promise every copy gets "its own API key," which depends on `File → Make a copy` producing an empty Script Properties store on the copy. That's a GAS runtime behavior, not something this plan verifies elsewhere — if you set a real key on the template to make your own testing more convenient and the assumption turns out to be wrong, every copier would receive your live billing key. If you need to test the AI features against a live key, do it from your own personal copy (made via the same `File → Make a copy` flow everyone else uses), never on the template itself.

- [ ] **Step 6: Verify copy independence from a non-owner account**

Before sharing the link with anyone: have a second Google account (one without owner/editor access to the template) go through the actual flow — open the share link, use **Request access** if prompted, get approved, then **File → Make a copy**. On the resulting copy, confirm: the **📐 SSI Toolkit** menu appears (the bound script came along with the copy), and **Project Settings → Script Properties** is empty (no inherited `GEMINI_API_KEY` — this is the actual proof behind the "its own API key" claim in the README and Start Here tab, not an assumption). If you don't have a second Google account handy, ask a colleague to be the test copier instead of skipping this step.

- [ ] **Step 7: Add the "Start Here" tab**

In the template Sheet, rename (or add) the first tab to **Start Here**, and enter the following in column A, one row per line (leave row 2, 4, 6, 8, 14, 16 blank as spacers; bold rows 1, 5, 7, 9, 15 using Sheets' normal text formatting):

```
Row 1:  SSI Toolkit — Start Here
Row 3:  This is your own private copy of the SSI Toolkit. Nothing you do here affects anyone else's copy.
Row 5:  1. Set your Gemini API key
Row 6:  Open Extensions → Apps Script → Project Settings → Script Properties. Add a property named GEMINI_API_KEY with your key. Get a free key at aistudio.google.com/api-keys — and set a monthly spend cap at aistudio.google.com/spend to avoid surprise billing.
Row 7:  2. Open the toolkit
Row 8:  Use the 📐 SSI Toolkit menu at the top of this sheet to open the sidebar.
Row 9:  What each tool does:
Row 10: 📂 Import Drive Links — lists every file in a Drive folder (and its subfolders) as rows.
Row 11: 📄 Extract Text — pulls text out of Docs, PDFs, and images (with OCR) into a column.
Row 12: 🎲 Sample Rows — pulls a reproducible random sample of rows for spot-checking.
Row 13: ▶️ Run AI Inference — runs a Gemini prompt across selected rows, in bulk.
Row 15: Need access for a colleague?
Row 16: Have them open this same Sheet's link and click "Request access" — we'll approve it and follow up. Don't forward them your own copy; they need their own so their API key and data stay separate from yours.
```

- [ ] **Step 8: Record both values for later tasks**

Confirm you have `TEMPLATE_SCRIPT_ID` (from Step 3) and `TEMPLATE_SHEET_URL` (from Step 4) recorded. Task 2 needs the former; Tasks 3 and 4 need the latter.

No commit for this task — nothing in the repo changed.

---

### Task 2: Wire `release.sh` to deploy to the template project

**Files:**
- Modify: `.gitignore:49-50`
- Modify: `scripts/release.sh:53-55`
- Modify: `docs/releasing.md:5-11`

**Interfaces:**
- Consumes: `TEMPLATE_SCRIPT_ID` from Task 1, Step 3.
- Produces: a `.clasp.template.json` file shape (documented in `docs/releasing.md`) that any future maintainer running `release.sh` must create locally.

- [ ] **Step 1: Add the new local config files to `.gitignore`**

Current end of `.gitignore`:

```
# Clasp project file (contains project ID and rootDir)
.clasp.json
```

Replace with:

```
# Clasp project file (contains project ID and rootDir)
.clasp.json

# Clasp project file for the public template Sheet (second push target in
# release.sh) and its backup during the swap — see docs/releasing.md
.clasp.template.json
.clasp.json.bak
```

- [ ] **Step 2: Create your own local `.clasp.template.json`**

At the repo root (this file is gitignored — it will not be committed):

```zsh
cat > .clasp.template.json << 'EOF'
{
  "scriptId": "TEMPLATE_SCRIPT_ID",
  "rootDir": "./dist"
}
EOF
```

Replace `TEMPLATE_SCRIPT_ID` with the real value recorded in Task 1.

- [ ] **Step 3: Add the template deploy step to `release.sh`**

Current (`scripts/release.sh:53-56`):

```bash
echo "→ Deploying to HEAD..."
npm run deploy

TIMESTAMP=$(date +%Y-%m-%d\ %H:%M:%S)
```

Replace with:

```bash
echo "→ Deploying to HEAD..."
npm run deploy

# Push the same freshly-built dist/ to the public template Sheet's separate
# Apps Script project. Unlike the canonical project below, this target has no
# versioned-deployment concept to repoint — a container-bound script always
# runs whatever's at HEAD, so a push is the whole job.
#
# clasp reads a single .clasp.json from the current directory, so we swap it
# in and back out around the push. The swap is guarded so a failed push still
# restores your original .clasp.json rather than leaving it pointed at the
# template project (which would make the *next* `npm run deploy` you run
# silently push to the wrong place).
if [ ! -f .clasp.template.json ]; then
  echo "Error: .clasp.template.json not found."
  echo "This holds the template Sheet's script ID and is required to keep it in sync."
  echo "See the 'Template Sheet' section of docs/releasing.md for how to create it."
  exit 1
fi

echo "→ Deploying to template container-bound project..."
cp .clasp.json .clasp.json.bak
cp .clasp.template.json .clasp.json
if ! npx clasp push; then
  mv .clasp.json.bak .clasp.json
  echo "Error: template deploy failed; restored your original .clasp.json."
  exit 1
fi
mv .clasp.json.bak .clasp.json

TIMESTAMP=$(date +%Y-%m-%d\ %H:%M:%S)
```

- [ ] **Step 4: Verify the script's syntax**

Run: `bash -n scripts/release.sh`
Expected: no output, exit code 0 (this only parses the script — it does not run any of it, consistent with `release.sh` staying human-only).

- [ ] **Step 5: Update `docs/releasing.md`**

Current (`docs/releasing.md:5-11`):

```markdown
## Deployment States

The SSI Toolkit uses a single Apps Script project with two deployment states:

**HEAD** is the active development surface. `npm run deploy` pushes your local build here. You can test HEAD changes using Apps Script's test deployments (Deploy → Test deployments in the script editor) without affecting users who have the add-on installed. 

**Versioned deployment** is what Marketplace-installed users run. It is a pinned snapshot that only changes when a human explicitly runs `scripts/release.sh` from `main`.

Container-bound Scripts use the **HEAD** by default. Once you've run `npm run deploy`—regardless of what branch you are in—you should see any changes immediately reflected in your attached Google Sheet.
```

Replace with:

```markdown
## Deployment States

The SSI Toolkit's canonical Apps Script project has two deployment states:

**HEAD** is the active development surface. `npm run deploy` pushes your local build here. You can test HEAD changes using Apps Script's test deployments (Deploy → Test deployments in the script editor) without affecting users who have the add-on installed. 

**Versioned deployment** is what Marketplace-installed users run. It is a pinned snapshot that only changes when a human explicitly runs `scripts/release.sh` from `main`.

Container-bound Scripts use the **HEAD** by default. Once you've run `npm run deploy`—regardless of what branch you are in—you should see any changes immediately reflected in your attached Google Sheet.

## Template Sheet

In addition to the canonical project above, `release.sh` also pushes `dist/` to a second, separate Apps Script project — the one bound to the public-facing template Google Sheet used for [self-serve onboarding](../README.md#get-your-own-copy). Unlike the canonical project, this target has no versioned-deployment step: it's a container-bound script, so it always runs whatever was last pushed to HEAD.

This requires a local `.clasp.template.json` (gitignored, same shape as `.clasp.json`) pointing at the template project's script ID:

```zsh
cat > .clasp.template.json << 'EOF'
{
  "scriptId": "<template-script-id>",
  "rootDir": "./dist"
}
EOF
```

Only whoever runs `release.sh` needs this file locally — `release.sh` fails fast with a clear error if it's missing, rather than silently skipping the template deploy.
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore scripts/release.sh docs/releasing.md
git commit -m "$(cat <<'EOF'
Deploy to the template project as part of release.sh

Adds a second clasp push target so the public template Sheet used for
self-serve onboarding stays in sync with every release, on the same
human-gated cadence as everything else. Container-bound scripts always
run HEAD, so no versioned-deployment repoint is needed for this target.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: README — "Get your own copy" section

**Files:**
- Modify: `README.md:1-21`

**Interfaces:**
- Consumes: `TEMPLATE_SHEET_URL` from Task 1, Step 4.

- [ ] **Step 1: Restructure the README's opening**

Current (`README.md:1-21`):

```markdown
# SSI Toolkit

A Google Sheets add-on for AI-assisted investigations.

Built with TypeScript, bundled by Rollup, and deployed via clasp.

> **Note:** Avoid making changes in the online Apps Script editor — they will be overwritten on the next deploy.

## Prerequisites

- A Google account
- Node.js 22+
- Apps Script API enabled at [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
- [A Gemini API key](https://ai.google.dev/gemini-api/docs/api-key)
  - Tip: [AI Studio](https://aistudio.google.com/api-keys) makes it easy to mint a key and [set a monthly spend cap](https://aistudio.google.com/spend) to avoid surprise billing

`@google/clasp` is included as a devDependency — no global install needed.

## Deployment

If you're looking for an SSI Toolkit usage guide, check out our [user onboarding documentation](./docs/user-guide.md).

### 1. Create an Apps Script project
```

Replace with (substitute the real link for `TEMPLATE_SHEET_URL`):

```markdown
# SSI Toolkit

A Google Sheets add-on for AI-assisted investigations.

Built with TypeScript, bundled by Rollup, and deployed via clasp.

> **Note:** Avoid making changes in the online Apps Script editor — they will be overwritten on the next deploy.

If you're looking for an SSI Toolkit usage guide, check out our [user onboarding documentation](./docs/user-guide.md).

## Get your own copy

Want to try the toolkit without installing Node, clasp, or anything else? We maintain a template Google Sheet with the toolkit already set up as a container-bound script.

1. Open the template Sheet: TEMPLATE_SHEET_URL
2. Our Workspace doesn't allow public sharing, so you'll likely see a **Request access** prompt — click it. We approve individual requests as they come in.
3. Once you have access, go to **File → Make a copy** to get your own independent copy — its own script, its own data, its own API key.
4. In your copy, open **Extensions → Apps Script → Project Settings → Script Properties** and add a `GEMINI_API_KEY` — see [Prerequisites](#prerequisites) below for how to get one.
5. Open the **📐 SSI Toolkit** menu in your copy to get started, or check the **Start Here** tab in the template for a walkthrough of each tool.

If you want to build, modify, or contribute to the toolkit itself, keep reading — the rest of this README covers the developer setup.

## Deployment (for contributors)

### Prerequisites

- A Google account
- Node.js 22+
- Apps Script API enabled at [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
- [A Gemini API key](https://ai.google.dev/gemini-api/docs/api-key)
  - Tip: [AI Studio](https://aistudio.google.com/api-keys) makes it easy to mint a key and [set a monthly spend cap](https://aistudio.google.com/spend) to avoid surprise billing

`@google/clasp` is included as a devDependency — no global install needed.

### 1. Create an Apps Script project
```

(Everything from `### 2. Enable the Drive Advanced Service` onward — `README.md:29` through the end of the file — is unchanged; it was already at `###` level under the old `## Deployment` heading, so it now nests correctly under the renamed `## Deployment (for contributors)` heading with no further edits needed.)

- [ ] **Step 2: Verify the anchor link resolves**

Run: `grep -n "^### Prerequisites" README.md`
Expected: one match — confirms the `[Prerequisites](#prerequisites)` link in the new section has a real heading to point to (GitHub's anchor generation is based on heading text, not level, so the `###` demotion doesn't break it).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Add a no-install onboarding path to the README

Leads with the template-Sheet copy flow for people who just want to
try the toolkit, ahead of the existing clasp/dev setup instructions
(now labeled as the contributor path).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `docs/user-guide.md` — document the template-Sheet path

**Files:**
- Modify: `docs/user-guide.md:7-14`

**Interfaces:**
- Consumes: `TEMPLATE_SHEET_URL` from Task 1, Step 4.

- [ ] **Step 1: Add the template-Sheet path to "Installing the add-on"**

Current (`docs/user-guide.md:7-14`):

```markdown
## Installing the add-on

The following steps only apply if your organization distributes SSI Toolkit as a **Google Workspace Editor add-on** (installed once, available across every Sheet you open). If you're working with a **container-bound** copy of the toolkit (attached directly to one specific Sheet), the menu referenced below should appear automatically.

1. Open your organization's Marketplace listing for the add-on: `<Marketplace URL — ask your admin>`
2. Click **Install**, and grant the requested permissions when prompted.

Open the sidebar using the **📐 Open SSI Toolkit** menu option. If installed as an Editor add-on, the SSI Toolkit will be available as an item under **Extensions**.
```

Replace with (substitute the real link for `TEMPLATE_SHEET_URL`):

```markdown
## Installing the add-on

The following steps only apply if your organization distributes SSI Toolkit as a **Google Workspace Editor add-on** (installed once, available across every Sheet you open). If you're working with a **container-bound** copy of the toolkit (attached directly to one specific Sheet), the menu referenced below should appear automatically.

1. Open your organization's Marketplace listing for the add-on: `<Marketplace URL — ask your admin>`
2. Click **Install**, and grant the requested permissions when prompted.

Open the sidebar using the **📐 Open SSI Toolkit** menu option. If installed as an Editor add-on, the SSI Toolkit will be available as an item under **Extensions**.

### Don't have an org-wide install?

You can get your own personal copy instead — no admin required. Open our [template Sheet](TEMPLATE_SHEET_URL), click **Request access** if prompted (we approve these individually — see the note on the template's Start Here tab), then **File → Make a copy**. See the main [README](../README.md#get-your-own-copy) for the full walkthrough, including setting your own Gemini API key.
```

- [ ] **Step 2: Commit**

```bash
git add docs/user-guide.md
git commit -m "$(cat <<'EOF'
Document the template-Sheet install path in the user guide

Adds a no-admin-required alternative alongside the existing
Marketplace install steps.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Threat model — document the new distribution channel

**Files:**
- Modify: `docs/threat_models/ssi-toolkit-threat-model.md` (multiple locations, listed below)

**Interfaces:** None — documentation only, no code interfaces.

- [ ] **Step 1: Bump the document header**

Current (`ssi-toolkit-threat-model.md:7-8`):

```markdown
| Version | 1.5 |
| Last updated | 2026-08-21 |
```

Replace with:

```markdown
| Version | 1.6 |
| Last updated | 2026-09-09 |
```

- [ ] **Step 2: Add the template project to the CI/CD Pipeline diagram**

Current (`ssi-toolkit-threat-model.md:56-84`), the closing lines of the mermaid block:

```
    SERVER["Apps Script Server (production)"]

    CONTRIB -->|"submits PR"| GH
    GH -->|"triggers"| GHA
    GHA -.->|"lint / typecheck / test only\nnot a semantic security gate"| GH
    GH -->|"pulls code"| DEV
    DEV -->|"reviews & merges"| GH
    DEV -->|"runs deploy"| CLASP
    CLASP -->|"pushes compiled bundle\n(requires project editor access)"| SERVER
```

Replace with:

```
    SERVER["Apps Script Server (production)"]
    SERVER_TEMPLATE["Template Apps Script Server\n(public-facing distribution copy)"]

    CONTRIB -->|"submits PR"| GH
    GH -->|"triggers"| GHA
    GHA -.->|"lint / typecheck / test only\nnot a semantic security gate"| GH
    GH -->|"pulls code"| DEV
    DEV -->|"reviews & merges"| GH
    DEV -->|"runs deploy"| CLASP
    CLASP -->|"pushes compiled bundle\n(requires project editor access)"| SERVER
    CLASP -->|"pushes compiled bundle\n(second target, same release)"| SERVER_TEMPLATE
```

- [ ] **Step 3: Add a Components row**

Current (`ssi-toolkit-threat-model.md:131`), the last row of the Components table:

```markdown
| C11 | clasp | Deployment tool; pushes compiled bundle to the Apps Script project via the Apps Script API |
```

Add immediately after it:

```markdown
| C12 | Template Apps Script Project | Second, separate container-bound Apps Script project bound to the public-facing template Sheet used for self-serve onboarding; receives the same compiled bundle as C2 via a second `clasp` push target in `release.sh` (AI-112) |
```

- [ ] **Step 4: Add a Data Flows row**

Current (`ssi-toolkit-threat-model.md:162`), the last row of the Data Flows table:

```markdown
| F15 | Developer → clasp → Server | Credentialed developer pulls code, builds, and pushes bundle to Apps Script |
```

Add immediately after it:

```markdown
| F16 | Developer → clasp → Template Server | Same release; the identical compiled bundle is also pushed to C12's script ID. No versioned-deployment repoint applies to this target — a container-bound script always runs HEAD |
```

- [ ] **Step 5: Note the widened blast radius on T4 and T7**

Current (`ssi-toolkit-threat-model.md:191`), end of the T4 row:

```
...causes every user to be re-prompted on their next interaction, likely granting broader permissions without scrutiny
```

Append (still inside the same table cell, same sentence flow):

```
. Security review (2026-09-09, AI-112): the same merged-and-deployed malicious code now also reaches C12 (the template project) via F16, since both targets are pushed from the same `release.sh` run — this widens blast radius but does not introduce a new mechanism; R5/R6 already govern both
```

Current (`ssi-toolkit-threat-model.md:194`), end of the T7 row:

```
...an attacker could deploy arbitrary code to the production Apps Script project
```

Append:

```
. Security review (2026-09-09, AI-112): "the production Apps Script project" now means both C2 and C12 — a compromised developer account with clasp deploy access can push to either or both in one `release.sh` run
```

- [ ] **Step 6: Note the review in Review Status**

Current (`ssi-toolkit-threat-model.md:269`):

```markdown
First draft — not yet formally reviewed by the security team. A full OWASP/LLM Top 10 automated security review was conducted on 2026-07-08, surfacing threats T16–T18 and the gap items below (R21–R39).
```

Replace with:

```markdown
First draft — not yet formally reviewed by the security team. A full OWASP/LLM Top 10 automated security review was conducted on 2026-07-08, surfacing threats T16–T18 and the gap items below (R21–R39). Reviewed again 2026-09-09 (AI-112) for the template Sheet distribution channel — added C12/F16 and the T4/T7 blast-radius notes above; no new threat number or open item was needed since existing R5/R6/R9 (branch protection, limited deploy access, 2FA) already govern the second project the same way they govern the first.
```

- [ ] **Step 7: Commit**

```bash
git add docs/threat_models/ssi-toolkit-threat-model.md
git commit -m "$(cat <<'EOF'
Document template-Sheet distribution channel in the threat model

Adds C12/F16 for the second Apps Script project release.sh now
deploys to, and notes the widened blast radius on T4 (malicious PR)
and T7 (developer account compromise) — both already covered by
existing R5/R6/R9 with no new mitigation required.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan checklist (not a task — do after all 5 above)

- [ ] Open a PR from `AI-112-template-sheet-distribution` targeting `develop`, per this repo's PR process (branch name already matches `AI-\d+`, so no confirmation pause is needed there).
- [ ] Manual QA note for the PR body: since Tasks 3–5 are documentation and Task 2 can't be exercised without actually running `release.sh` (human-only), the PR's manual QA section should say so explicitly and note that the real end-to-end verification happens on the next live release.
