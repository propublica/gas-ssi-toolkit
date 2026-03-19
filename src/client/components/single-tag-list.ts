export interface SingleTagListOpts {
  includeNew?: boolean;
  selected?: string;
  newPlaceholder?: string;
  newDefault?: string;
}

export class SingleTagList {
  private readonly container: HTMLElement;
  private newInput: HTMLInputElement | null = null;

  constructor(container: HTMLElement, headers: string[], opts: SingleTagListOpts) {
    this.container = container;
    this.render(headers, opts);
  }

  private selectOnly(clicked: HTMLButtonElement): void {
    const wasSelected = clicked.classList.contains("selected");
    this.container.querySelectorAll<HTMLButtonElement>(".tag").forEach((t) => {
      t.classList.remove("selected");
    });
    if (!wasSelected) clicked.classList.add("selected");
  }

  private render(headers: string[], opts: SingleTagListOpts): void {
    this.container.innerHTML = "";

    // If selected is set but not a known header, treat as a custom "__new__" value.
    const selectedIsCustom =
      opts.selected !== undefined && opts.includeNew === true && !headers.includes(opts.selected);

    headers.forEach((h) => {
      const btn = document.createElement("button");
      btn.className = "tag";
      btn.type = "button";
      btn.textContent = h;
      btn.setAttribute("data-value", h);
      if (!selectedIsCustom && opts.selected === h) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        this.selectOnly(btn);
        if (this.newInput) this.newInput.style.display = "none";
      });
      this.container.appendChild(btn);
    });

    if (opts.includeNew) {
      const newBtn = document.createElement("button");
      newBtn.className = "tag";
      newBtn.type = "button";
      newBtn.textContent = "+ New column";
      newBtn.setAttribute("data-value", "__new__");

      this.newInput = document.createElement("input");
      this.newInput.type = "text";
      this.newInput.className = "text-input";
      this.newInput.placeholder = opts.newPlaceholder ?? "ai_column_name";
      this.newInput.value = opts.newDefault ?? "ai_";
      this.newInput.style.display = "none";

      if (selectedIsCustom) {
        newBtn.classList.add("selected");
        this.newInput.value = opts.selected!;
        this.newInput.style.display = "block";
      }

      newBtn.addEventListener("click", () => {
        this.selectOnly(newBtn);
        if (this.newInput) {
          this.newInput.style.display = "block";
          this.newInput.focus();
        }
      });

      this.container.appendChild(newBtn);
      this.container.appendChild(this.newInput);
    }
  }

  getValue(): string {
    const selected = this.container.querySelector<HTMLButtonElement>(".tag.selected");
    if (!selected) return "";
    const val = selected.getAttribute("data-value") ?? "";
    if (val === "__new__" && this.newInput) return this.newInput.value.trim();
    return val;
  }
}
