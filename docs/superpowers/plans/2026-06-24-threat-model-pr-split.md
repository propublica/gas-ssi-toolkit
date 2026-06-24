# Threat Model PR Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase PR #112 onto `develop` as a standalone security fix (code only, no threat model change), and update PR #110 to own the T6-Resolved entry with a new PR link column.

**Architecture:** Two independent git tasks on two separate branches. Task 1 rewrites the AI-56 branch history (force-push). Task 2 adds a commit to AI-8. Neither touches the other's branch. Do Task 1 first so the #112 URL exists when Task 2 references it.

**Tech Stack:** git, curl + Python (GitHub REST API for PR description updates)

## Global Constraints

- GitHub API calls: use `-H "Authorization: Bearer $GH_TOKEN"` explicitly; write JSON payload to `$TMPDIR` file first, pass with `-d @file`
- Force-push only to `AI-56-address-ai-generated-import-sheets-functions` (solo feature branch, no collaborators)
- All commits must follow the existing message style (conventional commits: `fix:`, `docs:`)
- Run `npm test` after Task 1 to verify the rebased commit doesn't break tests

---

## Files Changed

**Task 1 — PR #112 rebase:**
- Rewrite: `AI-56-address-ai-generated-import-sheets-functions` branch history

**Task 2 — PR #110 threat model update:**
- Modify: `docs/threat_models/ssi-toolkit-threat-model.md` (on `AI-8-initial-threat-model` branch)

---

## Task 1: Rebase PR #112 onto develop (code-only)

**Goal:** Replace the current AI-56 branch (which branches from AI-8's first commit `cadcf0b`) with a single commit on top of `develop` containing only the three code files — `utils.ts`, `index.ts`, `__tests__/utils.test.ts`. No threat model changes.

**Files:**
- Rewrite branch: `AI-56-address-ai-generated-import-sheets-functions`
- Code files brought in: `src/server/utils.ts`, `src/server/index.ts`, `__tests__/utils.test.ts`

- [ ] **Step 1: Confirm current branch and clean state**

```bash
git status
git branch --show-current
```

Expected: clean working tree, on `develop`.

- [ ] **Step 2: Create a scratch branch from develop**

```bash
git checkout develop
git checkout -b AI-56-standalone-scratch
```

Expected: new branch `AI-56-standalone-scratch` at same HEAD as `develop`.

- [ ] **Step 3: Bring in the three code files from AI-56**

```bash
git checkout origin/AI-56-address-ai-generated-import-sheets-functions -- \
  src/server/utils.ts \
  src/server/index.ts \
  __tests__/utils.test.ts
```

Expected: three files staged, no other changes. Verify:

```bash
git diff --cached --name-only
```

Expected output (exactly these three lines, no others):
```
__tests__/utils.test.ts
src/server/index.ts
src/server/utils.ts
```

- [ ] **Step 4: Verify the diff looks correct**

```bash
git diff --cached src/server/utils.ts | grep "^+" | grep -i "sanitize"
```

Expected: lines showing `sanitizeForCell` function being added.

```bash
git diff --cached src/server/index.ts | grep "^+" | grep -i "sanitize"
```

Expected: lines showing `sanitizeForCell` being called in the wiring.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all 490 tests pass (the sanitizeForCell tests are included in `__tests__/utils.test.ts` which is now staged).

- [ ] **Step 6: Commit with the original message**

```bash
git commit -m "fix(security): block web-fetch formula injection in AI output cells (T6)"
```

- [ ] **Step 7: Verify the branch has exactly one commit beyond develop**

```bash
git log --oneline develop..HEAD
```

Expected: exactly one line — the commit just made.

- [ ] **Step 8: Force-push to the AI-56 remote branch**

```bash
git push origin AI-56-standalone-scratch:AI-56-address-ai-generated-import-sheets-functions --force
```

Expected: `Branch 'AI-56-address-ai-generated-import-sheets-functions' set up to track remote branch...` or similar success output.

- [ ] **Step 9: Delete the scratch branch and return to develop**

```bash
git checkout develop
git branch -d AI-56-standalone-scratch
```

- [ ] **Step 10: Update PR #112 description**

Write the payload to a temp file and PATCH via GitHub API.

The new body removes two items from the current Summary: the "Marks T6 as Resolved" bullet and the "Merge order" note. All other sections remain unchanged.

```bash
python3 -c "
import json, os
body = '''## Summary

- Implements \`sanitizeForCell()\` in \`src/server/utils.ts\` — scans AI-generated text for Sheets web-fetch functions (IMAGE, IMPORTDATA, IMPORTXML, IMPORTHTML, IMPORTRANGE, IMPORTFEED) anywhere in the formula body, including nested positions like \`=IF(1=1,IMAGE(...),0)\`, and replaces them with an explicit error string rather than writing to the sheet
- Other formula-prefixed values (\`=\`, \`+\`, \`-\`) that don\'t contain web-fetch functions get a \`\'\` prefix so Sheets renders them as literals
- Wires \`sanitizeForCell()\` into both \`setValue()\` call sites on the AI output column in \`index.ts\`

## Manual QA

> N/A — targets \`develop\`; behaviour only changes when AI returns a value starting with \`=\`, \`+\`, or \`-\`

## Security

- [x] Modifies how AI output is written to the spreadsheet (affects T6 — formula injection)

## Notes

<!-- Anything reviewers or QA testers should know -->'''
payload = json.dumps({'body': body})
path = os.path.join(os.environ['TMPDIR'], 'pr112_body.json')
open(path, 'w').write(payload)
print(path)
"
```

Note the path printed, then:

```bash
curl -s -X PATCH \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/propublica/gas-ssi-toolkit/pulls/112 \
  -d @"$TMPDIR/pr112_body.json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url') or d)"
```

Expected: prints `https://github.com/propublica/gas-ssi-toolkit/pull/112`

- [ ] **Step 11: Confirm PR #112 on GitHub**

Open `https://github.com/propublica/gas-ssi-toolkit/pull/112` and verify:
- Branch now shows 1 commit (the fix commit) on top of `develop`
- Description has no "Merge order" note
- Description has no "Marks T6 as Resolved" bullet
- CI passes (lint, typecheck, tests)

---

## Task 2: Update PR #110 — threat model T6 row + PR column

**Goal:** On the `AI-8-initial-threat-model` branch, add a new commit that (1) adds a `PR` column to the Open Items table, and (2) marks T6 as Resolved with both the Linear issue link and the #112 PR link.

**Files:**
- Modify: `docs/threat_models/ssi-toolkit-threat-model.md` (on `AI-8-initial-threat-model` branch)

- [ ] **Step 1: Checkout the AI-8 branch**

```bash
git checkout AI-8-initial-threat-model
```

If the local branch doesn't exist yet:

```bash
git checkout -b AI-8-initial-threat-model origin/AI-8-initial-threat-model
```

Expected: on branch `AI-8-initial-threat-model`, clean working tree.

- [ ] **Step 2: Edit the Open Items table in the threat model**

File: `docs/threat_models/ssi-toolkit-threat-model.md`

Replace the entire Open Items table. The current table (to find it, search for `### Open Items`) looks like this:

**Current table header and T6 row (old_string for Edit tool):**
```
| Priority | Status | Linear | Item | Description |
| --- | --- | --- | --- | --- |
| High | Open | — | Fix T6 — formula injection | Implement `sanitizeForCell()` in `src/server/utils.ts`: reject web-fetch formulas (anywhere in formula body, including nested) with an error string; prefix other formula-triggered values with `'`; wire into all `setValue()` calls on the AI output column in `index.ts` (R8) |
| Medium | Open | — | Branch protection audit | Confirm required-review rules are active on `main` and `develop` (R5) |
| Medium | Open | — | Access audit | Review and document who has Apps Script project editor access (R1) |
| Medium | Open | — | Stackdriver log audit | Review exception handling in `index.ts` to confirm no cell values or file names reach Stackdriver logs (R14) |
| Medium | Open | — | Add `npm audit` to CI | Fail CI on high/critical npm vulnerabilities (R12) |
| Medium | Open | — | Fix T15 — OCR temp doc cleanup | Wrap deletion in `finally`, alert user on cleanup failure, prefix temp doc names with `[SSI-TEMP]` (R19) |
| Low | Open | — | 2FA verification | Confirm 2FA is enforced on all accounts with deploy access (R9) |
| Medium | Open | — | T11 sidebar warning — specify both url_context vectors | Update the `url_context` warning copy to explicitly state that URLs already in dataset cells will be fetched, and that attacker-controlled URLs can inject instructions via their response (R13) |
| Low | Open | — | Post-MVP: pre-inference URL scan | Before a `url_context` run, scan prompt column cells for URLs and surface an alert listing them so the user can confirm before proceeding (R13, deferred) |
| Low | Open | — | User-facing data notice | Write guidance for journalists covering data sent to Gemini, prompt injection risk, and `url_context` egress (R3, R11, R13) |
| Low | Open | — | GCP budget alerts and quota caps | Configure spend alerts and per-key daily quotas in Google Cloud Console (R16, R17) |
```

**Replace with (new_string for Edit tool):**
```
| Priority | Status | Linear | PR | Item | Description |
| --- | --- | --- | --- | --- | --- |
| High | Resolved | [AI-56](https://linear.app/propublica/issue/AI-56/address-ai-generated-import-sheets-functions) | [#112](https://github.com/propublica/gas-ssi-toolkit/pull/112) | Fix T6 — formula injection | `sanitizeForCell()` in `src/server/utils.ts`: rejects web-fetch formulas (anywhere in formula body, including nested) with an error string; prefixes other formula-triggered values with `'`; wired into all `setValue()` calls on the AI output column in `index.ts` (R8) |
| Medium | Open | — | — | Branch protection audit | Confirm required-review rules are active on `main` and `develop` (R5) |
| Medium | Open | — | — | Access audit | Review and document who has Apps Script project editor access (R1) |
| Medium | Open | — | — | Stackdriver log audit | Review exception handling in `index.ts` to confirm no cell values or file names reach Stackdriver logs (R14) |
| Medium | Open | — | — | Add `npm audit` to CI | Fail CI on high/critical npm vulnerabilities (R12) |
| Medium | Open | — | — | Fix T15 — OCR temp doc cleanup | Wrap deletion in `finally`, alert user on cleanup failure, prefix temp doc names with `[SSI-TEMP]` (R19) |
| Low | Open | — | — | 2FA verification | Confirm 2FA is enforced on all accounts with deploy access (R9) |
| Medium | Open | — | — | T11 sidebar warning — specify both url_context vectors | Update the `url_context` warning copy to explicitly state that URLs already in dataset cells will be fetched, and that attacker-controlled URLs can inject instructions via their response (R13) |
| Low | Open | — | — | Post-MVP: pre-inference URL scan | Before a `url_context` run, scan prompt column cells for URLs and surface an alert listing them so the user can confirm before proceeding (R13, deferred) |
| Low | Open | — | — | User-facing data notice | Write guidance for journalists covering data sent to Gemini, prompt injection risk, and `url_context` egress (R3, R11, R13) |
| Low | Open | — | — | GCP budget alerts and quota caps | Configure spend alerts and per-key daily quotas in Google Cloud Console (R16, R17) |
```

- [ ] **Step 3: Verify the edit**

```bash
git diff docs/threat_models/ssi-toolkit-threat-model.md | grep "^[+-]" | grep -v "^---\|^+++"
```

Expected changes:
- Header row gains `| PR |` column
- T6 row: `Open` → `Resolved`, `—` → Linear link, new `[#112](...)` cell, description tense changes (Implement → rejects/prefixes/wired)
- All other rows gain a `| — |` cell after the Linear column
- No other lines changed

- [ ] **Step 4: Commit**

```bash
git add docs/threat_models/ssi-toolkit-threat-model.md
git commit -m "docs(security): mark T6 resolved, add PR column to open items table"
```

- [ ] **Step 5: Push the new commit to origin**

```bash
git push origin AI-8-initial-threat-model
```

Expected: fast-forward push success (not a force-push — just adding a commit).

- [ ] **Step 6: Update PR #110 description**

```bash
python3 -c "
import json, os
body = '''## Summary

- Introduces the SSI Toolkit threat model at \`docs/threat_models/ssi-toolkit-threat-model.md\` — 15 threats (T1–T15), 19 responses (R1–R19), and an open items tracker using the Mozilla 4-question framework
- Adds two Mermaid architecture diagrams (runtime data flows + CI/CD pipeline) with trust boundary zones to make attack surfaces visible
- Adds a Security section to the PR template prompting contributors to identify affected threats before opening a PR
- Updates CLAUDE.md with security review guidance and an accurate description of the formula injection guard (T6) that all AI output writes must pass through
- Adds a threat modeling skill at \`docs/superpowers/skills/application-threat-modeling.md\` documenting the diagram-first, 4-question process for future sessions
- Marks T6 (formula injection) as Resolved in the open items table, with links to the Linear issue ([AI-56](https://linear.app/propublica/issue/AI-56/address-ai-generated-import-sheets-functions)) and the fix PR ([#112](https://github.com/propublica/gas-ssi-toolkit/pull/112)); adds a PR column to the table for future fix references

## Manual QA

> N/A — targets \`develop\`, no runtime behavior changes

## Security

- [x] None of the above — no threat model update needed (this PR *is* the threat model)

## Notes

<!-- Anything reviewers or QA testers should know -->'''
payload = json.dumps({'body': body})
path = os.path.join(os.environ['TMPDIR'], 'pr110_body.json')
open(path, 'w').write(payload)
print(path)
"
```

```bash
curl -s -X PATCH \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/propublica/gas-ssi-toolkit/pulls/110 \
  -d @"$TMPDIR/pr110_body.json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url') or d)"
```

Expected: prints `https://github.com/propublica/gas-ssi-toolkit/pull/110`

- [ ] **Step 7: Return to develop**

```bash
git checkout develop
```

- [ ] **Step 8: Confirm PR #110 on GitHub**

Open `https://github.com/propublica/gas-ssi-toolkit/pull/110` and verify:
- New commit visible in the commit list
- Description includes the T6 Resolved bullet with both links
- Threat model preview (Files changed tab) shows the new PR column and Resolved T6 row
