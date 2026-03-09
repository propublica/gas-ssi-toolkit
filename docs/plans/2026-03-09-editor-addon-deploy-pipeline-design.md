# Editor Add-on Deployment Pipeline Design

## Context

SSI Toolkit is transitioning from a container-bound Apps Script to a standalone Editor Add-on distributed privately via the Google Workspace Marketplace. This document captures the deployment pipeline design agreed upon during the transition.

## Background

Container-bound scripts are attached to a specific Google Sheet. Editor Add-ons are standalone script projects users install from the Marketplace, which can then operate on any Sheet in their domain.

The old pipeline maintained two `.clasp.*.json` files (`dev` and `prod`) and swapped between them at deploy time. This model doesn't translate to add-ons, where there is one canonical script project with multiple deployment states.

## Core Concept: One Script, Two Deployment States

```
Script Project (1hIyBphS...)
├── HEAD              ← clasp push target; active development surface
│                       Marketplace users are unaffected by HEAD changes
└── Versioned Deploy  ← stable, pinned snapshot
                        what Marketplace-installed users actually run
```

- `deploy` — builds and pushes code to HEAD. For rapid development and testing.
- `release` — calls `deploy`, then snapshots HEAD as a new version and repoints the Marketplace deployment to it. Human-only; blocked for Claude via permissions deny rule.

## Testing During Development

In the Apps Script editor, use **Deploy → Test deployments** to get a shareable URL that runs the add-on at HEAD against a real Sheet. This is the dev testing surface — no need for a separate script project.

## Script Project

Single script: `1hIyBphS_JoSvdSy6jF-D8YKqYnuxz6nmG_wcYFwe7ahbun7YFqhSyzOm`

Registered in Google Workspace Marketplace SDK App Configuration as a private add-on for the PropPublica domain. The Marketplace deployment ID is a stable pointer — `release` repoints it to a new version on each release without changing the ID itself.

## Deployment ID Setup (One-Time)

After first deploy, run:
```bash
clasp list-deployments
```
Copy the deployment ID (not the `@HEAD` entry — the named deployment entry). Paste it into `scripts/release.sh` as `DEPLOYMENT_ID`. Commit.

## New npm Script Taxonomy

| Script | Command | Purpose |
|---|---|---|
| `deploy` | `npm run build && clasp push` | Push code to HEAD |
| `deploy:watch` | parallel build:watch + push:watch | Continuous push during development |
| `release` | `./scripts/release.sh` (human-only) | Snapshot + promote to Marketplace |

Retired scripts: `deploy:dev`, `deploy:prod`, `deploy:watch:dev`, `deploy:watch:prod`, `push:watch`.

## File Changes Summary

| File | Change |
|---|---|
| `package.json` | Rename/remove scripts per taxonomy above |
| `scripts/release.sh` | New shell script: deploy + create-version + redeploy |
| `.clasp.json` | Remove from `.gitignore`; becomes committed stable config |
| `.clasp.dev.json` | Delete |
| `.clasp.prod.json` | Delete |
| `README.md` | Update commands + add Code Lifecycle section |
| `CLAUDE.md` | Update commands block; note release is human-only |
| `.claude/settings.local.json` | Already updated: deny rule for `*scripts/release.sh*` |

## Claude Safeguards

`.claude/settings.local.json` contains:
```json
"deny": ["Bash(*scripts/release.sh*)"]
```
This blocks Claude from invoking the release script regardless of how it is called. CLAUDE.md will additionally document that release is a human-only operation.
