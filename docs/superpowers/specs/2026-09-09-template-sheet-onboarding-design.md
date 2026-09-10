# Template Sheet Onboarding — Design

## Problem

Getting a personal or trial copy of the SSI Toolkit running today requires: installing Node, learning/using `clasp`, manually creating an Apps Script project, enabling the Drive Advanced Service, setting a script property, copying a script ID into a local `.clasp.json`, and running a build + deploy. This is prohibitive for the toolkit's actual audience (journalists, not necessarily developers) and is a much heavier lift than the toolkit's value proposition justifies for a first look.

This spec covers making that on-ramp closer to "drag and drop" via a pre-built, container-bound template Google Sheet that people copy for themselves, rather than building their own Apps Script project from scratch.

## Non-goals

- **No Google Workspace Marketplace changes.** ProPublica already has an org-wide Marketplace listing (`docs/user-guide.md`, repointed by `scripts/release.sh`). That path is unaffected; this spec adds a third distribution channel for people outside ProPublica's org (or anyone who wants their own isolated copy + own API key), not a replacement for the Marketplace path.
- **No in-sheet API key setup wizard.** The existing manual step (Project Settings → Script Properties → `GEMINI_API_KEY`) stays as documented. A first-run wizard was considered and explicitly deferred — worth revisiting as a separate, later scope.
- **No version-visibility work.** `package.json`'s version is already the single source of truth, injected into the sidebar footer at build time, with `release.sh` handling the bump (PR #171). Nothing to add here.
- **No public/anonymous sharing.** ProPublica's Workspace restrictions prohibit sharing Workspace files publicly outside the org. This spec relies on individually-approved access, not a public link.

## Design

### 1. Template Sheet artifact

A Google Sheet, owned by Aaron's ProPublica Google account, with the SSI Toolkit bound to it as a container-bound Apps Script project (its own, separate script ID — distinct from the canonical project `scripts/release.sh` already deploys to).

**Sharing:** Restricted (not "Anyone with link"), in compliance with org policy. Someone who opens the share link without access sees Google's native **"Request access"** prompt, which emails Aaron; approval is a one-click action in Drive/Gmail. Once approved, the requester uses `File → Make a copy` to get their own fully independent Sheet + bound script + script properties (their own `GEMINI_API_KEY`, isolated from everyone else's).

This means the onboarding flow is: open link → Request access → (wait for approval) → Make a copy → set API key → done. Not fully self-serve, but the only remaining manual step is a one-click approval on Aaron's end, not anything the requester has to build or configure.

**"Start Here" tab:** The template Sheet's first tab is a short in-sheet walkthrough covering:
- What each of the four menu tools does (one line each)
- The one required setup step (setting `GEMINI_API_KEY`) with a direct link to the Apps Script Project Settings instructions
- A note that access is individually granted — if you can see this after being granted access but a colleague can't, tell them to use "Request access" on the same link, not to ask you to forward it

### 2. Release process

`scripts/release.sh` gains one new step: after the existing `npm run deploy` (which pushes freshly built `dist/` to the canonical project's HEAD), push that same `dist/` to the template project's script ID as well. Container-bound scripts always run HEAD, so — unlike the canonical project — there's no versioned-deployment/Marketplace-style repointing needed for this target; it's a push and nothing else.

This keeps the template in sync with the same human-gated release cadence as everything else (per `docs/releasing.md`), rather than drifting or requiring a separate on-demand update process.

**Implementation note (left to the implementation plan):** `clasp` reads a single `.clasp.json` from the current directory, and that file already holds the canonical project's script ID. Pushing to a second script ID requires either a second gitignored config file (e.g. `.clasp.template.json`) swapped in around that step, or an equivalent clasp mechanism. The exact approach is a plan-level decision, not a design-level one — script IDs aren't secrets, but only the person running `release.sh` needs this config, matching how `.clasp.json` itself already works.

`docs/releasing.md` gets updated to document this third target and the swap mechanism once implemented.

### 3. Documentation

**README.md:** A new "Get your own copy" section, positioned ahead of the existing clasp/dev instructions (steps 1–6 under "Deployment"), pointing to the template Sheet and explaining the Request access flow. The existing steps are relabeled as the contributor/developer path (for people building against this repo directly, not just running the toolkit).

**docs/user-guide.md:** The "Installing the add-on" section currently only documents the Marketplace path (gated behind "ask your admin"). It gets a short addition for the template-Sheet path, including the Request access step.

### 4. Threat model

A short addition to `docs/threat_models/ssi-toolkit-threat-model.md` noting the new distribution artifact:
- Access is individually approved via Google's Request access flow — no anonymous or public grant, which is a stronger posture than a plain public link would have been.
- Each copy made via `File → Make a copy` is fully independent: its own script properties, its own `GEMINI_API_KEY`, no shared secret or state with the template or with other copies.
- This is primarily a documentation-level addition — no new RPC endpoint, external API call, or OAuth scope is introduced by this change itself.

## Open items for the implementation plan

- Exact mechanism for pushing to two script IDs from `release.sh` (see note under §2).
- Content and exact wording of the "Start Here" tab.
- Whether the template project needs Drive Advanced Service enabled manually once (one-time setup, same as any new Apps Script project) before the first `release.sh` push, and confirming — empirically, against the real template project — that this enablement (declared in `appsscript.json`) survives being pushed via clasp the same way it does for the canonical project.
