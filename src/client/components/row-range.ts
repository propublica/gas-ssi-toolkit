export interface RowRangeValue {
  start: number;
  end: number;
}

export interface RowRangeOptions {
  /** The current value. Presence of this determines which radio is checked and pre-fills the inputs. */
  selected?: RowRangeValue;
  /** Used only when `selected` is absent — pre-fills the (hidden) Specify-range inputs' values without changing which mode is checked. */
  fallback?: RowRangeValue;
}

// Never lets a run start on the header row; returns null if nothing valid remains.
export function sanitizeRowRange(range: RowRangeValue): RowRangeValue | null {
  const start = Math.max(range.start, 2);
  return start <= range.end ? { start, end: range.end } : null;
}

export class RowRange {
  private static instanceCount = 0;
  private readonly container: HTMLElement;
  private startInput: HTMLInputElement;
  private endInput: HTMLInputElement;
  private rangeRadio: HTMLInputElement;

  constructor(container: HTMLElement, options?: RowRangeOptions) {
    this.container = container;
    const groupName = `row-range-${RowRange.instanceCount++}`;
    const refs = this.render(options, groupName);
    this.startInput = refs.startInput;
    this.endInput = refs.endInput;
    this.rangeRadio = refs.rangeRadio;
  }

  private render(
    options: RowRangeOptions | undefined,
    groupName: string,
  ): {
    startInput: HTMLInputElement;
    endInput: HTMLInputElement;
    rangeRadio: HTMLInputElement;
  } {
    const selected = options?.selected;
    const prefill = selected ?? options?.fallback;

    this.container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "row-range-options";

    const selLabel = document.createElement("label");
    const selRadio = document.createElement("input");
    selRadio.type = "radio";
    selRadio.name = groupName;
    selRadio.value = "selection";
    selRadio.checked = !selected;
    selLabel.append(selRadio, " Use highlighted rows");

    const rangeLabel = document.createElement("label");
    const rangeRadio = document.createElement("input");
    rangeRadio.type = "radio";
    rangeRadio.name = groupName;
    rangeRadio.value = "range";
    rangeRadio.checked = !!selected;
    rangeLabel.append(rangeRadio, " Specify range");

    const rangeInputs = document.createElement("div");
    rangeInputs.className = "range-inputs";
    rangeInputs.style.display = selected ? "flex" : "none";

    const startInput = document.createElement("input");
    startInput.type = "number";
    startInput.placeholder = "Start row";
    startInput.min = "2";
    if (prefill) startInput.value = String(prefill.start);

    const endInput = document.createElement("input");
    endInput.type = "number";
    endInput.placeholder = "End row";
    endInput.min = "2";
    if (prefill) endInput.value = String(prefill.end);

    rangeInputs.append(startInput, endInput);
    wrapper.append(selLabel, rangeLabel, rangeInputs);
    this.container.appendChild(wrapper);

    const toggle = (): void => {
      rangeInputs.style.display = rangeRadio.checked ? "flex" : "none";
    };
    selRadio.addEventListener("change", toggle);
    rangeRadio.addEventListener("change", toggle);

    return { startInput, endInput, rangeRadio };
  }

  getValue(): RowRangeValue | undefined {
    if (!this.rangeRadio.checked) return undefined;
    const start = parseInt(this.startInput.value, 10);
    const end = parseInt(this.endInput.value, 10);
    if (isNaN(start) || isNaN(end)) return undefined;
    return { start, end };
  }
}
