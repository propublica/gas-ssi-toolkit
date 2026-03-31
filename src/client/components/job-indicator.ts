import type { Job } from "../types";
import type { JobStore } from "../job-store";

/**
 * Renders active and recently failed jobs into the sidebar chrome strip.
 * Mounts to #job-strip which lives outside the router's #app container
 * and therefore persists across panel navigation.
 */
export class JobIndicator {
  private el: HTMLElement;
  private store: JobStore;

  constructor(container: HTMLElement, store: JobStore) {
    this.el = container;
    this.store = store;
    store.subscribe((jobs) => this.render(jobs));
    // Event delegation — survives innerHTML re-renders on each notify()
    this.el.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-cancel-job]");
      if (btn) {
        const jobId = btn.getAttribute("data-cancel-job");
        if (jobId) this.store.cancel(jobId);
      }
    });
  }

  private render(jobs: Job[]): void {
    const active = jobs.filter(
      (j) =>
        j.state.status === "loading" ||
        j.state.status === "progress" ||
        j.state.status === "cancelling",
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
    const isCancelling = job.state.status === "cancelling";
    const action = isCancelling
      ? `<span class="job-strip__cancelling">Stopping...</span>`
      : `<button class="job-strip__cancel" data-cancel-job="${this.escape(job.id)}" title="Stop after current chunk">&#x2715;</button>`;
    return `<span class="job-strip__item job-strip__item--active">
      <span class="job-strip__spinner"></span>
      <span class="job-strip__label">${this.escape(msg)}</span>
      ${action}
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
