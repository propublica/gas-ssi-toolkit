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
      expect.arrayContaining([
        expect.objectContaining({ id: "job-1", label: "Test Job" }),
      ]),
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

    await store.dispatch("job-4", "Test Job", Promise.reject(new Error("boom"))).catch(() => {});

    const errorCalls = listener.mock.calls;
    const lastCall = errorCalls[errorCalls.length - 1][0] as Array<{ id: string; state: { status: string; message?: string } }>;
    const job = lastCall.find((j) => j.id === "job-4");
    expect(job?.state.status).toBe("error");
    expect(job?.state.message).toBe("boom");
  });

  it("sets completedAt when job completes", async () => {
    const listener = jest.fn();
    store.subscribe(listener);

    await store.dispatch("job-5", "Test", Promise.resolve());

    const completedCalls = listener.mock.calls;
    const lastCall = completedCalls[completedCalls.length - 1][0] as Array<{ completedAt?: number }>;
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

  it("stops polling after job completes", async () => {
    mockGetJobProgress.mockResolvedValue(null);

    await store.dispatch("job-7", "Test", Promise.resolve());
    mockGetJobProgress.mockClear();

    jest.advanceTimersByTime(4000);
    await Promise.resolve();

    expect(mockGetJobProgress).not.toHaveBeenCalled();
  });
});
