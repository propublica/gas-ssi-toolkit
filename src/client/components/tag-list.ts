export class TagList {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement, headers: string[], selected: string[] = []) {
    this.container = container;
    this.render(headers, selected);
  }

  private render(headers: string[], selected: string[]): void {
    this.container.innerHTML = "";
    headers.forEach((h) => {
      const btn = document.createElement("button");
      btn.className = "tag";
      btn.type = "button";
      btn.textContent = h;
      btn.setAttribute("data-value", h);
      if (selected.includes(h)) btn.classList.add("selected");
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
