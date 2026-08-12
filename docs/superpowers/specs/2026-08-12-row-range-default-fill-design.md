# Row Range Default Fill — Design

## Purpose

`getDefaultRowRange()` (server export → RPC boundary → `services.ts` wrapper) was built in the Guided AI Inference server-architecture work but has no consumer yet — it was scoped for a future guided-flow client panel. This session wires it into the two existing panels that already have a `RowRange` component with the same UX gap: when a user switches from "Use highlighted rows" to "Specify range," the Start/End inputs start blank, forcing them to go figure out the sheet's actual row count themselves before typing anything in.

## Scope

Two panels get the same treatment, since both already share the `RowRange` component and the same async-mount-then-render pattern:

- **`ConfigureAIRunPanel`** ("Run AI Inference," the freeform panel)
- **`ExtractTextPanel`** ("Extract Text")

**Explicitly unchanged:** "Use highlighted rows" stays the default mode in both panels — nothing about this design changes which radio is checked on a fresh mount, only what values sit in the (initially hidden) Specify-range inputs before the user has typed anything. `sanitizeRowRange` and `RowRange.getValue()` are untouched.

## Design

### `src/client/components/row-range.ts`

The constructor's second parameter changes from a single `RowRangeValue | undefined` to an options object, because this component now needs two independent optional inputs of the same shape and a bare second positional `RowRangeValue` would make call sites ambiguous about which value does what:

```ts
export interface RowRangeOptions {
  /** The current value. Presence of this determines which radio is checked and pre-fills the inputs. */
  selected?: RowRangeValue;
  /** Used only when `selected` is absent — pre-fills the (hidden) Specify-range inputs' values without changing which mode is checked. */
  fallback?: RowRangeValue;
}

constructor(container: HTMLElement, options?: RowRangeOptions)
```

`render()`'s existing `if (selected) startInput.value = ...` logic becomes: use `selected` if present; otherwise, if `fallback` is present, pre-fill from that instead (still without checking the range radio). If neither is present, inputs stay blank exactly as today. `getValue()` is unchanged — it already just reads whatever's in the inputs, regardless of how they got there.

### `src/client/panels/configure-ai-run.ts`

- `loadHeaders()`'s `getSheetHeaders()` call becomes `Promise.all([getSheetHeaders(), getDefaultRowRange().catch(() => undefined)])` — a failure fetching the default must never block the panel from loading, since it's a convenience, not a requirement.
- New field: `private defaultRowRange: RowRangeValue | undefined`.
- Construction: `new RowRange(container.querySelector("#row-range-container")!, { selected: preset.rowRange, fallback: this.defaultRowRange })`.
- Refresh already re-runs `loadHeaders()`, so the fallback refetches naturally on every refresh — no caching needed, the cost is one cheap `sheet.getLastRow()` call server-side.

### `src/client/panels/extract-text.ts`

Same pattern, applied to its own `loadHeaders()`:

- `Promise.all([getSheetHeaders(), getDefaultRowRange().catch(() => undefined)])`.
- New field: `private defaultRowRange: RowRangeValue | undefined`.
- Construction: `new RowRange(container.querySelector("#row-range")!, { selected: savedRowRange, fallback: this.defaultRowRange })`.

### `src/client/services.ts`

No change — `getDefaultRowRange()` already exists from the prior session's work.

## Error handling

`getDefaultRowRange()` rejecting (network error, etc.) is swallowed via `.catch(() => undefined)` at the call site in both panels, exactly the same as how a missing default today just leaves the inputs blank — a fetch failure degrades to today's behavior, not a new failure mode.

## Testing

- `__tests__/components/row-range.test.ts`: update all 7 existing construction call sites to the options-object form; add cases for (a) `fallback` pre-fills the inputs when `selected` is absent, (b) `fallback` is ignored when `selected` is present, (c) no crash when neither is given (today's behavior).
- `__tests__/panels/configure-ai-run.test.ts`: add `getDefaultRowRange` to the `services` mock (currently only `getSheetHeaders`/`runBatchAI`/`getActiveRangeInfo`/`getJobProgress`); add a test confirming the fetched value reaches `RowRange` as `fallback` and a test confirming a rejected `getDefaultRowRange()` doesn't block header loading.
- `__tests__/panels/extract-text.test.ts`: same two additions, adapted to that panel's mount flow.

## Out of scope

- Any change to the freeform panel's or Extract Text's default *mode* (both stay "Use highlighted rows" by default).
- The guided-flow client panel `getDefaultRowRange` was originally built for — still a future session's work.
- Surfacing the fallback value anywhere in the UI before the user switches to "Specify range" (e.g. as helper text under "Use highlighted rows") — not requested, would be new UI copy work beyond this design's scope.
