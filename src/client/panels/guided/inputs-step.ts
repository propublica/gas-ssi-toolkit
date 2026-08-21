import type { Step, StepContext } from "../../types";
import type { PrepColSpec, PromptColumnSpec } from "../../../shared/types";
import { TokenInput } from "../../components/token-input";
import { AsyncActionButton } from "../../components/async-action-button";
import { prepRecipe } from "../../services";

export type InputRow =
  | { kind: "column"; colTitle: string }
  | { kind: "drive-folder"; url: string; colTitle: string };

export interface InputsStepSavedState {
  rows: InputRow[];
}

export interface InputsStepResult {
  promptCols: PromptColumnSpec[];
}

export class InputsStep implements Step<InputsStepSavedState> {
  readonly title = "Gather your inputs";
  readonly flavorText = "The content the AI works on, one row at a time.";

  private headers: string[];
  private container: HTMLElement | null = null;
  private rows: Array<{ row: InputRow; el: HTMLElement; tokenInput?: TokenInput }> = [];
  private result: InputsStepResult | null = null;
  private nextFolderNumber = 1;
  private continueButton: AsyncActionButton | null = null;

  constructor(headers: string[]) {
    this.headers = headers;
  }

  getResult(): InputsStepResult | null {
    return this.result;
  }

  setInteractive(enabled: boolean): void {
    this.continueButton?.setInteractive(enabled);
  }

  /** Refreshes the available columns in every existing column-picker row
   * in place, preserving each row's current selection -- mirrors the
   * "Refresh columns" behavior in ConfigureAIRunPanel/ImportDriveLinksPanel/
   * ExtractTextPanel. Drive-folder rows don't use headers and are untouched.
   * Safe to call while this step is collapsed (mounted but hidden). */
  updateHeaders(headers: string[]): void {
    this.headers = headers;
    for (const entry of this.rows) {
      if (entry.row.kind !== "column") continue;
      const pickerWrap = entry.el.querySelector<HTMLElement>(".guided-input-col-picker");
      if (!pickerWrap) continue;
      const selected = entry.tokenInput?.getValue()[0];
      entry.tokenInput?.destroy();
      entry.tokenInput = new TokenInput(pickerWrap, headers, {
        multi: false,
        selected: selected ? [selected] : [],
      });
    }
  }

  hydrate(savedState: InputsStepSavedState): void {
    const rows = savedState.rows.filter((r) =>
      r.kind === "column" ? r.colTitle !== "" : r.url !== "",
    );
    this.result = { promptCols: rows.map((r) => ({ col: r.colTitle, kind: "auto" as const })) };
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: InputsStepSavedState): void {
    this.container = container;
    this.rows = [];
    container.innerHTML = `
      <div class="guided-input-rows"></div>
      <div class="guided-input-add-btns">
        <button type="button" class="btn-outline" id="gi-add-column">+ Column</button>
        <button type="button" class="btn-outline" id="gi-add-folder">+ Drive folder</button>
      </div>
      <button type="button" class="btn-run" id="gi-continue">Import &amp; Continue</button>
    `;
    for (const row of savedState?.rows ?? []) this.addRow(row);
    this.nextFolderNumber = this.computeNextFolderNumber();
    this.continueButton = new AsyncActionButton(
      container.querySelector<HTMLButtonElement>("#gi-continue")!,
      { idleLabel: "Import & Continue", loadingLabel: "Importing..." },
    );

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.addEventListener("click", () => {
      this.addRow({ kind: "column", colTitle: "" });
    });
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.addEventListener("click", () => {
      this.addRow({ kind: "drive-folder", url: "", colTitle: this.nextFolderTitle() });
    });
    container.querySelector<HTMLButtonElement>("#gi-continue")!.addEventListener("click", () => {
      this.handleContinue(ctx);
    });
  }

  unmount(): { savedState: InputsStepSavedState; summary: string } | undefined {
    if (!this.container) return undefined;
    const rows = this.currentRows();
    const colTitles = rows.map((r) => r.colTitle).filter(Boolean);
    const summary =
      colTitles.length > 0 ? `Columns: ${colTitles.join(", ")}` : "No inputs selected";
    return { savedState: { rows }, summary };
  }

  /** Tears down all row-level TokenInputs (their document-level click
   * listeners in particular). Call this only when the step's container is
   * actually being discarded — NOT from unmount(), which is also called on
   * steps that remain visibly mounted (see StepFlow.getValue()). */
  destroy(): void {
    for (const { tokenInput } of this.rows) {
      tokenInput?.destroy();
    }
  }

  private computeNextFolderNumber(): number {
    let max = 0;
    for (const { row } of this.rows) {
      if (row.kind !== "drive-folder") continue;
      const match = /^Drive Link(?: (\d+))?$/.exec(row.colTitle);
      if (!match) continue;
      const num = match[1] ? parseInt(match[1], 10) : 1;
      max = Math.max(max, num);
    }
    return max + 1;
  }

  private nextFolderTitle(): string {
    const n = this.nextFolderNumber++;
    return n === 1 ? "Drive Link" : `Drive Link ${n}`;
  }

  private addRow(row: InputRow): void {
    const el = document.createElement("div");
    el.className = "guided-input-row";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "guided-input-remove";
    removeBtn.textContent = "✕";

    let tokenInput: TokenInput | undefined;
    if (row.kind === "column") {
      const pickerWrap = document.createElement("div");
      pickerWrap.className = "guided-input-col-picker";
      tokenInput = new TokenInput(pickerWrap, this.headers, {
        multi: false,
        selected: row.colTitle ? [row.colTitle] : [],
      });
      el.appendChild(pickerWrap);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "guided-input-folder-url";
      input.placeholder = "Drive folder URL";
      input.value = row.url;
      el.appendChild(input);
    }
    el.appendChild(removeBtn);

    const entry = { row, el, tokenInput };
    removeBtn.addEventListener("click", () => {
      tokenInput?.destroy();
      el.remove();
      this.rows = this.rows.filter((r) => r !== entry);
    });

    this.rows.push(entry);
    this.container!.querySelector(".guided-input-rows")!.appendChild(el);
  }

  private currentRows(): InputRow[] {
    return this.rows.map(({ row, el, tokenInput }) => {
      if (row.kind === "column") {
        return { kind: "column" as const, colTitle: tokenInput?.getValue()[0] ?? "" };
      }
      const url = el.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value.trim();
      return { kind: "drive-folder" as const, url, colTitle: row.colTitle };
    });
  }

  private handleContinue(ctx: StepContext): void {
    const rows = this.currentRows().filter((r) =>
      r.kind === "column" ? r.colTitle !== "" : r.url !== "",
    );
    if (rows.length === 0) {
      globalThis.alert("Please add at least one column or Drive folder before continuing.");
      return;
    }
    const folderRows = rows.filter(
      (r): r is { kind: "drive-folder"; url: string; colTitle: string } =>
        r.kind === "drive-folder",
    );

    const finish = (): void => {
      this.continueButton!.setIdle();
      this.result = { promptCols: rows.map((r) => ({ col: r.colTitle, kind: "auto" as const })) };
      ctx.onComplete();
    };

    if (folderRows.length === 0) {
      finish();
      return;
    }

    const cols: PrepColSpec[] = folderRows.map((r, i) => ({
      colTitle: r.colTitle,
      fillStrategy: { kind: "list-drive-folder", inputId: `driveFolder_${i}` },
    }));
    const inputValues: Record<string, string> = {};
    folderRows.forEach((r, i) => (inputValues[`driveFolder_${i}`] = r.url));

    ctx.onBusyChange(true);
    this.continueButton!.setLoading();
    prepRecipe({ cols, inputValues }).then(
      () => {
        ctx.onBusyChange(false);
        finish();
      },
      (err: Error) => {
        ctx.onBusyChange(false);
        globalThis.alert("Error importing Drive folder: " + err.message);
        ctx.onError();
        this.continueButton!.setIdle();
      },
    );
  }
}
