jest.mock("../src/client/services", () => ({
  getJobProgress: jest.fn().mockResolvedValue(null),
}));

import { JobStore } from "../src/client/job-store";
import { getJobProgress } from "../src/client/services";

const mockGetJobProgress = getJobProgress as jest.MockedFunction<typeof getJobProgress>;

describe("JobStore", () => {
  let store: JobStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = new JobStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("notifies listeners when a job is dispatched", () => {
    const listener = jest.fn();
    store.subscribe(listener);

    const promise = new Promise<void>((resolve) => setTimeout(resolve, 100));
    store.dispatch("job-1", "Test Job", promise);

    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "job-1", label: "Test Job" })]),
    );
  });

  it("unsubscribes correctly when unsubscribe fn is called", () => {
    const listener = jest.fn();
    const unsub = store.subscribe(listener);
    unsub();
    listener.mockClear();

    store.dispatch("job-2", "Test", Promise.resolve());
    expect(listener).not.toHaveBeenCalled();
  });

  it("marks job complete when promise resolves", async () => {
    const listener = jest.fn();
    store.subscribe(listener);

    await store.dispatch("job-3", "Test Job", Promise.resolve());

    const calls = listener.mock.calls;
    const lastCall = calls[calls.length - 1][0] as Array<{ id: string; state: { status: string } }>;
    const job = lastCall.find((j) => j.id === "job-3");
    expect(job?.state.status).toBe("complete");
  });

  it("marks job error when promise rejects", async () => {
    const listener = jest.fn();
    store.subscribe(listener);

    const rejected = Promise.reject(new Error("boom"));
    rejected.catch(() => {}); // suppress unhandled rejection before dispatch attaches handler

    await store.dispatch("job-4", "Test Job", rejected).catch(() => {});

    const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{
      id: string;
      state: { status: string; message?: string };
    }>;
    const job = lastCall.find((j) => j.id === "job-4");
    expect(job?.state.status).toBe("error");
    expect(job?.state.message).toBe("boom");
  });

  it("sets completedAt when job completes", async () => {
    const listener = jest.fn();
    store.subscribe(listener);

    await store.dispatch("job-5", "Test", Promise.resolve());

    const completedCalls = listener.mock.calls;
    const lastCall = completedCalls[completedCalls.length - 1][0] as Array<{
      completedAt?: number;
    }>;
    expect(lastCall[0].completedAt).toBeDefined();
  });

  it("polls getJobProgress on interval while job is running", async () => {
    mockGetJobProgress.mockResolvedValue({ message: "Row 1 of 5", current: 1, total: 5 });

    let resolveOp!: () => void;
    const op = new Promise<void>((resolve) => {
      resolveOp = resolve;
    });

    store.dispatch("job-6", "Batch AI", op);

    jest.advanceTimersByTime(2000);
    await Promise.resolve(); // flush microtasks

    expect(mockGetJobProgress).toHaveBeenCalledWith("job-6");

    resolveOp();
    await op;
  });

  it("removes completed job from store after 5 seconds", async () => {
    const listener = jest.fn();
    store.subscribe(listener);

    await store.dispatch("job-auto-remove", "Test", Promise.resolve());
    listener.mockClear();

    jest.advanceTimersByTime(5000);

    const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{
      id: string;
    }>;
    expect(lastCall.find((j) => j.id === "job-auto-remove")).toBeUndefined();
  });

  it("stops polling after job completes", async () => {
    mockGetJobProgress.mockResolvedValue(null);

    await store.dispatch("job-7", "Test", Promise.resolve());
    mockGetJobProgress.mockClear();

    jest.advanceTimersByTime(4000);
    await Promise.resolve();

    expect(mockGetJobProgress).not.toHaveBeenCalled();
  });

  describe("cancel()", () => {
    it("transitions a loading job to cancelling", () => {
      const listener = jest.fn();
      store.subscribe(listener);

      store.dispatch("job-c1", "Test", new Promise(() => {}));
      store.cancel("job-c1");

      const lastJobs = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{
        id: string;
        state: { status: string };
      }>;
      const job = lastJobs.find((j) => j.id === "job-c1");
      expect(job?.state.status).toBe("cancelling");
    });

    it("transitions a progress job to cancelling", () => {
      const listener = jest.fn();
      store.subscribe(listener);

      store.dispatch("job-c2", "Test", new Promise(() => {}));
      store.setProgress("job-c2", "Row 3 of 10");
      store.cancel("job-c2");

      const lastJobs = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{
        id: string;
        state: { status: string };
      }>;
      const job = lastJobs.find((j) => j.id === "job-c2");
      expect(job?.state.status).toBe("cancelling");
    });

    it("is a no-op for unknown job id", () => {
      expect(() => store.cancel("nonexistent")).not.toThrow();
    });

    it("is a no-op if job is already complete", async () => {
      const listener = jest.fn();
      store.subscribe(listener);

      await store.dispatch("job-c3", "Test", Promise.resolve());
      listener.mockClear();

      store.cancel("job-c3");
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("isCancelled()", () => {
    it("returns false before cancel is called", () => {
      store.dispatch("job-ic1", "Test", new Promise(() => {}));
      expect(store.isCancelled("job-ic1")).toBe(false);
    });

    it("returns true after cancel is called", () => {
      store.dispatch("job-ic2", "Test", new Promise(() => {}));
      store.cancel("job-ic2");
      expect(store.isCancelled("job-ic2")).toBe(true);
    });

    it("returns false for unknown job id", () => {
      expect(store.isCancelled("nonexistent")).toBe(false);
    });

    it("returns false after the job completes (flag cleaned up)", async () => {
      store.dispatch("job-ic3", "Test", new Promise(() => {}));
      store.cancel("job-ic3");
      expect(store.isCancelled("job-ic3")).toBe(true);

      await store.dispatch("job-ic4", "Cleanup test", Promise.resolve());
      expect(store.isCancelled("job-ic4")).toBe(false);
    });
  });

  describe("setProgress()", () => {
    it("updates the job state message", () => {
      const listener = jest.fn();
      store.subscribe(listener);

      store.dispatch("job-sp1", "Test", new Promise(() => {}));
      store.setProgress("job-sp1", "Chunk 2 of 6");

      const lastJobs = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{
        id: string;
        state: { status: string; message?: string };
      }>;
      const job = lastJobs.find((j) => j.id === "job-sp1");
      expect(job?.state.status).toBe("progress");
      expect(job?.state.message).toBe("Chunk 2 of 6");
    });

    it("is a no-op for unknown job id", () => {
      expect(() => store.setProgress("nonexistent", "msg")).not.toThrow();
    });
  });
});
