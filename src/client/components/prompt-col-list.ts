import type { PromptColumnSpec } from "../../shared/types";
import { TokenInput } from "./token-input";

const PROMPT_KINDS: PromptColumnSpec["kind"][] = ["text", "file"];

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

    const pickerWrap = document.createElement("div");
    pickerWrap.className = "pcol-col-picker";
    const tokenInput = new TokenInput(pickerWrap, this.headers, {
      multi: false,
      selected: initialCol ? [initialCol] : [],
    });
    el.appendChild(pickerWrap);

    const kindToggle = this.makeBtn(this.kindLabel(kind), "pcol-kind-toggle");
    el.appendChild(kindToggle);

    const upBtn = this.makeBtn("↑", "pcol-btn-up");
    const downBtn = this.makeBtn("↓", "pcol-btn-down");
    const removeBtn = this.makeBtn("×", "pcol-btn-remove");
    el.appendChild(upBtn);
    el.appendChild(downBtn);
    el.appendChild(removeBtn);

    const row: PromptRow = { kind, tokenInput, el };

    kindToggle.addEventListener("click", () => {
      const nextIdx = (PROMPT_KINDS.indexOf(row.kind) + 1) % PROMPT_KINDS.length;
      row.kind = PROMPT_KINDS[nextIdx];
      kindToggle.textContent = this.kindLabel(row.kind);
    });
    upBtn.addEventListener("click", () => this.moveRow(row, -1));
    downBtn.addEventListener("click", () => this.moveRow(row, 1));
    removeBtn.addEventListener("click", () => this.removeRow(row));

    return row;
  }

  private kindLabel(kind: PromptColumnSpec["kind"]): string {
    return kind.charAt(0).toUpperCase() + kind.slice(1) + " ⇄";
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
