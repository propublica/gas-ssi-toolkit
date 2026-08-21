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

- `loadHeaders()`'s `getSheetHeaders()` call becomes `Promise.all([getSheetHeaders(), getDefaultRowRange().catch(() => undefined)])` — a failure fetching the default must never block the panel from loading, since it's a convenience, not a requirement. The resolved value is destructured directly from the `Promise.all` result (`([headers, defaultRowRange]) => ...`) rather than stored on a field, since it's only ever needed at the point `RowRange` is constructed, in the same callback.
- Construction: `new RowRange(container.querySelector("#row-range-container")!, { selected: preset.rowRange, fallback: defaultRowRange })`.
- Refresh already re-runs `loadHeaders()`, so the fallback refetches naturally on every refresh — no caching needed, the cost is one cheap `sheet.getLastRow()` call server-side.

### `src/client/panels/extract-text.ts`

Deliberately different from `ConfigureAIRunPanel`: this panel constructs `RowRange` once, outside its `loadHeaders()`/header-loading chain entirely, so `getDefaultRowRange()` is fetched as its own fully independent promise — never combined with `getSheetHeaders()` via `Promise.all`. (`Promise.all` would work here too, but combining two promises this way costs extra JavaScript microtask ticks before the combined result is ready, which would have required loosening several existing tests' timing assumptions in this panel's test suite for no benefit, since nothing here needs the two values together.)

- `getDefaultRowRange().then(buildRowRange, () => buildRowRange(undefined))`, where `buildRowRange(defaultRowRange?: RowRangeValue)` constructs `RowRange` with `{ selected: savedRowRange, fallback: defaultRowRange }`. Using a single `.then()` with both handlers (rather than a chained `.catch().then()`) keeps this to the same one-microtask-tick timing as the panel's existing `getSheetHeaders()` chain.
- Construction: `new RowRange(container.querySelector("#row-range")!, { selected: savedRowRange, fallback: defaultRowRange })`.

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
