import type { Job, LoadingState } from "./types";
import { getJobProgress } from "./services";

type JobListener = (jobs: Job[]) => void;

export class JobStore {
  private jobs: Map<string, Job> = new Map();
  private listeners: Set<JobListener> = new Set();
  private pollIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private cancelFlags: Map<string, boolean> = new Map();

  subscribe(fn: JobListener): () => void {
    this.listeners.add(fn);
    return (): void => {
      this.listeners.delete(fn);
    };
  }

  dispatch(id: string, label: string, fn: Promise<void>): Promise<void> {
    const job: Job = {
      id,
      label,
      state: { status: "loading" },
      startedAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.notify();

    const interval = setInterval(() => {
      getJobProgress(id)
        .then((progress) => {
          if (!progress) return;
          // Don't overwrite a cancelling state — the user has requested a stop
          // and the message should stay visible until the chunk finishes.
          const current = this.jobs.get(id);
          if (!current || current.state.status === "cancelling") return;
          this.update(id, {
            status: "progress",
            message: progress.message,
            current: progress.current,
            total: progress.total,
          });
        })
        .catch(() => {
          // polling failures are non-fatal
        });
    }, 2000);
    this.pollIntervals.set(id, interval);

    return fn.then(
      () => this.complete(id),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.fail(id, message);
        throw err;
      },
    );
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.state.status !== "loading" && job.state.status !== "progress") return;
    this.cancelFlags.set(id, true);
    this.jobs.set(id, {
      ...job,
      state: { status: "cancelling", message: "Stopping after this chunk..." },
    });
    this.notify();
  }

  isCancelled(id: string): boolean {
    return this.cancelFlags.get(id) ?? false;
  }

  setProgress(id: string, message: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, state: { status: "progress", message } });
    this.notify();
  }

  getJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  private update(id: string, state: LoadingState): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, state });
    this.notify();
  }

  private complete(id: string): void {
    this.stopPolling(id);
    this.cancelFlags.delete(id);
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, state: { status: "complete" }, completedAt: Date.now() });
    this.notify();
    setTimeout(() => {
      this.jobs.delete(id);
      this.notify();
    }, 5000);
  }

  private fail(id: string, message: string): void {
    this.stopPolling(id);
    this.cancelFlags.delete(id);
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, state: { status: "error", message }, completedAt: Date.now() });
    this.notify();
  }

  private stopPolling(id: string): void {
    const interval = this.pollIntervals.get(id);
    if (interval !== undefined) {
      clearInterval(interval);
      this.pollIntervals.delete(id);
    }
  }

  private notify(): void {
    const snapshot = Array.from(this.jobs.values());
    this.listeners.forEach((fn) => fn(snapshot));
  }
}

export const jobStore = new JobStore();
