# Client Navigation Refactor Design

**Date:** 2026-02-25
**Status:** Approved

## Goals

1. Replace the two-panel, hardcoded-ID toggle approach with a push/pop navigation stack that supports back/forward history across arbitrarily many panels.
2. Give each panel ownership of its own DOM — eliminate global element ID dependencies inside components.
3. Establish a reusable component library (`TagList`, `SingleTagList`, `RowRange`, `LockableField`) with typed `getValue()` interfaces, ready for the Recipes feature.
4. Wrap all `google.script.run` calls in a single `services.ts` module as Promises, making panels independently testable without the GAS callback pattern.
5. Reduce `sidebar-entry.ts` to a thin init function; all logic lives in panel and component classes.

## Out of Scope (deferred)

- Full implementation of the Document Summarization recipe panel (form fields, Prep Recipe server call, Cook flow). The panel is stubbed with placeholder content.
- CRUD for saved recipes. Recipes are loaded from the server as read-only presets.
- The `getRecipes()` services call. Will be added when the Recipes panel is implemented.
- Any CSS additions for `LockableField` or recipe panel layouts.

---

## The Problem with the Current Architecture

`sidebar.ts` and `sidebar-entry.ts` are entangled with a single, fixed HTML structure. Every function reaches into the DOM by hardcoded global ID:

- `buildSingleTagList` grabs `#new-col-input` from outside its container.
- `assembleRunConfig` enumerates a dozen element IDs — it only works because there is exactly one panel active at a time.
- `showAIPanel` / `hideAIPanel` know about exactly two panels.

Adding a third panel would require rewriting all of these. Adding a fourth would require rewriting again. The current structure has no seam for extension.

---

## Navigation Model

A `Router` class maintains a stack of entries:

```
StackEntry { panelId, params?, savedState? }
```

**`router.navigate(panelId, params?)`**
1. Calls `currentPanel.unmount()` → saves returned state into current stack entry.
2. Pushes `{ panelId, params }` onto stack.
3. Mounts new panel with `params`, no `savedState`.

**`router.back()`**
1. Calls `currentPanel.unmount()` → discards returned state (user is abandoning the panel).
2. Pops the top entry.
3. Re-mounts the now-top entry's panel with its `params` and its `savedState`.

This means a panel that was navigated *past* (e.g., Recipes List when the user goes forward to Document Summarization) has its state preserved on the stack. When the user presses Back, it is restored.

### Why not URL-based routing

GAS HtmlService sidebars are not real browser windows. `history.pushState` and hash routing have untested behavior in the sandbox. A simple in-memory stack is predictable, fast, and testable.

### Why teardown on navigate (not hide/show)

Keeping all panels mounted at all times would let DOM state persist naturally, but:
- Memory: every panel's DOM stays alive even when not visible.
- Stale state: panels would need explicit reset logic if re-entered with different params.
- Complexity: CSS would need to hide all but one panel.

Teardown + serialize/restore is slightly more work upfront but cleaner at scale. Panel state is an explicit data structure, not implicit DOM state.

---

## Panel Interface

```ts
interface Panel<P = unknown, S = unknown> {
  mount(container: HTMLElement, nav: NavigationContext, params?: P, savedState?: S): void;
  unmount(): S | undefined;
}
```

**`NavigationContext`** is injected into `mount()` rather than imported directly from the router. This decouples panels from the router module and makes them independently testable with a mock nav object.

```ts
interface NavigationContext {
  navigate(panelId: PanelId, params?: unknown): void;
  back(): void;
  canGoBack(): boolean;
}
```

---

## Dynamic Rendering

`src/Sidebar.html` becomes a minimal shell:

```html
<body>
  <div id="app" class="container"></div>
  {{SCRIPTS}}
</body>
```

Each panel's `mount()` sets `container.innerHTML` to its own template string. This keeps the HTML file permanently small regardless of how many panels are added, and gives each panel full ownership of its DOM.

The build pipeline (Rollup + `inlineSidebarHtml` plugin) is unchanged — it still compiles the client TS entry point and inlines it into the HTML template.

---

## Services Layer

`src/client/services.ts` wraps all `google.script.run` calls as Promises:

```ts
getSheetHeaders(): Promise<string[]>   // cached per sidebar session
invalidateHeaderCache(): void
runBatchAI(config: RunConfig): Promise<void>
runTool(fn: string): Promise<void>
```

**Header cache:** `getSheetHeaders()` caches its result in a module-level variable. The sidebar session is short-lived (a single spreadsheet session) so stale headers are not a concern. This avoids re-fetching on every panel mount.

**Why Promises instead of callbacks:** Panels use `.then()/.catch()` which is cleaner than the `withSuccessHandler/withFailureHandler` chain pattern. Tests mock `services.*` directly with `jest.mock()`, eliminating the need to capture GAS callback references.

---

## Component Design

Components own all the DOM they need. No component reaches outside its container by ID.

| Component | Replaces | Key change |
|---|---|---|
| `TagList` | `buildTagList()` | Class with `getValue()` method instead of stateless function |
| `SingleTagList` | `buildSingleTagList()` | Creates `<input>` for new column internally; no `#new-col-input` global |
| `RowRange` | `handleRowRangeChange()` + inline HTML | Creates radio + inputs internally; `getValue()` returns typed value |
| `LockableField` | (new) | Locked-by-default input/textarea with unlock toggle; used in recipe panels |

### SingleTagList saved state restoration

When a user types a custom column name ("my_output") and saves state, `outputCol: "my_output"` is stored. On restore, `SingleTagList` receives `selected: "my_output"`. Since `"my_output"` does not match any header and `includeNew` is true, the component auto-selects the `__new__` tag and pre-fills the text input. The caller stores only the final value — no separate `"__new__"` sentinel is needed in saved state.

### LockableField

Designed for recipe panels where form fields should show sensible defaults but allow power users to override. Fields are `disabled` by default with an "🔒 Edit" button that toggles editability. Supports both single-line (`<input>`) and multi-line (`<textarea>`) via a `multiline` config option.

---

## File Structure

```
src/client/
  sidebar-entry.ts          ← thin init() only: create Router, start("tool-list")
  router.ts                 ← Router class: navigate(), back(), canGoBack()
  types.ts                  ← PanelId, NavigationContext, Panel<P,S>
  services.ts               ← google.script.run wrappers + header cache
  panels/
    tool-list.ts            ← home panel; dispatches tools and navigates to sub-panels
    configure-ai-run.ts     ← current AI config panel, migrated to new architecture
    recipes-list.ts         ← stub: list of recipe buttons
    recipes/
      document-summarization.ts   ← stub: "Coming soon" placeholder
  components/
    tag-list.ts             ← multi-select tag buttons
    single-tag-list.ts      ← single-select tag buttons + optional new-col input
    row-range.ts            ← row range radio + inputs
    lockable-field.ts       ← locked-by-default field with unlock toggle
  sidebar.css               ← unchanged
  google.d.ts               ← unchanged

src/Sidebar.html            ← minimal shell: <div id="app"> + placeholders only

__tests__/
  router.test.ts
  services.test.ts
  components/
    tag-list.test.ts
    single-tag-list.test.ts
    row-range.test.ts
    lockable-field.test.ts
  panels/
    tool-list.test.ts
    configure-ai-run.test.ts
```

### Deleted files

| File | Reason |
|---|---|
| `src/client/sidebar.ts` | All logic moves to components and panels |
| `__tests__/sidebar.test.ts` | Replaced by component tests |
| `__tests__/sidebar-entry.test.ts` | Replaced by panel tests |
| `__tests__/helpers/sidebar-fixtures.ts` | `FULL_SIDEBAR_HTML` is no longer meaningful; panel tests mount their own DOM |

---

## Testing Strategy

### Panels

Each panel is tested by:
1. Mounting into a fresh `<div>` with a mock `NavigationContext`.
2. Asserting DOM state after mount.
3. Simulating user interactions (button clicks, form fills).
4. Asserting calls to mock `services.*` functions and `nav.*` callbacks.
5. Calling `unmount()` and asserting the returned saved state.

`services.ts` is mocked via `jest.mock()` so panel tests never touch `google.script.run`.

### Components

Component tests mount into a fresh container and assert DOM structure, interaction behavior, and `getValue()` return values. No GAS mocking needed.

### Router

Router tests use lightweight mock panels (plain objects implementing the `Panel` interface) and assert stack behavior — that `savedState` is preserved correctly on navigate/back, that the right panel's `mount()` is called with the right arguments, etc.

### Coverage

`src/client/sidebar-entry.ts` is excluded from coverage collection (it contains only `init()` which is untestable for the same reasons as the previous version). All other new client files have per-file thresholds in `jest.config.cjs`.

---

## Anticipated Future Work

When the Document Summarization panel is implemented, it will:

1. Add a `getRecipes()` call to `services.ts` (server stores recipe definitions in Script Properties).
2. Implement the full `DocumentSummarizationPanel` with `LockableField` components for system prompt, user prompt, and output column.
3. Add a `prepRecipe(params)` call to `services.ts` for the Prep Recipe server operation.
4. On Cook: call `nav.navigate("configure-ai-run", assembledRunConfig)` — Configure AI Run receives the preset and opens prepopulated.

The navigation stack for the full Document Summarization flow:
```
[tool-list] → [recipes-list] → [document-summarization] → [configure-ai-run]
```
Back from Configure AI Run restores Document Summarization with `prepComplete: true` in saved state, keeping Cook enabled.
