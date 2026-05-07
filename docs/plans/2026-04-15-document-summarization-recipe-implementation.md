# Document Summarization Recipe Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the document-summarization recipe for journalism use — two new optional inputs (document type, area of interest), a journalist-oriented BLUF system prompt using conditional template blocks, and the infrastructure to support those blocks.

**Architecture:** Add a two-pass conditional block syntax (`{{#key}}...{{/key}}`) to `interpolateTemplate`, then update the recipe definition to use the new inputs and template. No new files; three existing files modified.

**Tech Stack:** TypeScript, Jest, Rollup (no new dependencies)

---

### Task 1: Extend `interpolateTemplate` with conditional block support

**Files:**
- Modify: `src/server/utils.ts:145-151`
- Test: `__tests__/utils.test.ts:434-456`

**Step 1: Write the failing tests**

Add the following cases to the `describe("interpolateTemplate", ...)` block in `__tests__/utils.test.ts`, just before the closing `});` on line 456:

```typescript
  it("includes block content when the key has a non-empty value", () => {
    expect(
      interpolateTemplate("{{#focus}}Focus: {{focus}}{{/focus}}", { focus: "fraud" }),
    ).toBe("Focus: fraud");
  });

  it("omits block content when the key is empty string", () => {
    expect(
      interpolateTemplate("{{#focus}}Focus: {{focus}}{{/focus}}", { focus: "" }),
    ).toBe("");
  });

  it("omits block content when the key is missing from inputValues", () => {
    expect(
      interpolateTemplate("{{#focus}}Focus: {{focus}}{{/focus}}", {}),
    ).toBe("");
  });

  it("handles multiple conditional blocks independently", () => {
    expect(
      interpolateTemplate(
        "{{#docType}}Type: {{docType}}{{/docType}}\n{{#focus}}Focus: {{focus}}{{/focus}}",
        { docType: "filing", focus: "" },
      ),
    ).toBe("Type: filing\n");
  });

  it("handles conditional blocks alongside simple placeholders", () => {
    expect(
      interpolateTemplate("Hello {{name}}{{#extra}} ({{extra}}){{/extra}}", {
        name: "world",
        extra: "detail",
      }),
    ).toBe("Hello world (detail)");
  });

  it("handles conditional blocks with multiline content", () => {
    expect(
      interpolateTemplate("before\n{{#key}}line1\nline2\n{{/key}}after", { key: "yes" }),
    ).toBe("before\nline1\nline2\nafter");
  });
```

**Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/utils.test.ts -t "interpolateTemplate" --no-coverage
```

Expected: 6 new tests FAIL with errors like `"Focus: fraud" !== ""`

**Step 3: Implement two-pass interpolation**

Replace the body of `interpolateTemplate` in `src/server/utils.ts` (lines 145–151):

```typescript
/**
 * Replace {{inputId}} placeholders and {{#key}}...{{/key}} conditional blocks
 * in a template string with values from a map.
 *
 * Conditional blocks: content is included only when the named key has a non-empty value.
 * Simple placeholders: unknown keys are replaced with an empty string.
 */
export function interpolateTemplate(template: string, inputValues: Record<string, string>): string {
  // Pass 1: conditional blocks — include content only if value is non-empty
  const withBlocks = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, id: string, content: string) => ((inputValues[id] ?? "") ? content : ""),
  );
  // Pass 2: simple interpolations
  return withBlocks.replace(/\{\{(\w+)\}\}/g, (_, id: string) => inputValues[id] ?? "");
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/utils.test.ts -t "interpolateTemplate" --no-coverage
```

Expected: all 11 tests PASS (5 existing + 6 new)

**Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests PASS

**Step 6: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat: add conditional block syntax to interpolateTemplate"
```

---

### Task 2: Update the document-summarization recipe

**Files:**
- Modify: `src/client/recipes.ts`

**Step 1: Replace the recipe definition**

Replace the entire contents of `src/client/recipes.ts` with:

```typescript
import type { RecipeDefinition } from "./types";

export const RECIPES: RecipeDefinition[] = [
  {
    id: "document-summarization",
    name: "Document Summarization",
    icon: "📄",
    description: "Summarize files in a Google Drive folder",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "Make sure you have access to this folder",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        placeholder: "e.g. court filing, FOIA response, annual report",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        placeholder: "e.g. financial fraud, conflicts of interest",
      },
    ],
    prepTemplate: [
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            "Tone: Objective, professional, and dense with information but sparse with \"fluff\" words.\n\n" +
            "Guidelines:\n" +
            "  - Prioritize Utility: Focus on information that helps a user decide: \"Do I need to open the full file?\"\n" +
            "  - Structure: Always start with a 1-sentence \"Bottom Line Up Front\" (BLUF). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "User Prompt",
        fillStrategy: {
          kind: "fill-value",
          value: "Summarize the attached document.",
        },
        role: "text-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
];
```

**Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors

**Step 3: Build**

```bash
npm run build
```

Expected: clean build, no errors

**Step 4: Commit**

```bash
git add src/client/recipes.ts
git commit -m "feat: update document-summarization recipe for journalism use"
```
