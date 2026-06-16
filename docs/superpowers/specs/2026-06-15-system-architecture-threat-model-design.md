# System Architecture Diagram — Threat Model Design

## Purpose

A low-fidelity security communication artifact: two Mermaid diagrams that map the system's components, trust boundaries, and data flows. Intended for use in security reviews, onboarding, and stakeholder conversations — not a formal STRIDE analysis.

## Scope Decisions

- External systems are shown as distinct named entities (not collapsed into one box) because the access mechanisms and security surfaces differ between them.
- Google Workspace and Google Cloud / AI Platform are separated because they use different access mechanisms: Workspace uses OAuth (user-delegated), GCP uses an API key stored in Script Properties.
- Google Sign-In (basic account authentication to access Sheets) is not shown — it is Google's own authentication layer and not specific to this add-on. The OAuth node represents only the add-on authorization consent.
- Google Docs is not shown as a separate node — OCR temp doc creation/deletion is annotated on the Drive edge.
- The CI/CD pipeline is a separate diagram so each threat surface can be discussed independently.

## Zones / Trust Boundaries

| Zone | What it represents |
| --- | --- |
| User's Machine | Browser where the sidebar iframe runs; user-controlled |
| Apps Script Runtime | Google-hosted V8 runtime running our code; our code, their infrastructure |
| Google Workspace | OAuth consent, Sheets, Drive — accessed via user-delegated OAuth scopes |
| Google Cloud / AI Platform | Gemini Files API and Gemini Inference API — accessed via API key |
| Dev / CI | GitHub, GitHub Actions, credentialed developer, clasp |

## Key Security Observations Surfaced

- **Highest-sensitivity data flow:** The Gemini inference call is the only place where spreadsheet content and Drive file data leaves the user's Google account and reaches an external AI endpoint.
- **Gemini Files API persistence:** File content uploaded to the Gemini Files API is cached on Google Cloud for 48 hours before expiry. This is distinct from the inline base64 path.
- **API key as the GCP access gate:** The `GEMINI_API_KEY` stored in Script Properties is the sole credential granting access to both Gemini APIs. It is not user-scoped.
- **CI is not a security gate:** GitHub Actions runs lint/typecheck/tests only — it cannot detect semantically malicious code. A credentialed developer manually reviewing and deploying is the only human checkpoint between a merged PR and production.
- **Public repo → production path:** A public contributor can submit a PR to the public GitHub repo. If it passes CI and a credentialed developer merges and deploys it without catching malicious intent, that code runs in users' spreadsheets.
- **clasp deployment access:** Deploying requires a Google account with editor/owner access on the Apps Script project — not just Google credentials.

## Diagram 1 — Runtime Data Flows

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 80, "rankSpacing": 180, "curve": "monotoneX"}} }%%
flowchart LR
    subgraph USER_ZONE["User's Machine"]
        USER["Journalist / User"]
        SIDEBAR["Sidebar UI (browser iframe)"]
    end

    subgraph GAS_ZONE["Apps Script Runtime — Google-hosted, our code"]
        SERVER["Apps Script Server"]
        PROPS[("Script Properties\nGEMINI_API_KEY")]
    end

    subgraph WORKSPACE["Google Workspace"]
        OAUTH["Google OAuth (add-on consent)"]
        SHEETS["Google Sheets"]
        DRIVE["Google Drive"]
    end

    subgraph GCP["Google Cloud / AI Platform"]
        GEMINI_FILES["Gemini Files API (48h cache)"]
        GEMINI["Gemini Inference API"]
    end

    USER -->|"opens spreadsheet"| SHEETS
    SHEETS -->|"triggers onOpen"| SERVER
    SERVER -->|"serves sidebar"| SIDEBAR
    USER <-->|"interacts"| SIDEBAR
    SIDEBAR <-->|"google.script.run RPC"| SERVER
    USER -->|"OAuth consent (first use)"| OAUTH
    OAUTH -->|"grants scopes"| SERVER
    SERVER <-->|"reads rows / writes results"| SHEETS
    SERVER <-->|"lists folders, reads files"| DRIVE
    SERVER -->|"reads API key"| PROPS
    SERVER -->|"upload file blob"| GEMINI_FILES
    GEMINI_FILES -->|"file URI (cached 48h)"| SERVER
    SERVER -->|"prompt + file URI or base64"| GEMINI
    GEMINI -->|"AI response"| SERVER
```

## Diagram 2 — CI / CD Pipeline

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 80, "rankSpacing": 180, "curve": "monotoneX"}} }%%
flowchart LR
    subgraph PUBLIC["Public Internet"]
        CONTRIB["Public Contributor"]
    end

    subgraph CICD["CI / CD"]
        GH["GitHub (public repo)"]
        GHA["GitHub Actions"]
    end

    subgraph TEAM["ProPublica Team"]
        DEV["Credentialed Developer"]
        CLASP["clasp"]
    end

    SERVER["Apps Script Server (production)"]

    CONTRIB -->|"submits PR"| GH
    GH -->|"triggers"| GHA
    GHA -.->|"lint / typecheck / test only\nnot a semantic security gate"| GH
    GH -->|"pulls code"| DEV
    DEV -->|"reviews & merges"| GH
    DEV -->|"runs deploy"| CLASP
    CLASP -->|"pushes compiled bundle\n(requires project editor access)"| SERVER
```
