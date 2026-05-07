# Document Summarization Recipe Redesign

**Date:** 2026-04-15
**Status:** Ready for implementation

## Goal

Improve the document summarization recipe for a journalism use case: journalists doing first-pass review of source documents (court filings, FOIA responses, government reports, corporate records, etc.) from a Google Drive folder.

## Recipe Metadata

| Field | Value |
|---|---|
| `id` | `document-summarization` (unchanged) |
| `name` | `Document Summarization` (unchanged) |
| `icon` | `📄` (unchanged) |
| `description` | `"Summarize files in a Google Drive folder"` (unchanged) |

## Inputs

| `id` | Label | Required | Placeholder |
|---|---|---|---|
| `folder` | Drive Folder | Yes | `"Paste Google Drive folder URL"` |
| `docType` | Document Type | No | `"e.g. court filing, FOIA response, annual report"` |
| `focus` | Area of Interest | No | `"e.g. financial fraud, conflicts of interest"` |

Both `docType` and `focus` are optional. The recipe runs usefully with only the folder URL; the new fields narrow the model's lens when provided.

## prepTemplate Columns

| `colTitle` | `fillStrategy` | `role` |
|---|---|---|
| `Drive Link` | `list-drive-folder` from `folder` | `file-prompt` |
| `System Prompt` | `template` (see below) | `system-prompt` |
| `User Prompt` | `fill-value`: `"Summarize the attached document."` | `text-prompt` |
| `AI_Summarization` | `create-empty` | `output` |

The System Prompt column changes from `fill-value` to `template` to support interpolation of `docType` and `focus`. The User Prompt simplifies to a single static instruction.

## Prompts

### System Prompt (template strategy)

```
Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.

Tone: Objective, professional, and dense with information but sparse with "fluff" words.

Guidelines:
  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"
  - Structure: Always start with a 1-sentence "Bottom Line Up Front" (BLUF). Follow with 3-5 high-impact bullet points.
  - Constraint: Keep the entire output under 150 words.
{{#docType}}  - Document type: {{docType}}{{/docType}}
{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.{{/focus}}
```

**Design rationale:** `docType` and `focus` are batch-level context (same for every row), so they belong in the system prompt rather than the user prompt. Conditional blocks (`{{#key}}...{{/key}}`) ensure nothing leaks through when fields are left empty.

### User Prompt (fill-value strategy)

```
Summarize the attached document.
```

## Required Infrastructure: Conditional Template Blocks

The system prompt template requires extending `interpolateTemplate` in `src/server/utils.ts` to support `{{#key}}...{{/key}}` conditional blocks — content is included only when the named input is non-empty.

### Implementation

```typescript
// src/server/utils.ts
export function interpolateTemplate(template: string, inputValues: Record<string, string>): string {
  // Pass 1: conditional blocks — include content only if value is non-empty
  const withBlocks = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, id: string, content: string) => (inputValues[id] ?? "") ? content : ""
  );
  // Pass 2: simple interpolations
  return withBlocks.replace(/\{\{(\w+)\}\}/g, (_, id: string) => inputValues[id] ?? "");
}
```

### Files to touch

1. **`src/server/utils.ts`** — extend `interpolateTemplate` (two-pass regex)
2. **`__tests__/utils.test.ts`** — add test cases for conditional block syntax
3. **`src/client/recipes.ts`** — update the document-summarization recipe definition
