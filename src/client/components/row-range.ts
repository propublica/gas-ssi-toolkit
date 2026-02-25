export interface RowRangeValue {
  start: number;
  end: number;
}

export class RowRange {
  private static instanceCount = 0;
  private readonly container: HTMLElement;
  private startInput: HTMLInputElement;
  private endInput: HTMLInputElement;
  private rangeRadio: HTMLInputElement;

  constructor(container: HTMLElement, selected?: RowRangeValue) {
    this.container = container;
    const groupName = `row-range-${RowRange.instanceCount++}`;
    const refs = this.render(selected, groupName);
    this.startInput = refs.startInput;
    this.endInput = refs.endInput;
    this.rangeRadio = refs.rangeRadio;
  }

  private render(
    selected: RowRangeValue | undefined,
    groupName: string,
  ): {
    startInput: HTMLInputElement;
    endInput: HTMLInputElement;
    rangeRadio: HTMLInputElement;
  } {
    this.container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "row-range-options";

    const selLabel = document.createElement("label");
    const selRadio = document.createElement("input");
    selRadio.type = "radio";
    selRadio.name = groupName;
    selRadio.value = "selection";
    selRadio.checked = !selected;
    selLabel.append(selRadio, " Use sheet selection");

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
    if (selected) startInput.value = String(selected.start);

    const endInput = document.createElement("input");
    endInput.type = "number";
    endInput.placeholder = "End row";
    endInput.min = "2";
    if (selected) endInput.value = String(selected.end);

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
