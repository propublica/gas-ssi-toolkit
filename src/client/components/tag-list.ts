type TagItem = string | { label: string; value: string };

function normalize(item: TagItem): { label: string; value: string } {
  return typeof item === "string" ? { label: item, value: item } : item;
}

export class TagList {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement, items: TagItem[], selected: string[] = []) {
    this.container = container;
    this.render(items, selected);
  }

  private render(items: TagItem[], selected: string[]): void {
    this.container.innerHTML = "";
    items.forEach((item) => {
      const { label, value } = normalize(item);
      const btn = document.createElement("button");
      btn.className = "tag";
      btn.type = "button";
      btn.textContent = label;
      btn.setAttribute("data-value", value);
      if (selected.includes(value)) btn.classList.add("selected");
      btn.addEventListener("click", () => btn.classList.toggle("selected"));
      this.container.appendChild(btn);
    });
  }

  getValue(): string[] {
    return Array.from(this.container.querySelectorAll<HTMLButtonElement>(".tag.selected"))
      .map((t) => t.getAttribute("data-value") ?? "")
      .filter(Boolean);
  }
}
