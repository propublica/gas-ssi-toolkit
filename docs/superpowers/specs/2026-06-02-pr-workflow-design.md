# PR Workflow Design

**Date:** 2026-06-02
**Status:** Approved

## Overview

Improve Claude's PR creation process to: (1) use the repo's PR template as the actual body, populated intelligently from the diff; and (2) enforce the `AI-{n}-description` branch naming convention so Linear auto-associates branches with issues.

This is a public open-source repo — no Linear issue URLs appear in PR bodies. Linear linkage happens silently via branch name detection on the Linear side.

---

## Branch Naming Convention

### Format

```
AI-{issue-number}-short-description
```

Examples: `AI-42-add-token-input`, `AI-107-fix-recipe-prep-crash`

### Linear Integration

Linear's GitHub integration automatically detects branches named with the issue ID pattern and links the branch to the issue. No magic words or issue URLs in the PR body are needed, and no private content is exposed in the public repo.

### Enforcement: At Branch Creation

When Claude creates or checks out a new branch:
1. Ask for the Linear issue ID if none is evident from context
2. Suggest a branch name in `AI-{n}-description` format before running `git checkout -b`

### Enforcement: At PR Creation

Claude checks the current branch name for the `AI-\d+` pattern. If absent:
- Warn: "This branch name doesn't contain a Linear issue ID (`AI-123-...`). Is there an associated issue? If not, type 'no issue' to proceed."
- If user confirms no issue (or similar), proceed normally
- Covers legitimate hotfix/chore branches with no Linear issue

---

## PR Body Construction

Claude reads `.github/PULL_REQUEST_TEMPLATE.md` from disk at PR creation time, populates its three sections, and passes the result as the `body` field in the GitHub REST API `curl` POST.

### Summary

Claude generates 2–4 bullets from `git diff [base]...HEAD` and recent commit messages, describing what changed and why. Focus on the "why" — the motivation and impact — not just a restatement of commit messages.

### Manual QA

Two parts, in this order:

**1. Feature-specific steps (Claude-generated)**

Numbered steps describing how to manually verify the specific changes in this PR. Written from the diff — concrete, actionable, testable. Example:

```
1. Open a Google Sheet → SSI Tools → Run AI
2. Confirm the column visibility toggle appears in the sidebar
3. Toggle it off — verify the column is hidden in the output
```

**2. Regression checklist (from template)**

The existing 7-item checklist kept verbatim. For PRs targeting `develop`, Claude prepends:

```
> Targeting `develop` — mark regression items N/A unless you're able to test end-to-end.
```

For PRs targeting `main`, the checklist is presented as-is (unchecked).

### Notes

Filled in only when a reviewer genuinely needs to know something: migration steps, known limitations, deploy dependencies, caveats. Otherwise left as the HTML comment placeholder from the template.

---

## CLAUDE.md Changes

### New section: `## Branch Naming`

Documents the `AI-{n}-description` convention and describes Claude's enforcement behavior at branch creation and PR creation time.

### Updated section: `### Creating PRs`

- Replace the current hardcoded `curl` body with instructions to read and populate `.github/PULL_REQUEST_TEMPLATE.md`
- Add the branch name check step before curl execution
- Keep the existing `curl` command structure (proxy-injected credentials, no `gh` CLI)

---

## Out of Scope

- Linear issue URLs in PR bodies (public repo — non-org contributors can't see them)
- Magic word closing (`Closes AI-123`) — managed manually per PR
- Any changes to `.github/PULL_REQUEST_TEMPLATE.md` itself
