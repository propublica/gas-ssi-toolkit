# Gemini Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce Google Search as the first Gemini grounding tool, with type infrastructure that accommodates future grounding and function-calling tools.

**Architecture:** `ToolId` (shared string union) is the boundary between client and server. The client renders `TOOL_CATALOG` (display metadata) in a sidebar TagList. The server resolves tool IDs via `TOOL_REGISTRY` (a `Record<ToolId, GeminiTool>` discriminated union) inside `buildGeminiPayload`, which assembles the correct Gemini REST API payload shapes for grounding vs. function-calling entries.

**Design doc:** `docs/plans/2026-03-04-gemini-tools-design.md`

**Tech Stack:** TypeScript, Jest/ts-jest, Google Apps Script (GAS), Rollup, jsdom (client tests)

**Worktree:** `.worktrees/feature/gemini-tools` on branch `feature/gemini-tools`

---

## Task 1: Create `src/server/types.ts`

Move all server-only Gemini/config types out of `shared/types.ts`. These types never cross the client↔server boundary and don't belong in shared.

**Files:**
- Create: `src/server/types.ts`

**Step 1: Create the file with moved types**

`GeminiRequest.tools` changes from `GeminiFunctionDeclaration[]` to `ToolId[]` here (forward-compatible — `ToolId` will be added in Task 2, so use a temporary `string[]` placeholder for now if needed, or do Tasks 1 and 2 together).

```ts
/**
 * Server-only types. Never imported by client code.
 *
 * GeminiTool is an internal discriminated union used by buildGeminiPayload
 * to split tool IDs into the correct Gemini REST API payload shapes.
 * Grounding tools produce { google_search: {} } entries; function-calling
 * tools produce { function_declarations: [...] } entries — both in the same
 * tools array, but with different structures.
 */

import type { ToolId } from "../shared/types";

export interface AppConfig {
  API_KEY_PROPERTY: string;
  MODEL_NAME: string;
  MAX_FILE_SIZE_BYTES: number;
}

export interface GeminiInlineData {
  mime_type: string;
  data: string; // base64-encoded bytes
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>; // JSON Schema object
}

export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

/**
 * Internal discriminated union. Not exported — only buildGeminiPayload acts on kind.
 * Lives here (rather than in api.ts) so TOOL_REGISTRY can reference it.
 */
export type GeminiTool =
  | { kind: "grounding"; id: ToolId }
  | { kind: "function"; declaration: GeminiFunctionDeclaration };

export interface GeminiRequest {
  apiKey: string;
  modelName?: string; // defaults to CONFIG.MODEL_NAME if omitted
  systemPrompt?: string;
  userTexts: string[]; // assembled into parts: [{text}, {text}, ...]
  inlineData?: GeminiInlineData[]; // each item appended as an inline_data part
  /** Tool IDs to enable. Resolved against TOOL_REGISTRY in buildGeminiPayload. */
  tools?: ToolId[];
  generationConfig?: GeminiGenerationConfig;
}
```

**Step 2: Run typecheck to verify the new file is valid**

```bash
npm run typecheck
```

Expected: errors about missing `ToolId` import (not added yet). That's fine — we'll fix in Task 2. OR add a temporary `type ToolId = string` stub at the top of this file and remove it in Task 2.

**Step 3: Commit**

```bash
git add src/server/types.ts
git commit -m "feat: add server/types.ts with Gemini API types and GeminiTool union"
```

---

## Task 2: Update `src/shared/types.ts`

Add `ToolId`, add `tools?: ToolId[]` to `RunConfig`/`PrepRecipeParams`/`PrepRecipeResult`, and remove types that now live in `server/types.ts` or `client/types.ts`.

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Rewrite shared/types.ts**

```ts
/**
 * Shared types for the SSI Toolkit.
 *
 * IMPORTANT: This file is the client↔server RPC boundary.
 * Only types that cross google.script.run calls belong here.
 * - Server-only types (Gemini API shapes, AppConfig): src/server/types.ts
 * - Client-only types (UI, panels, recipes): src/client/types.ts
 */

// ── Tool vocabulary ─────────────────────────────────────────────

/**
 * All tool IDs recognized by the toolkit.
 * Extend this union when adding a new tool — the compiler will then
 * require a matching entry in TOOL_REGISTRY (server/tools.ts)
 * and TOOL_CATALOG (client/tools.ts).
 */
export type ToolId = "google_search";

// ── Configuration ───────────────────────────────────────────────

export interface RunConfig {
  userPromptCols: string[];
  driveFileCols?: string[];
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
  /** Tool IDs to enable for every row in this run. */
  tools?: ToolId[];
}

// ── Recipes ─────────────────────────────────────────────────────

export interface PrepRecipeParams {
  driveFolder?: { url: string; colTitle: string };
  systemPrompt?: { colTitle: string; value: string };
  userPrompts?: Array<{ colTitle: string; value: string }>;
  outputCol?: { colTitle: string };
  /**
   * Tool IDs to pass through to PrepRecipeResult.
   * The server does not process these during prep — they are echoed back
   * to preserve the single-source-of-truth invariant for preppedRunConfig.
   */
  tools?: ToolId[];
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  colNames: {
    driveLink?: string;
    systemPrompt?: string;
    userPrompts?: string[];
    outputCol?: string;
  };
  /** Echoed from PrepRecipeParams — no server-side processing. */
  tools?: ToolId[];
}
```

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: many errors about missing imports (files that imported the removed types from shared). That's expected — we'll fix them in Task 3 and Task 4.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ToolId to shared types, add tools field to RunConfig/PrepRecipeParams/PrepRecipeResult"
```

---

## Task 3: Update `src/client/types.ts`

Move `RecipeParams` and `RecipeFieldConfig` here from `shared/types.ts`.

**Files:**
- Modify: `src/client/types.ts`

**Step 1: Add RecipeParams and RecipeFieldConfig**

Open `src/client/types.ts` and add at the top (before the existing PanelId type):

```ts
// ── Recipe UI types ─────────────────────────────────────────────
// These are client-only — they define sidebar form structure, not RPC payloads.

export interface RecipeFieldConfig {
  value: string;
  locked?: boolean; // defaults to true
  placeholder?: string;
}

export interface RecipeParams {
  driveFolder?: {
    colTitle: string;
    helperText?: string;
  };
  systemPrompt?: {
    colTitle: RecipeFieldConfig;
    prompt: RecipeFieldConfig;
  };
  userPrompts?: Array<{
    colTitle: RecipeFieldConfig;
    prompt: RecipeFieldConfig;
  }>;
  outputCol?: {
    colTitle: RecipeFieldConfig;
  };
}
```

**Step 2: Run typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add src/client/types.ts
git commit -m "refactor: move RecipeParams and RecipeFieldConfig to client/types.ts"
```

---

## Task 4: Fix all broken imports across the codebase

After moving types, all files that imported from `shared/types` need their import paths corrected.

**Files to update:**

- `src/server/config.ts` — imports `AppConfig` from `../shared/types` → change to `./types`
- `src/server/api.ts` — imports `GeminiInlineData`, `GeminiRequest` from `../shared/types` → change to `./types`
- `src/server/tools.ts` — imports `GeminiFunctionDeclaration` from `../shared/types` → change to `./types`
- `src/server/inference.ts` — imports `GeminiInlineData` from `../shared/types` → change to `./types`
- `src/server/index.ts` — imports `RunConfig`, `PrepRecipeParams`, `PrepRecipeResult` from `../shared/types` → keep (still in shared). Remove any import of moved types.
- `src/client/panels/recipe.ts` — imports `RecipeParams` from `../../shared/types` → change to `../types`
- `src/client/recipes.ts` — imports `RecipeParams` from `../shared/types` → check and update
- `__tests__/api.test.ts` — imports `GeminiRequest` from `../src/shared/types` → change to `../src/server/types`

**Step 1: Update each file's imports one at a time**

For each file, open it, find the import from `shared/types`, and reroute to the correct location. Use `npm run typecheck` after each file to catch mistakes immediately.

**Step 2: Run typecheck until clean**

```bash
npm run typecheck
```

Expected: 0 errors.

**Step 3: Run tests**

```bash
npm test
```

Expected: all 196 tests pass (no logic changed).

**Step 4: Commit**

```bash
git add -p   # stage import changes file by file
git commit -m "refactor: fix imports after type reorganization"
```

---

## Task 5: Update `src/server/tools.ts`

Replace the old `Record<string, GeminiFunctionDeclaration>` registry with the new unified `Record<ToolId, GeminiTool>` registry.

**Files:**
- Modify: `src/server/tools.ts`

**Step 1: Write a failing test first**

The existing test in `__tests__/customFunctions.test.ts` at line 110-117 mutates `TOOL_REGISTRY` directly:

```ts
TOOL_REGISTRY["testTool"] = { name: "testTool", description: "A test tool" };
```

This will break because `TOOL_REGISTRY` no longer accepts arbitrary string keys. First, update that test to verify grounding tool support instead. Open `__tests__/customFunctions.test.ts` and replace the `toolNames` describe block:

```ts
describe("toolNames", () => {
  it("returns an error string for an unknown tool name", () => {
    const result = SSI("prompt", undefined, "nonExistentTool");
    expect(result).toMatch(/\[SSI Error:.*nonExistentTool/);
  });

  it("includes google_search in the API payload when specified", () => {
    mockOkResponse("ok");
    SSI("prompt", undefined, "google_search");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    // google_search is a grounding tool — appears as { google_search: {} }
    expect(payload.tools).toBeDefined();
    expect(payload.tools[0]).toHaveProperty("google_search");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/customFunctions.test.ts -t "toolNames"
```

Expected: FAIL — `TOOL_REGISTRY` still has the old shape.

**Step 3: Rewrite server/tools.ts**

```ts
/**
 * server/tools.ts — Unified tool registry.
 *
 * Maps every ToolId to its Gemini payload construction data.
 * Record<ToolId, GeminiTool> enforces at compile time that every ToolId
 * has a matching server implementation — adding a new ToolId without a
 * registry entry is a type error.
 *
 * To add a new tool:
 * 1. Add its ID to ToolId in src/shared/types.ts
 * 2. Add an entry here
 * 3. Add a display entry to TOOL_CATALOG in src/client/tools.ts
 */

import type { ToolId } from "../shared/types";
import type { GeminiTool } from "./types";

export const TOOL_REGISTRY: Record<ToolId, GeminiTool> = {
  google_search: { kind: "grounding", id: "google_search" },
};
```

**Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: errors in `customFunctions.ts` and `api.ts` which reference the old registry shape — fix those in Tasks 6 and 7.

**Step 5: Run the toolNames tests**

```bash
npx jest __tests__/customFunctions.test.ts -t "toolNames"
```

Hold off — the `SSI` function and `buildGeminiPayload` need updating too (Tasks 7 and 8). For now, commit the registry change.

**Step 6: Commit**

```bash
git add src/server/tools.ts __tests__/customFunctions.test.ts
git commit -m "feat: replace TOOL_REGISTRY with unified Record<ToolId, GeminiTool>"
```

---

## Task 6: Create `src/client/tools.ts`

New file — client-side tool catalog for populating the sidebar TagList.

**Files:**
- Create: `src/client/tools.ts`

**Step 1: Write a failing test**

Create `__tests__/client/tools.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { TOOL_CATALOG } from "../../src/client/tools";
import type { ToolId } from "../../src/shared/types";

describe("TOOL_CATALOG", () => {
  it("contains an entry for every ToolId", () => {
    // If a ToolId is added to shared/types.ts but not TOOL_CATALOG, this test fails.
    const knownIds: ToolId[] = ["google_search"];
    const catalogIds = TOOL_CATALOG.map((t) => t.id);
    expect(catalogIds).toEqual(expect.arrayContaining(knownIds));
    expect(TOOL_CATALOG).toHaveLength(knownIds.length);
  });

  it("each entry has id, name, and description", () => {
    for (const entry of TOOL_CATALOG) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("google_search entry has expected display values", () => {
    const entry = TOOL_CATALOG.find((t) => t.id === "google_search");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("Google Search");
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx jest __tests__/client/tools.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create the file**

```ts
/**
 * client/tools.ts — Client-side tool catalog.
 *
 * Provides display metadata for tools shown in the sidebar TagList.
 * Hardcoded at build time — the tool list is static compiled code,
 * not user data, so no RPC is needed to populate it.
 *
 * When adding a new tool:
 * 1. Add its ID to ToolId in src/shared/types.ts
 * 2. Add a matching entry to TOOL_REGISTRY in src/server/tools.ts
 * 3. Add a display entry here
 */

import type { ToolId } from "../shared/types";

/**
 * Display metadata for a tool shown in the sidebar TagList.
 * Contains only what the client needs — no payload or kind information.
 */
export interface ToolCatalogEntry {
  id: ToolId;
  name: string;
  description: string;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "google_search",
    name: "Google Search",
    description: "Ground responses in live web search results",
  },
];
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/client/tools.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/client/tools.ts __tests__/client/tools.test.ts
git commit -m "feat: add client/tools.ts with TOOL_CATALOG and ToolCatalogEntry"
```

---

## Task 7: Update `buildGeminiPayload` in `src/server/api.ts`

Change tool handling: `tools` is now `ToolId[]`. `buildGeminiPayload` resolves IDs via `TOOL_REGISTRY`, splits by kind, and assembles the correct Gemini payload shapes.

**Files:**
- Modify: `src/server/api.ts`
- Modify: `__tests__/api.test.ts`

**Step 1: Update the existing tools test and add new ones**

In `__tests__/api.test.ts`, the existing test at line 93-100 passes `GeminiFunctionDeclaration` objects directly. Replace it with tests for the new ToolId-based approach:

```ts
describe("tool resolution in buildGeminiPayload", () => {
  it("omits tools key when tools array is absent", () => {
    const payload = buildGeminiPayload(baseReq);
    expect(payload.tools).toBeUndefined();
  });

  it("omits tools key when tools array is empty", () => {
    const payload = buildGeminiPayload({ ...baseReq, tools: [] });
    expect(payload.tools).toBeUndefined();
  });

  it("assembles a grounding tool entry for google_search", () => {
    const payload = buildGeminiPayload({ ...baseReq, tools: ["google_search"] });
    const tools = payload.tools as unknown[];
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({ google_search: {} });
  });
});
```

Also update the `baseReq` type import at line 24: change from `../src/shared/types` to `../src/server/types`.

**Step 2: Run to verify the new tests fail**

```bash
npx jest __tests__/api.test.ts -t "tool resolution"
```

Expected: FAIL.

**Step 3: Update `src/server/api.ts`**

Update the import at the top — `GeminiInlineData` and `GeminiRequest` now come from `./types`:

```ts
import { CONFIG } from "./config";
import { TOOL_REGISTRY } from "./tools";
import type { GeminiInlineData, GeminiRequest } from "./types";
```

Replace the tools section of `buildGeminiPayload` (currently lines 37-39):

```ts
  if (req.tools && req.tools.length > 0) {
    const entries = req.tools.map((id) => TOOL_REGISTRY[id]);

    const groundingEntries = entries
      .filter((t): t is Extract<typeof t, { kind: "grounding" }> => t.kind === "grounding")
      .map((t) => ({ [t.id]: {} }));

    const functionDeclarations = entries
      .filter((t): t is Extract<typeof t, { kind: "function" }> => t.kind === "function")
      .map((t) => t.declaration);

    const toolsPayload = [
      ...groundingEntries,
      ...(functionDeclarations.length ? [{ function_declarations: functionDeclarations }] : []),
    ];

    payload.tools = toolsPayload;
  }
```

**Step 4: Run all tests**

```bash
npm test
```

Expected: all tests pass. (The `customFunctions.ts` tests may still fail until Task 8.)

**Step 5: Commit**

```bash
git add src/server/api.ts __tests__/api.test.ts
git commit -m "feat: update buildGeminiPayload to resolve ToolId[] via TOOL_REGISTRY"
```

---

## Task 8: Update `src/server/customFunctions.ts`

`SSI` previously resolved `GeminiFunctionDeclaration` objects from `TOOL_REGISTRY`. Now it validates that the tool ID exists and passes IDs straight through to `invokeGemini`. All tool types (grounding + function) are allowed.

**Files:**
- Modify: `src/server/customFunctions.ts`

**Step 1: Run the existing toolNames tests to confirm current failure**

```bash
npx jest __tests__/customFunctions.test.ts -t "toolNames"
```

Expected: FAIL (registry shape mismatch from Task 5).

**Step 2: Update `src/server/customFunctions.ts`**

Replace the tool resolution block in the `SSI` function body. The new logic validates existence and passes IDs through:

```ts
import { invokeGemini } from "./api";
import { flattenArg } from "./utils";
import { TOOL_REGISTRY } from "./tools";
import type { ToolId } from "../shared/types";

export { TOOL_REGISTRY };

export function SSI(userTexts: unknown, systemPrompt?: string, toolNames?: unknown): string {
  try {
    const resolvedToolIds = flattenArg(toolNames).map((name) => {
      if (!TOOL_REGISTRY[name as ToolId]) throw new Error(`unknown tool '${name}'`);
      return name as ToolId;
    });

    return invokeGemini({
      systemPrompt: systemPrompt || undefined,
      userTexts: flattenArg(userTexts),
      tools: resolvedToolIds.length ? resolvedToolIds : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[SSI Error: ${msg}]`;
  }
}
```

**Step 3: Run the customFunctions tests**

```bash
npx jest __tests__/customFunctions.test.ts
```

Expected: all pass.

**Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/customFunctions.ts
git commit -m "feat: update SSI to validate ToolId and support all tool types"
```

---

## Task 9: Update `src/server/inference.ts`

Add `tools?: ToolId[]` parameter and pass it through to `invokeGemini`.

**Files:**
- Modify: `src/server/inference.ts`
- Modify: `__tests__/inference.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/inference.test.ts` inside the `describe("runInference")` block:

```ts
it("passes tools to the payload when provided", () => {
  mockOkResponse("ok");
  runInference("prompt", undefined, undefined, ["google_search"]);
  const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
  expect(payload.tools).toBeDefined();
  expect(payload.tools[0]).toHaveProperty("google_search");
});

it("omits tools from the payload when not provided", () => {
  mockOkResponse("ok");
  runInference("prompt");
  const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
  expect(payload.tools).toBeUndefined();
});
```

**Step 2: Run to verify they fail**

```bash
npx jest __tests__/inference.test.ts -t "tools"
```

Expected: FAIL — `runInference` only accepts 3 parameters.

**Step 3: Update `src/server/inference.ts`**

Add the `tools` parameter and pass it to `invokeGemini`. Also update the import to get `GeminiInlineData` from `./types`:

```ts
import { invokeGemini } from "./api";
import { fetchAndEncodeFile } from "./drive";
import { flattenArg, isValidDriveLink, extractId } from "./utils";
import type { GeminiInlineData } from "./types";
import type { ToolId } from "../shared/types";

export function runInference(
  userPrompts: unknown,
  driveLinks?: unknown,
  systemPrompt?: unknown,
  tools?: ToolId[],
): string | null {
  const userTexts = flattenArg(userPrompts);
  if (userTexts.length === 0) return null;

  try {
    const inlineData: GeminiInlineData[] =
      driveLinks !== undefined
        ? flattenArg(driveLinks)
            .filter(isValidDriveLink)
            .map((link) => fetchAndEncodeFile(extractId(link)))
        : [];

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
      tools: tools?.length ? tools : undefined,
    });
  } catch (e) {
    return "Error: " + (e as Error).message;
  }
}
```

**Step 4: Run inference tests**

```bash
npx jest __tests__/inference.test.ts
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/inference.ts __tests__/inference.test.ts
git commit -m "feat: add tools parameter to runInference"
```

---

## Task 10: Update `src/server/index.ts`

Pass `config.tools` to `runInference` in `runBatchAI`, and echo tools through in `prepRecipe`.

**Files:**
- Modify: `src/server/index.ts`

**Step 1: Update `runBatchAI`**

Find the `runInference` call in `runBatchAI` (around line 317) and add the fourth argument:

```ts
const result = runInference(userPrompts, driveLinks, systemPrompt, config.tools);
```

**Step 2: Update `prepRecipe`**

Find the return statement at the bottom of `prepRecipe` and add `tools`:

```ts
return {
  rowRange: { start: 2, end: 2 + numRows - 1 },
  colNames,
  tools: params.tools,
};
```

**Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

**Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: thread tools through runBatchAI and prepRecipe"
```

---

## Task 11: Extend `TagList` to support label/value items

`TagList` currently renders string items where display text equals stored value. Tools need to display `name` ("Google Search") but store `id` ("google_search"). Extend the constructor to accept either format — existing callers are unaffected.

**Files:**
- Modify: `src/client/components/tag-list.ts`
- Modify: `__tests__/components/tag-list.test.ts`

**Step 1: Write failing tests**

Add to `__tests__/components/tag-list.test.ts`:

```ts
describe("label/value items", () => {
  it("displays label as textContent but stores value in data-value", () => {
    const c = makeContainer();
    new TagList(c, [{ label: "Google Search", value: "google_search" }]);
    const tag = c.querySelector<HTMLButtonElement>(".tag")!;
    expect(tag.textContent).toBe("Google Search");
    expect(tag.getAttribute("data-value")).toBe("google_search");
  });

  it("getValue() returns value (not label) for label/value items", () => {
    const c = makeContainer();
    const list = new TagList(c, [{ label: "Google Search", value: "google_search" }]);
    c.querySelector<HTMLButtonElement>('[data-value="google_search"]')!.click();
    expect(list.getValue()).toEqual(["google_search"]);
  });

  it("pre-selects by value when using label/value items", () => {
    const c = makeContainer();
    new TagList(c, [{ label: "Google Search", value: "google_search" }], ["google_search"]);
    const selected = c.querySelectorAll(".tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("google_search");
  });

  it("mixed string and label/value items render correctly", () => {
    const c = makeContainer();
    const list = new TagList(
      c,
      ["col_a", { label: "Google Search", value: "google_search" }],
      ["col_a", "google_search"],
    );
    expect(list.getValue()).toEqual(["col_a", "google_search"]);
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx jest __tests__/components/tag-list.test.ts -t "label/value"
```

Expected: FAIL — constructor only accepts `string[]`.

**Step 3: Update `src/client/components/tag-list.ts`**

```ts
type TagItem = string | { label: string; value: string };

function normalize(item: TagItem): { label: string; value: string } {
  return typeof item === "string" ? { label: item, value: item } : item;
}

export class TagList {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement, items: TagItem[], selected: string[] = []) {
    this.container = container;
    this.render(items, selected);
  }

  private render(items: TagItem[], selected: string[]): void {
    this.container.innerHTML = "";
    items.forEach((item) => {
      const { label, value } = normalize(item);
      const btn = document.createElement("button");
      btn.className = "tag";
      btn.type = "button";
      btn.textContent = label;
      btn.setAttribute("data-value", value);
      if (selected.includes(value)) btn.classList.add("selected");
      btn.addEventListener("click", () => btn.classList.toggle("selected"));
      this.container.appendChild(btn);
    });
  }

  getValue(): string[] {
    return Array.from(this.container.querySelectorAll<HTMLButtonElement>(".tag.selected"))
      .map((t) => t.getAttribute("data-value") ?? "")
      .filter(Boolean);
  }
}
```

**Step 4: Run all TagList tests**

```bash
npx jest __tests__/components/tag-list.test.ts
```

Expected: all pass (old tests + new tests).

**Step 5: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/client/components/tag-list.ts __tests__/components/tag-list.test.ts
git commit -m "feat: extend TagList to support label/value items alongside plain strings"
```

---

## Task 12: Update `ConfigureAIRunPanel` to add tools TagList

Add the tools field group to the template, populate it synchronously from `TOOL_CATALOG`, update `assembleRunConfig`, and update `SavedState`.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `__tests__/panels/configure-ai-run.test.ts`

**Step 1: Read the existing configure-ai-run test**

Open `__tests__/panels/configure-ai-run.test.ts` to understand the existing test setup before adding new tests.

**Step 2: Add failing tests**

Look for how the test sets up `document.body.innerHTML` and add:

```ts
describe("tools TagList", () => {
  it("renders a tools field group in the template", () => {
    // mount the panel and check the tools-list container exists
    const container = document.createElement("div");
    const nav = { navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
    panel.mount(container, nav as any);
    expect(container.querySelector("#tools-list")).not.toBeNull();
  });

  it("populates tools from TOOL_CATALOG (not from headers RPC)", () => {
    const container = document.createElement("div");
    const nav = { navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
    panel.mount(container, nav as any);
    // Tools tags should be present immediately (synchronous, no await needed)
    const tags = container.querySelectorAll("#tools-list .tag");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0].getAttribute("data-value")).toBe("google_search");
    expect(tags[0].textContent).toBe("Google Search");
  });

  it("includes selected tool IDs in assembleRunConfig output", () => {
    // mount, select google_search tag, click run — verify runBatchAI called with tools
    // (follow the existing pattern in configure-ai-run.test.ts for how run is triggered)
  });
});
```

Adapt the test structure to match the existing test patterns in the file.

**Step 3: Run to verify they fail**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts -t "tools TagList"
```

Expected: FAIL.

**Step 4: Update `src/client/panels/configure-ai-run.ts`**

Add the import:
```ts
import { TOOL_CATALOG } from "../tools";
import type { ToolId } from "../../shared/types";
```

Add the class field:
```ts
private toolsList: TagList | null = null;
```

Update `SavedState` type to include `tools`:
```ts
export type SavedState = Required<Omit<RunConfig, "rowRange">> & Pick<RunConfig, "rowRange">;
// tools?: ToolId[] becomes tools: ToolId[] via Required — handled below
```

In the `mount` method, populate tools synchronously right after `container.innerHTML = this.template()`:
```ts
this.toolsList = new TagList(
  container.querySelector("#tools-list")!,
  TOOL_CATALOG.map((t) => ({ label: t.name, value: t.id })),
  preset.tools ?? [],
);
```

In `unmount()`, add:
```ts
tools: (this.toolsList?.getValue() ?? []) as ToolId[],
```

In `assembleRunConfig()`, add:
```ts
const tools = (this.toolsList?.getValue() ?? []) as ToolId[];
// in the return:
tools: tools.length > 0 ? tools : undefined,
```

In `template()`, add the field group after output-col and before row-range-container:
```html
<div class="field-group">
  <span class="field-label">Tools <span class="optional">(optional)</span></span>
  <div id="tools-list" class="tag-list"></div>
</div>
```

**Step 5: Run configure-ai-run tests**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

Expected: all pass.

**Step 6: Run full test suite**

```bash
npm test
```

Expected: all pass.

**Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

**Step 8: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: add tools TagList to ConfigureAIRunPanel"
```

---

## Final: Verify and clean up

**Step 1: Run full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all thresholds pass.

**Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

**Step 3: Run build to confirm Rollup is happy**

```bash
npm run build
```

Expected: clean build, `dist/` updated.

**Step 4: Final commit if anything was tidied**

```bash
git add -p
git commit -m "chore: post-feature cleanup"
```
