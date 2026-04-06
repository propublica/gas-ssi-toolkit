import type { PromptColumnSpec } from "../../shared/types";
import { TokenInput } from "./token-input";

interface PromptRow {
  kind: "text" | "file";
  tokenInput: TokenInput;
  el: HTMLElement;
}

export class PromptColList {
  private readonly headers: string[];
  private rows: PromptRow[] = [];
  private readonly listEl: HTMLElement;
  private readonly addBtn: HTMLButtonElement;

  constructor(container: HTMLElement, headers: string[], initialValue?: PromptColumnSpec[]) {
    this.headers = headers;

    this.listEl = document.createElement("div");
    this.listEl.className = "pcol-list";

    this.addBtn = document.createElement("button");
    this.addBtn.type = "button";
    this.addBtn.className = "pcol-add-btn";
    this.addBtn.textContent = "+ Add column";
    this.addBtn.addEventListener("click", () => this.addRow("text", ""));

    container.appendChild(this.listEl);
    container.appendChild(this.addBtn);

    for (const spec of initialValue ?? []) {
      this.addRow(spec.kind, spec.col);
    }
  }

  getValue(): PromptColumnSpec[] {
    return this.rows
      .map((row) => ({ col: row.tokenInput.getValue()[0] ?? "", kind: row.kind }))
      .filter((spec) => spec.col !== "");
  }

  destroy(): void {
    for (const row of this.rows) {
      row.tokenInput.destroy();
    }
    this.rows = [];
    this.listEl.remove();
    this.addBtn.remove();
  }

  private addRow(kind: "text" | "file", initialCol: string): void {
    const row = this.buildRow(kind, initialCol);
    this.rows.push(row);
    this.listEl.appendChild(row.el);
    this.updateArrows();
  }

  private buildRow(kind: "text" | "file", initialCol: string): PromptRow {
    const el = document.createElement("div");
    el.className = "pcol-row";

    // Line 1: TokenInput for column selection
    const line1 = document.createElement("div");
    line1.className = "pcol-row-line1";
    const tokenInput = new TokenInput(line1, this.headers, {
      multi: false,
      selected: initialCol ? [initialCol] : [],
    });
    el.appendChild(line1);

    // Line 2: kind pills + spacer + action buttons
    const line2 = document.createElement("div");
    line2.className = "pcol-row-line2";

    const pillsWrap = document.createElement("div");
    pillsWrap.className = "pcol-kind-pills";

    const textPill = this.makePill("Text", kind === "text");
    const filePill = this.makePill("File", kind === "file");
    pillsWrap.appendChild(textPill);
    pillsWrap.appendChild(filePill);

    const spacer = document.createElement("div");
    spacer.className = "pcol-spacer";

    const upBtn = this.makeBtn("↑", "pcol-btn-up");
    const downBtn = this.makeBtn("↓", "pcol-btn-down");
    const removeBtn = this.makeBtn("×", "pcol-btn-remove");

    line2.appendChild(pillsWrap);
    line2.appendChild(spacer);
    line2.appendChild(upBtn);
    line2.appendChild(downBtn);
    line2.appendChild(removeBtn);
    el.appendChild(line2);

    const row: PromptRow = { kind, tokenInput, el };

    textPill.addEventListener("click", () => {
      row.kind = "text";
      textPill.classList.add("selected");
      filePill.classList.remove("selected");
    });
    filePill.addEventListener("click", () => {
      row.kind = "file";
      filePill.classList.add("selected");
      textPill.classList.remove("selected");
    });
    upBtn.addEventListener("click", () => this.moveRow(row, -1));
    downBtn.addEventListener("click", () => this.moveRow(row, 1));
    removeBtn.addEventListener("click", () => this.removeRow(row));

    return row;
  }

  private makePill(label: string, selected: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag" + (selected ? " selected" : "");
    btn.textContent = label;
    return btn;
  }

  private makeBtn(label: string, className: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    return btn;
  }

  private moveRow(row: PromptRow, delta: -1 | 1): void {
    const idx = this.rows.indexOf(row);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= this.rows.length) return;

    // Capture elements by their role before mutating the array
    const elMoving = this.rows[idx].el;
    const elDisplaced = this.rows[newIdx].el;

    [this.rows[idx], this.rows[newIdx]] = [this.rows[newIdx], this.rows[idx]];

    // For move-up: insert the moving element before the displaced one
    // For move-down: insert the displaced element before the moving one (same net swap)
    if (delta === -1) {
      this.listEl.insertBefore(elMoving, elDisplaced);
    } else {
      this.listEl.insertBefore(elDisplaced, elMoving);
    }

    this.updateArrows();
  }

  private removeRow(row: PromptRow): void {
    row.tokenInput.destroy();
    row.el.remove();
    this.rows = this.rows.filter((r) => r !== row);
    this.updateArrows();
  }

  private updateArrows(): void {
    this.rows.forEach((row, idx) => {
      const upBtn = row.el.querySelector<HTMLButtonElement>(".pcol-btn-up");
      const downBtn = row.el.querySelector<HTMLButtonElement>(".pcol-btn-down");
      if (upBtn) upBtn.disabled = idx === 0;
      if (downBtn) downBtn.disabled = idx === this.rows.length - 1;
    });
  }
}
