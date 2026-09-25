# Deploying as an Editor Add-on Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `docs/deploying-as-an-editor-add-on.md`, a new distributor guide for org admins deploying the SSI Toolkit as a Google Workspace Editor add-on, and record its progress in the docs restructure tracker.

**Architecture:** A single new markdown file with five sections (What this is, Set up your project, Set up the Marketplace listing, Deploy your code, The gotcha), each leaning on links to Google's own documentation for generic Apps Script/GCP/Marketplace mechanics and writing out only the steps specific to this toolkit. No source code changes.

**Tech Stack:** Markdown only. No build, no tests — this is a docs-only change, same as rows 1 and 2 of this tracker.

**Spec:** `docs/superpowers/specs/2026-09-22-deploying-as-editor-add-on-design.md`

## Global Constraints

- Branch off `AI-102-docs-restructure-tracker`, not `develop`; the PR targets `AI-102-docs-restructure-tracker`, not `develop` (per the tracker's branching model and Linear AI-118).
- No source code changes — documentation only.
- Every generic Apps Script/GCP/Marketplace mechanic links to Google's own docs rather than re-explaining it; only SSI-Toolkit-specific steps get full prose (spec's "minimal" scope decision).
- The "what to tell your users" section and a simplified release script for distributors are explicitly out of scope for this doc (spec).

---

## Task 1: Record AI-118's branch and finalized scope in the tracker

**Files:**
- Modify: `docs/plans/2026-09-21-docs-restructure-tracker.md` (row 4 of the table)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: an updated `AI-102-docs-restructure-tracker` branch that this session's feature branch rebases onto, so its history includes the tracker update — matching the precedent already set for rows 1 and 2 (commits `029aa4b` and `15cdc19`, which recorded the branch and the brainstorm outcome directly on the tracker branch before the row's own implementation commit).

- [ ] **Step 1: Switch to the tracker branch and make sure it's current**

```bash
git checkout AI-102-docs-restructure-tracker
git fetch origin AI-102-docs-restructure-tracker:AI-102-docs-restructure-tracker
```

Expected: fast-forwards cleanly, or reports already up to date.

- [ ] **Step 2: Update row 4 of the tracker table**

In `docs/plans/2026-09-21-docs-restructure-tracker.md`, replace this row:

```
| 4   | `docs/deploying-as-an-editor-add-on.md` (new) | Architectural | Not started | [AI-118](https://linear.app/propublica/issue/AI-118) | — | — | Distributor guide: what an editor add-on is and why, how to create one (mostly linking to Google's own docs + a TK marketplace-listing asset packet), the manual clasp steps to push `main` → your own Apps Script project, the gotcha that a push isn't live until you repoint the Marketplace listing, and a "what to tell your users" section. |
```

with:

```
| 4   | `docs/deploying-as-an-editor-add-on.md` (new) | Architectural | Spec approved | [AI-118](https://linear.app/propublica/issue/AI-118) | [design](../superpowers/specs/2026-09-22-deploying-as-editor-add-on-design.md) | `AI-118-deploying-as-editor-add-on` | Scope finalized during this row's brainstorm: dropped the "what to tell your users" section (deferred, not part of this doc for now) and the Drive Advanced Service step (already carried over by `clasp push` via `appsscript.json`'s `enabledAdvancedServices`); added linking the Apps Script project to the distributor's own standard GCP project (required for Marketplace distribution) and setting the Gemini API key. Remaining scope: what an editor add-on is, how to create one, the manual clasp steps to push `main` → your own project, and the two-step "push isn't live until you repoint the Marketplace listing" gotcha. |
```

- [ ] **Step 3: Commit and push directly to the tracker branch**

```bash
git add docs/plans/2026-09-21-docs-restructure-tracker.md
git commit -m "$(cat <<'EOF'
docs: record AI-118 branch and spec outcome in tracker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin AI-102-docs-restructure-tracker
```

Expected: pushes directly, no PR — matching the precedent set by `029aa4b` and `15cdc19` (tracker bookkeeping commits go straight to the tracker branch, not through a feature-branch PR). If `git push` hangs (a known sandbox issue with the local credential helper), stop and hand the push off to the user rather than retrying or force-pushing.

- [ ] **Step 4: Rebase the feature branch onto the updated tracker branch**

```bash
git checkout AI-118-deploying-as-editor-add-on
git rebase AI-102-docs-restructure-tracker
```

Expected: rebases cleanly. The only commit on this branch so far (the spec file) doesn't touch the tracker file, so there is nothing to conflict with.

---

## Task 2: Write docs/deploying-as-an-editor-add-on.md

**Files:**
- Create: `docs/deploying-as-an-editor-add-on.md`

**Interfaces:**
- Consumes: the approved spec (`docs/superpowers/specs/2026-09-22-deploying-as-editor-add-on-design.md`) for section order and scope; the external links below, already verified against developers.google.com search results during planning.
- Produces: the finished doc. Rows 3 and 6 of the tracker (not part of this plan) will later link to this exact filename.

- [ ] **Step 1: Write the file**

Create `docs/deploying-as-an-editor-add-on.md` with this content:

````markdown
# Deploying as an Editor Add-on

This guide is for an org admin distributing the SSI Toolkit org-wide as a Google Workspace **Editor add-on** — installed once, available in every Sheet across the organization — without touching any code.

If you just want your own personal copy instead, see the main [README](../README.md#get-your-own-copy) — it's a much shorter path and none of what follows applies.

## What this is

An Editor add-on is installed once by an admin and appears in every user's **Extensions** menu, across every Sheet in the domain. That's different from a **container-bound** script, which is attached to one specific Sheet — like the [template Sheet](../README.md#get-your-own-copy) this project maintains for individual copies. See Google's [Editor add-ons overview](https://developers.google.com/workspace/add-ons/concepts/types#editor-add-ons) for the concepts; the rest of this doc covers what's specific to distributing *this* toolkit that way.

## Set up your project

### 1. Create an Apps Script project

Go to [script.google.com](https://script.google.com/u/0/home/all) and create a new, standalone project. You don't need to enable the Drive Advanced Service by hand — it's already declared in this repo's `appsscript.json`, and `clasp push` (see [Deploy your code](#deploy-your-code) below) carries that declaration over automatically.

### 2. Link your own Google Cloud project

A script's default, Google-managed Cloud project can't back a Marketplace listing. Switch this project to a **standard**, user-owned GCP project before doing anything else here: **Project Settings → Change project**, in the script editor. Follow Google's [Google Cloud projects](https://developers.google.com/apps-script/guides/cloud-platform-projects) guide for the mechanics. Do this early — Google's own docs warn that switching later can force your users to re-authorize.

### 3. Set your Gemini API key

In the script editor: **Project Settings → Script Properties** → add `GEMINI_API_KEY` with your own key. [AI Studio](https://aistudio.google.com/api-keys) makes it easy to mint one and [set a monthly spend cap](https://aistudio.google.com/spend) to avoid surprise billing.

## Set up the Marketplace listing

Enable the Google Workspace Marketplace SDK on your GCP project and configure your listing — see Google's [Marketplace SDK overview](https://developers.google.com/workspace/marketplace/overview) and [Configure your app](https://developers.google.com/workspace/marketplace/enable-configure-sdk) guides for the mechanics.

You don't need to publish publicly: **private publishing** makes your listing immediately available to everyone in your Google Workspace organization, with no Google review step. See [Publish apps to the Google Workspace Marketplace](https://developers.google.com/workspace/marketplace/how-to-publish) for the public/private distinction.

**TK:** a marketplace-listing asset packet (icon, screenshots, promotional copy) for this toolkit doesn't exist yet. Use your own placeholders for now — this is a known gap, not something to block on.

## Deploy your code

You'll need Node.js 22+ and this repo cloned locally. [`clasp`](https://developers.google.com/apps-script/guides/clasp) is included as a devDependency — no global install needed.

**First-time setup:**

```zsh
git clone https://github.com/propublica/gas-ssi-toolkit.git
cd gas-ssi-toolkit
npm install
```

Create `.clasp.json` at the project root, using the Script ID from your project's **Project Settings** (in the script editor):

```zsh
cat > .clasp.json << 'EOF'
{
  "scriptId": "<your-script-id>",
  "rootDir": "./dist"
}
EOF
```

Then authenticate and push:

```zsh
npm run clasp:login    # authenticate with Google
npm run deploy         # build + push to your project
```

Create your first deployment from the Apps Script editor (**Deploy → New deployment**) — see Google's [Create and manage deployments](https://developers.google.com/apps-script/concepts/deployments) guide. Note the deployment ID (also visible later via `npx clasp list-deployments`); you'll reuse it for every future update.

**Every update after that:**

```zsh
npm run deploy                                    # build + push
npx clasp create-version "<description>"          # snapshot a version
npx clasp update-deployment <deployment-id> --versionNumber <version>
```

A simplified script that wraps these steps — like this repo's own `scripts/release.sh` — is a natural follow-up, but doesn't exist yet for distributors. Do this by hand for now.

## The gotcha

`clasp update-deployment` repoints the Apps Script deployment object only — **it does not make the new version live for your Marketplace-installed users.** The Marketplace SDK has its own, separate "Sheets add-on script version" field that must be updated by hand — there's no API for it:

1. Go to your project's Marketplace SDK **App Configuration** page.
2. Under **App Integrations → Sheets add-on**, set **Sheets add-on script version** to the version number from `clasp create-version` above.
3. Click **Save**.

Skip this step and every installed user stays on the previous version, even though the deployment update above reported success.
````

- [ ] **Step 2: Verify against the spec's outline**

Re-open the file and confirm each of these — all must be true:
- Section 1 contrasts Editor add-on vs. container-bound, and links Google's Editor add-ons concepts doc.
- Section 2 has all three sub-steps (create project, link own GCP project, set Gemini API key) and does **not** include a separate Drive Advanced Service step.
- Section 3 links Google's Marketplace SDK docs, states the private/unlisted option, and flags the asset packet as TK.
- Section 4 gives concrete clasp commands (login, push, create-version, update-deployment) and notes the simplified release script as a future follow-up.
- Section 5 states the two-step gotcha and the exact manual fix (App Configuration → Sheets add-on script version → Save).
- No "what to tell your users" section is present (out of scope per spec).

- [ ] **Step 3: Commit**

```bash
git add docs/deploying-as-an-editor-add-on.md
git commit -m "$(cat <<'EOF'
docs: add editor add-on deployment guide for distributors (AI-118)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## After this plan

Not part of this plan (handled separately, per the branching model in CLAUDE.md and the tracker):
- Opening the PR from `AI-118-deploying-as-editor-add-on` against `AI-102-docs-restructure-tracker`.
- After that PR merges: a follow-up commit on the tracker branch marking row 4 "Merged" with the PR link — matching `82db435` and `c551f51`'s precedent for rows 1 and 2.
