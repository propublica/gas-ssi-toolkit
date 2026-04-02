/**
 * TokenInput — searchable token/chip field for column selection.
 *
 * USE THIS when the list of items is potentially large (8+ items) and users
 * know what they're looking for. Selected items appear as removable chips
 * inside the field; unselected items appear in a filtered dropdown.
 *
 * Supports multi-select (default) and single-select (`multi: false`).
 * Use `includeNew: true` on single-select output fields to allow the user to
 * type a brand-new column name.
 *
 * Prefer TagList when the item count is small and users benefit from seeing
 * all options at a glance (e.g. the Tools section with ~5 fixed entries).
 *
 * Naming note: selected items are called "chips" here (inline removable tokens).
 * They reuse the `.tag.selected` CSS class from TagList for visual consistency —
 * same appearance, different interaction model (chips are removed individually;
 * tags are toggled).
 */

export interface TokenInputOpts {
  /** Values to pre-select on construction. */
  selected?: string[];
  /** Allow multiple selections. Defaults to true. */
  multi?: boolean;
  /** Append a "+ New column" option for creating a new named column. */
  includeNew?: boolean;
}

export class TokenInput {
  private readonly field: HTMLElement;
  private readonly chipsArea: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly searchInput: HTMLInputElement;
  private readonly dropdown: HTMLElement;

  private readonly allItems: string[];
  private readonly multi: boolean;
  private readonly includeNew: boolean;

  /** Ordered list of currently selected values (preserves insertion order). */
  private selected: string[];
  /** True when the editable "+ New column" chip is present. */
  private hasNewChip = false;

  private readonly onDocumentClick: (e: MouseEvent) => void;

  constructor(container: HTMLElement, items: string[], opts: TokenInputOpts) {
    this.allItems = items;
    this.multi = opts.multi !== false;
    this.includeNew = opts.includeNew === true;
    this.selected = [];

    // Build DOM
    this.field = document.createElement("div");
    this.field.className = "token-field";

    this.chipsArea = document.createElement("div");
    this.chipsArea.className = "token-chips";

    this.addBtn = document.createElement("button");
    this.addBtn.type = "button";
    this.addBtn.className = "token-add-btn tag";
    this.addBtn.textContent = "+ Add";
    this.chipsArea.appendChild(this.addBtn);

    this.field.appendChild(this.chipsArea);

    this.dropdown = document.createElement("div");
    this.dropdown.className = "token-dropdown";
    this.dropdown.style.display = "none";
    this.field.appendChild(this.dropdown);

    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.className = "token-search";
    this.searchInput.placeholder = "Search...";
    this.searchInput.autocomplete = "off";
    this.dropdown.appendChild(this.searchInput);

    container.appendChild(this.field);

    this.onDocumentClick = (e: MouseEvent): void => {
      if (!this.field.contains(e.target as Node)) this.closeDropdown();
    };
    this.wireEvents();
    this.renderDropdown();

    // Apply pre-selections
    const initial = opts.selected ?? [];
    if (this.includeNew && initial.length > 0 && !items.includes(initial[0])) {
      // Custom value not in known items — treat as a "new column" selection
      this.addNewChip(initial[0]);
    } else {
      for (const val of initial) {
        if (items.includes(val)) {
          this.selected.push(val);
          this.addChip(val);
        }
      }
    }

    this.updateAddBtn();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  destroy(): void {
    document.removeEventListener("click", this.onDocumentClick);
    this.field.remove();
  }

  /**
   * Returns the current selected values.
   * Note: returns [] if the "+ New column" chip is present but its input is empty.
   */
  getValue(): string[] {
    if (this.hasNewChip) {
      const val = this.chipsArea.querySelector<HTMLInputElement>(".token-chip-input")?.value.trim();
      return val ? [val] : [];
    }
    return [...this.selected];
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  private wireEvents(): void {
    this.addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openDropdown();
      this.searchInput.focus();
    });

    this.searchInput.addEventListener("input", () => this.applyFilter());

    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeDropdown();
    });

    document.addEventListener("click", this.onDocumentClick);
  }

  // ─── Dropdown ───────────────────────────────────────────────────────────────

  private openDropdown(): void {
    this.renderDropdown();
    this.searchInput.value = "";
    this.applyFilter();
    this.dropdown.style.display = "block";
  }

  private closeDropdown(): void {
    this.dropdown.style.display = "none";
    this.searchInput.value = "";
  }

  private updateAddBtn(): void {
    const hasSelection = this.selected.length > 0 || this.hasNewChip;
    this.addBtn.style.display = !this.multi && hasSelection ? "none" : "";
  }

  private renderDropdown(): void {
    // Clear only option elements, preserving the searchInput as first child
    const options = this.dropdown.querySelectorAll(".token-option, .token-no-match");
    options.forEach((el) => el.remove());

    const unselected = this.allItems.filter((item) => !this.selected.includes(item));

    for (const item of unselected) {
      const opt = document.createElement("div");
      opt.className = "token-option";
      opt.setAttribute("data-value", item);
      opt.textContent = item;
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectItem(item);
      });
      this.dropdown.appendChild(opt);
    }

    if (this.includeNew) {
      const newOpt = document.createElement("div");
      newOpt.className = "token-option";
      newOpt.setAttribute("data-value", "__new__");
      newOpt.textContent = "+ New column";
      newOpt.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectNewColumn();
      });
      this.dropdown.appendChild(newOpt);
    }
  }

  private applyFilter(): void {
    const query = this.searchInput.value.toLowerCase();
    const options = this.dropdown.querySelectorAll<HTMLElement>(".token-option");
    let anyVisible = false;

    options.forEach((opt) => {
      const matches =
        opt.getAttribute("data-value") === "__new__" ||
        (opt.textContent ?? "").toLowerCase().includes(query);
      opt.style.display = matches ? "block" : "none";
      if (matches) anyVisible = true;
    });

    // Remove stale no-match message before re-evaluating
    this.dropdown.querySelector(".token-no-match")?.remove();

    if (!anyVisible) {
      const msg = document.createElement("div");
      msg.className = "token-no-match";
      msg.textContent = "No matches";
      this.dropdown.appendChild(msg);
    }
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  private selectItem(value: string): void {
    if (!this.multi) {
      // Single-select: clear existing selection first
      this.selected = [];
      this.hasNewChip = false;
      this.chipsArea.querySelectorAll<HTMLElement>(".token-chip").forEach((chip) => chip.remove());
    }

    this.selected.push(value);
    this.addChip(value);
    this.renderDropdown();

    this.closeDropdown();
    this.updateAddBtn();
  }

  private selectNewColumn(): void {
    if (!this.multi) {
      this.selected = [];
      this.hasNewChip = false;
      this.chipsArea.querySelectorAll<HTMLElement>(".token-chip").forEach((chip) => chip.remove());
    }

    this.closeDropdown();
    this.addNewChip("ai_");
    this.updateAddBtn();
  }

  // ─── Chips ──────────────────────────────────────────────────────────────────

  private addChip(value: string): void {
    const chip = document.createElement("span");
    chip.className = "token-chip tag selected";
    chip.setAttribute("data-value", value);
    chip.textContent = value;

    const removeBtn = document.createElement("button");
    removeBtn.className = "token-chip-remove";
    removeBtn.setAttribute("data-value", value);
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeChip(value, chip);
    });

    chip.appendChild(removeBtn);
    this.chipsArea.insertBefore(chip, this.addBtn);
  }

  private addNewChip(initialValue: string): void {
    this.hasNewChip = true;

    const chip = document.createElement("span");
    chip.className = "token-chip token-chip-new tag selected";

    const chipInput = document.createElement("input");
    chipInput.type = "text";
    chipInput.className = "token-chip-input";
    chipInput.value = initialValue;
    chipInput.addEventListener("click", (e) => e.stopPropagation());

    const removeBtn = document.createElement("button");
    removeBtn.className = "token-chip-remove";
    removeBtn.setAttribute("data-value", "__new__");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chip.remove();
      this.hasNewChip = false;
      this.updateAddBtn();
    });

    chip.appendChild(chipInput);
    chip.appendChild(removeBtn);
    this.chipsArea.insertBefore(chip, this.addBtn);
    chipInput.focus();
  }

  private removeChip(value: string, chipEl: HTMLElement): void {
    this.selected = this.selected.filter((v) => v !== value);
    chipEl.remove();
    // Refresh dropdown so the removed item reappears
    if (this.dropdown.style.display !== "none") {
      this.renderDropdown();
      this.applyFilter();
    }
    this.updateAddBtn();
  }
}
