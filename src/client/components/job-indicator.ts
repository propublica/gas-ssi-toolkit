import type { Job } from "../types";
import type { JobStore } from "../job-store";

/**
 * Renders active and recently failed jobs into the sidebar chrome strip.
 * Mounts to #job-strip which lives outside the router's #app container
 * and therefore persists across panel navigation.
 */
export class JobIndicator {
  private el: HTMLElement;

  constructor(container: HTMLElement, store: JobStore) {
    this.el = container;
    store.subscribe((jobs) => this.render(jobs));
  }

  private render(jobs: Job[]): void {
    const active = jobs.filter(
      (j) => j.state.status === "loading" || j.state.status === "progress",
    );
    const failed = jobs.filter((j) => j.state.status === "error");

    if (active.length === 0 && failed.length === 0) {
      this.el.hidden = true;
      this.el.innerHTML = "";
      return;
    }

    this.el.hidden = false;

    const items = [
      ...active.map((j) => this.renderActive(j)),
      ...failed.map((j) => this.renderFailed(j)),
    ];

    this.el.innerHTML = items.join("");
  }

  private renderActive(job: Job): string {
    const msg = job.state.message ?? job.label;
    return `<span class="job-strip__item job-strip__item--active">
      <span class="job-strip__spinner"></span>
      <span class="job-strip__label">${this.escape(msg)}</span>
    </span>`;
  }

  private renderFailed(job: Job): string {
    return `<span class="job-strip__item job-strip__item--error">
      <span class="job-strip__label">&#x26A0; ${this.escape(job.label)} failed</span>
    </span>`;
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
