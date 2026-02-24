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
 * Applies a RunConfig preset by marking matching tags as selected.
 * Exported for testing.
 */
export function applyPreset(preset: Partial<RunConfig>): void {
  void preset;
}

/**
 * Reads current panel DOM state and returns a validated RunConfig.
 * Returns null and shows an alert if required fields are missing.
 * Exported for testing.
 */
export function assembleRunConfig(): RunConfig | null {
  return null;
}

/**
 * Shows/hides the row range inputs based on the selected radio.
 * Exported for testing.
 */
export function handleRowRangeChange(): void {}

/**
 * Wires all event listeners. Called once at the end of the script.
 * Not exported — not unit-tested (couples to google.script.run).
 */
function init(): void {}

init();
