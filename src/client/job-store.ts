import type { Job, LoadingState } from "./types";
import { getJobProgress } from "./services";

type JobListener = (jobs: Job[]) => void;

export class JobStore {
  private jobs: Map<string, Job> = new Map();
  private listeners: Set<JobListener> = new Set();
  private pollIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

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
      (err: Error) => {
        this.fail(id, err.message);
        throw err;
      },
    );
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
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, state: { status: "complete" }, completedAt: Date.now() });
    this.notify();
  }

  private fail(id: string, message: string): void {
    this.stopPolling(id);
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
