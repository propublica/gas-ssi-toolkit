import type { RunConfig } from "../shared/types";

/**
 * Renders multi-select tag buttons into a container.
 * Exported for testing.
 */
export function buildTagList(container: HTMLElement, headers: string[], selected?: string[]): void {
  container.innerHTML = "";
  headers.forEach((h) => {
    const btn = document.createElement("button");
    btn.className = "tag";
    btn.type = "button";
    btn.textContent = h;
    btn.setAttribute("data-value", h);
    if (selected?.includes(h)) btn.classList.add("selected");
    btn.addEventListener("click", () => btn.classList.toggle("selected"));
    container.appendChild(btn);
  });
}

/**
 * Renders single-select tag buttons into a container.
 * includeNew: append a "+ New column" tag with data-value="__new__".
 * Exported for testing.
 */
export function buildSingleTagList(
  container: HTMLElement,
  headers: string[],
  includeNew: boolean,
  selected?: string,
): void {
  container.innerHTML = "";

  function selectOnly(clicked: HTMLButtonElement): void {
    container.querySelectorAll<HTMLButtonElement>(".tag").forEach((t) => {
      t.classList.remove("selected");
    });
    clicked.classList.add("selected");
  }

  headers.forEach((h) => {
    const btn = document.createElement("button");
    btn.className = "tag";
    btn.type = "button";
    btn.textContent = h;
    btn.setAttribute("data-value", h);
    if (selected === h) btn.classList.add("selected");
    btn.addEventListener("click", function () {
      selectOnly(this);
      const input = document.getElementById("new-col-input") as HTMLInputElement | null;
      if (input) input.style.display = "none";
    });
    container.appendChild(btn);
  });

  if (includeNew) {
    const newBtn = document.createElement("button");
    newBtn.className = "tag";
    newBtn.type = "button";
    newBtn.textContent = "+ New column";
    newBtn.setAttribute("data-value", "__new__");
    newBtn.addEventListener("click", function () {
      selectOnly(this);
      const input = document.getElementById("new-col-input") as HTMLInputElement | null;
      if (input) {
        input.style.display = "block";
        input.focus();
      }
    });
    container.appendChild(newBtn);
  }
}

/**
 * Shows/hides the row range inputs based on the selected radio.
 * Exported for testing.
 */
export function handleRowRangeChange(): void {
  const checked = document.querySelector<HTMLInputElement>('input[name="row-range"]:checked');
  const rangeInputs = document.getElementById("range-inputs");
  if (rangeInputs) {
    rangeInputs.style.display = checked?.value === "range" ? "flex" : "none";
  }
}

function setMultiSelected(containerId: string, values: string[]): void {
  document
    .getElementById(containerId)
    ?.querySelectorAll<HTMLButtonElement>(".tag")
    .forEach((tag) => {
      tag.classList.toggle("selected", values.includes(tag.getAttribute("data-value") ?? ""));
    });
}

function setSingleSelected(containerId: string, value: string): void {
  document
    .getElementById(containerId)
    ?.querySelectorAll<HTMLButtonElement>(".tag")
    .forEach((tag) => {
      tag.classList.toggle("selected", tag.getAttribute("data-value") === value);
    });
}

/**
 * Applies a RunConfig preset by marking matching tags as selected.
 * Exported for testing.
 */
export function applyPreset(preset: Partial<RunConfig>): void {
  if (preset.userPromptCols) setMultiSelected("user-prompt-cols", preset.userPromptCols);
  if (preset.driveFileCols) setMultiSelected("drive-file-cols", preset.driveFileCols);
  if (preset.systemPromptCol) setSingleSelected("system-prompt-col", preset.systemPromptCol);
  if (preset.outputCol) {
    setSingleSelected("output-col", preset.outputCol);
    if (preset.outputCol === "__new__") {
      const input = document.getElementById("new-col-input") as HTMLInputElement | null;
      if (input) {
        input.style.display = "block";
        input.focus();
      }
    }
  }
  if (preset.rowRange) {
    const rangeRadio = document.querySelector<HTMLInputElement>(
      'input[name="row-range"][value="range"]',
    );
    if (rangeRadio) {
      rangeRadio.checked = true;
      handleRowRangeChange();
      const startInput = document.getElementById("row-start") as HTMLInputElement | null;
      const endInput = document.getElementById("row-end") as HTMLInputElement | null;
      if (startInput) startInput.value = String(preset.rowRange.start);
      if (endInput) endInput.value = String(preset.rowRange.end);
    }
  }
}

function getSelectedValues(containerId: string): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(`#${containerId} .tag.selected`))
    .map((t) => t.getAttribute("data-value") ?? "")
    .filter(Boolean);
}

/**
 * Reads current panel DOM state and returns a validated RunConfig.
 * Returns null and shows an alert if required fields are missing.
 * Exported for testing.
 */
export function assembleRunConfig(): RunConfig | null {
  const userPromptCols = getSelectedValues("user-prompt-cols");
  if (userPromptCols.length === 0) {
    alert("Please select at least one User prompt column.");
    return null;
  }

  const driveFileCols = getSelectedValues("drive-file-cols");

  const sysTag = document.querySelector<HTMLButtonElement>("#system-prompt-col .tag.selected");
  const systemPromptCol = sysTag?.getAttribute("data-value") ?? undefined;

  const outputTag = document.querySelector<HTMLButtonElement>("#output-col .tag.selected");
  if (!outputTag) {
    alert("Please select an output column.");
    return null;
  }

  let outputCol: string;
  if (outputTag.getAttribute("data-value") === "__new__") {
    const input = document.getElementById("new-col-input") as HTMLInputElement | null;
    outputCol = input?.value.trim() ?? "";
    if (!outputCol) {
      alert("Please enter a name for the new output column.");
      return null;
    }
  } else {
    outputCol = outputTag.getAttribute("data-value") ?? "";
  }

  const rowRangeMode = document.querySelector<HTMLInputElement>(
    'input[name="row-range"]:checked',
  )?.value;

  let rowRange: { start: number; end: number } | undefined;
  if (rowRangeMode === "range") {
    const start = parseInt(
      (document.getElementById("row-start") as HTMLInputElement | null)?.value ?? "",
      10,
    );
    const end = parseInt(
      (document.getElementById("row-end") as HTMLInputElement | null)?.value ?? "",
      10,
    );
    if (isNaN(start) || isNaN(end) || start < 2 || end < start) {
      alert("Please enter a valid row range (start \u2265 2, end \u2265 start).");
      return null;
    }
    rowRange = { start, end };
  }

  return {
    userPromptCols,
    driveFileCols: driveFileCols.length > 0 ? driveFileCols : undefined,
    systemPromptCol,
    outputCol,
    rowRange,
  };
}
