# Design: Split Threat Model PRs — Standalone Security Fix + PR Link Column

**Date:** 2026-06-24
**Status:** Approved

## Problem

PR #112 (`AI-56-address-ai-generated-import-sheets-functions`) currently branches from `cadcf0b`, the first commit of PR #110 (`AI-8-initial-threat-model`). This creates a merge order dependency: #112 cannot merge until #110 merges first.

The code fix in #112 (`sanitizeForCell()`) is entirely independent — it only touches `utils.ts`, `index.ts`, and tests, none of which are introduced by AI-8. The entanglement is purely accidental from the original branching point.

Additionally, the threat model's Open Items table only links to Linear issues. Fixes that land as GitHub PRs (like T6) need a way to link the PR directly so reviewers can jump to the diff.

## Goal

1. PR #112 becomes a standalone security fix that can merge off `develop` with no dependency on #110.
2. The T6 "Resolved" entry (currently in #112) moves to #110.
3. The threat model Open Items table gains a `PR` column alongside the existing `Linear` column.

## Current Branch Structure

```
develop
├── AI-8-initial-threat-model  (PR #110)
│   commits: cadcf0b, 8315dab, 3ca908b, 7b46aaf, 7890f86
│   files: threat model doc, PR template, CLAUDE.md, spec
│   T6 status in threat model: Open
│
└── AI-56-address-ai-generated-import-sheets-functions  (PR #112)
    branches from: cadcf0b  (first AI-8 commit)
    commits: cadcf0b, 0edd70a
    0edd70a touches: utils.ts, index.ts, __tests__/utils.test.ts, threat model doc
    T6 status in threat model: Resolved (Linear link only)
```

## Target State

```
develop
├── AI-8-initial-threat-model  (PR #110)
│   same 5 commits + new commit:
│     - threat model: T6 row → Resolved, Linear + PR columns populated
│     - PR description updated
│
└── AI-56-address-ai-generated-import-sheets-functions  (PR #112)
    rebased onto develop (force-push)
    single commit: code-only cherry-pick of 0edd70a
      (utils.ts, index.ts, __tests__/utils.test.ts — no threat model)
    PR description updated (remove merge order note + T6 doc bullet)
```

## Part 1 — Rework PR #112

### Git operations

1. Checkout develop, create scratch branch:
   ```bash
   git checkout develop
   git checkout -b AI-56-standalone-scratch
   ```

2. Cherry-pick the fix commit:
   ```bash
   git cherry-pick 0edd70a
   ```
   This will conflict on `docs/threat_models/ssi-toolkit-threat-model.md` (file doesn't exist on develop).

3. Resolve by dropping the threat model change:
   ```bash
   git checkout HEAD -- docs/threat_models/ssi-toolkit-threat-model.md
   git cherry-pick --continue
   ```
   (If cherry-pick auto-completes without conflict, use `git reset HEAD docs/threat_models/...` + `git checkout -- docs/threat_models/...` + `git commit --amend` instead.)

4. Verify the diff contains exactly three files: `utils.ts`, `index.ts`, `__tests__/utils.test.ts`. No threat model changes.

5. Force-push to the AI-56 remote branch:
   ```bash
   git push origin AI-56-standalone-scratch:AI-56-address-ai-generated-import-sheets-functions --force
   ```

6. Delete scratch branch: `git branch -d AI-56-standalone-scratch`

### PR #112 description update

Remove from the body:
- The bullet "Marks T6 as Resolved in the threat model open items table with a link to this issue"
- The "Merge order" note under the body

The remaining bullets cover the full fix: `sanitizeForCell()` implementation, formula-prefix handling, and wiring into setValue calls.

## Part 2 — Update PR #110

### Threat model table changes

**Current header:**
```
| Priority | Status | Linear | Item | Description |
```

**New header:**
```
| Priority | Status | Linear | PR | Item | Description |
```

All existing rows get `—` in the new PR column.

**T6 row — current (on AI-8 branch):**
```
| High | Open | — | Fix T6 — formula injection | Implement `sanitizeForCell()`... |
```

**T6 row — updated:**
```
| High | Resolved | [AI-56](https://linear.app/propublica/issue/AI-56/address-ai-generated-import-sheets-functions) | [#112](https://github.com/propublica/gas-ssi-toolkit/pull/112) | Fix T6 — formula injection | `sanitizeForCell()` in `src/server/utils.ts`... |
```

### Commit on AI-8 branch

Checkout `AI-8-initial-threat-model`, edit the threat model file with the changes above, then commit:

```
docs(security): mark T6 resolved, add PR column to open items table
```

### PR #110 description update

Add a bullet to the Summary section:
- "Marks T6 (formula injection) as Resolved in the open items table, referencing both the Linear issue ([AI-56](https://linear.app/propublica/issue/AI-56/address-ai-generated-import-sheets-functions)) and the fix PR (#112)"

## Merge Order After This Work

Either PR can merge independently. The natural order is #112 first (code fix lands in develop), then #110 (threat model lands and already reflects the resolved state). But the order is not enforced — they don't conflict.

## Out of Scope

- No changes to the sanitizeForCell implementation or tests.
- No changes to other Open Items rows.
- No other threat model sections modified beyond the Open Items table header and T6 row.
