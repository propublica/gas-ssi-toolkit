# PR Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update CLAUDE.md so future Claude sessions enforce the `AI-{n}-description` branch naming convention and use `.github/PULL_REQUEST_TEMPLATE.md` when creating PRs.

**Architecture:** Two additions to CLAUDE.md — a new `### Branch Naming` subsection under `## GitHub`, and a rewritten `### Creating PRs` subsection. No code changes; this is purely instruction-layer work.

**Tech Stack:** Markdown, bash (git), Python (JSON body assembly in curl command)

---

## Files

- Modify: `CLAUDE.md` (two edits — insert Branch Naming section, replace Creating PRs section)

---

### Task 1: Add Branch Naming section to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — insert after line 282 (end of Docker Sandbox auth section, before `### Creating PRs`)

- [ ] **Step 1: Insert the Branch Naming section**

Open `CLAUDE.md`. Find the line:

```
### Creating PRs
```

Insert the following block **immediately before** that line (leave a blank line between the new section and `### Creating PRs`):

```markdown
### Branch Naming

All feature and fix branches must follow this format:

```
AI-{issue-number}-short-description
```

Examples: `AI-42-add-token-input`, `AI-107-fix-recipe-prep-crash`

Linear's GitHub integration auto-detects branches with the issue ID pattern and links them to the issue on the Linear side. This is a public repo — no Linear URLs go in PR bodies.

**When creating a new branch:** Ask for the Linear issue ID if none is evident from context. Suggest the `AI-{n}-description` name before running `git checkout -b`.

**When creating a PR:** Check the branch name against `AI-\d+`. If absent, pause and say:

> "This branch name doesn't contain a Linear issue ID (`AI-123-...`). Is there an associated Linear issue? If not, say 'no issue' to proceed."

Wait for confirmation before creating the PR.

```

- [ ] **Step 2: Verify the insertion looks correct**

Run:
```bash
grep -n "### Branch Naming\|### Creating PRs\|### Docker Sandbox" CLAUDE.md
```

Expected output (line numbers will vary slightly):
```
257:### Docker Sandbox authentication
283:### Branch Naming
301:### Creating PRs
```

Confirm `### Branch Naming` appears between Docker Sandbox and Creating PRs.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): add branch naming convention and Linear enforcement guidance"
```

---

### Task 2: Rewrite the Creating PRs section in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — replace the `### Creating PRs` block (currently ~lines 301–317 after Task 1's edit)

- [ ] **Step 1: Replace the Creating PRs section**

Find and replace the entire `### Creating PRs` section — from `### Creating PRs` down to and including `PRs target \`develop\` by default; use \`"base": "main"\` for hotfixes.` — with the following:

```markdown
### Creating PRs

> Non-sandbox setups (local dev, direct `gh` auth) can use `gh pr create` and skip this section.

**Step 1 — Branch name check**

Run `git branch --show-current`. If the output does not match `AI-\d+` (e.g. `AI-42-my-feature`), warn and wait for confirmation. See [Branch Naming](#branch-naming).

**Step 2 — Build the PR body**

Read `.github/PULL_REQUEST_TEMPLATE.md` to get the section structure. Assemble the body:

- **Summary:** 2–4 bullets from `git log <base>..HEAD --oneline` and `git diff <base>..HEAD`. Focus on motivation and impact — not just a restatement of commit titles. Use `develop` as `<base>` for PRs targeting develop, `main` for PRs targeting main.

- **Manual QA — two parts in this order:**
  1. *Feature-specific steps* — numbered steps a human can follow to manually verify this PR's specific changes. Write from the diff. Be concrete (name the menu item, the sidebar panel, the column, etc.).
  2. *Regression checklist* — paste the 7-item checklist from the template verbatim. For PRs targeting `develop`, prepend:
     ```
     > Targeting `develop` — mark regression items N/A unless you're able to test end-to-end.
     ```

- **Notes:** Fill in only if a reviewer needs specific information (migration steps, known limitations, deploy dependencies). Otherwise leave the HTML comment placeholder from the template unchanged.

**Step 3 — Create the PR**

Use curl — the sandbox proxy injects credentials automatically. Use Python to assemble the JSON payload so the body is correctly escaped:

```bash
curl -s -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/propublica/gas-ssi-toolkit/pulls \
  -d "$(python3 -c "
import json
body = '''<assembled body — paste the populated template here as a Python triple-quoted string>'''
print(json.dumps({'title': '<PR title>', 'head': '<branch-name>', 'base': 'develop', 'body': body}))
")" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url') or d)"
```

PRs target `develop` by default; use `"base": "main"` for hotfixes.
```

- [ ] **Step 2: Verify the section looks correct**

Run:
```bash
grep -n "Step 1\|Step 2\|Step 3\|Branch name check\|Build the PR body\|Create the PR\|Manual QA\|Feature-specific\|Regression checklist" CLAUDE.md
```

Confirm all three steps appear under `### Creating PRs` and that both Manual QA subsections are present.

- [ ] **Step 3: Do a quick sanity check on the full GitHub section**

Run:
```bash
grep -n "^##\|^###" CLAUDE.md
```

Confirm the heading structure under `## GitHub` is:
```
### Docker Sandbox authentication
### Branch Naming
### Creating PRs
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update creating PRs to use PR template and populate body from diff"
```
