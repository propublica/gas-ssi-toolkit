/**
 * @jest-environment jsdom
 */

const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
  runTool: jest.fn(),
  prepRecipe: jest.fn(),
  getJobProgress: jest.fn(),
  importDriveLinks: jest.fn(),
  extractText: jest.fn(),
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };

// Must import AFTER setting up the mock, and re-import to reset module cache between tests.
let services: typeof import("../src/client/services");

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockRun.withSuccessHandler.mockReturnThis();
  mockRun.withFailureHandler.mockReturnThis();
  services = await import("../src/client/services");
});

function captureHandlers(): { resolve: (v: unknown) => void; reject: (e: Error) => void } {
  let resolve!: (v: unknown) => void;
  let reject!: (e: Error) => void;
  mockRun.withSuccessHandler.mockImplementation((fn: (v: unknown) => void) => {
    resolve = fn;
    return mockRun;
  });
  mockRun.withFailureHandler.mockImplementation((fn: (e: Error) => void) => {
    reject = fn;
    return mockRun;
  });
  return {
    get resolve() {
      return resolve;
    },
    get reject() {
      return reject;
    },
  };
}

describe("getSheetHeaders", () => {
  it("calls google.script.run.getSheetHeaders and resolves with headers", async () => {
    const handlers = captureHandlers();
    const promise = services.getSheetHeaders();
    handlers.resolve(["col_a", "col_b"]);
    const result = await promise;
    expect(result).toEqual(["col_a", "col_b"]);
    expect(mockRun.getSheetHeaders).toHaveBeenCalledTimes(1);
  });

  it("rejects with the error on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.getSheetHeaders();
    handlers.reject(new Error("sheet error"));
    await expect(promise).rejects.toThrow("sheet error");
  });
});

describe("runBatchAI", () => {
  it("calls google.script.run.runBatchAI with config and resolves", async () => {
    const handlers = captureHandlers();
    const config = { promptCols: [{ col: "col_a", kind: "text" }], outputCol: "out" };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.runBatchAI).toHaveBeenCalledWith(config, undefined);
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.runBatchAI({
      promptCols: [],
      outputCol: "out",
    });
    handlers.reject(new Error("api error"));
    await expect(promise).rejects.toThrow("api error");
  });
});

describe("runTool", () => {
  it("calls google.script.run.runTool with the function name and resolves", async () => {
    const handlers = captureHandlers();
    const promise = services.runTool("importDriveLinks");
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.runTool).toHaveBeenCalledWith("importDriveLinks", undefined);
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.runTool("importDriveLinks");
    handlers.reject(new Error("tool error"));
    await expect(promise).rejects.toThrow("tool error");
  });
});

describe("prepRecipe", () => {
  it("calls google.script.run.prepRecipe with params and resolves with result", async () => {
    const handlers = captureHandlers();
    const params: import("../src/shared/types").PrepRecipeParams = {
      cols: [
        { colTitle: "Drive Link", strategy: { kind: "list-drive-folder", url: "https://drive.google.com/folder/abc" } },
        { colTitle: "AI_Summarization", strategy: { kind: "create-empty" } },
      ],
    };
    const result: import("../src/shared/types").PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
    };
    const promise = services.prepRecipe(params);
    handlers.resolve(result);
    await expect(promise).resolves.toEqual(result);
    expect(mockRun.prepRecipe).toHaveBeenCalledWith(params);
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.prepRecipe({ cols: [] });
    handlers.reject(new Error("prep error"));
    await expect(promise).rejects.toThrow("prep error");
  });
});

describe("importDriveLinks", () => {
  it("calls google.script.run.importDriveLinks with config and jobId and resolves", async () => {
    const handlers = captureHandlers();
    const config = {
      folderUrl: "https://drive.google.com/drive/folders/abc",
      outputCol: "source_drive",
    };
    const promise = services.importDriveLinks(config, "job-1");
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.importDriveLinks).toHaveBeenCalledWith(config, "job-1");
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const config = {
      folderUrl: "https://drive.google.com/drive/folders/abc",
      outputCol: "source_drive",
    };
    const promise = services.importDriveLinks(config, "job-1");
    handlers.reject(new Error("drive error"));
    await expect(promise).rejects.toThrow("drive error");
  });
});

describe("extractText", () => {
  it("calls google.script.run.extractText with config and jobId and resolves", async () => {
    const handlers = captureHandlers();
    const config: import("../src/shared/types").ExtractTextConfig = {
      sourceCol: "source_drive",
      outputCol: "source_text",
      rowRange: { start: 2, end: 10 },
    };
    const promise = services.extractText(config, "job-2");
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.extractText).toHaveBeenCalledWith(config, "job-2");
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const config: import("../src/shared/types").ExtractTextConfig = {
      sourceCol: "source_drive",
      outputCol: "source_text",
      rowRange: { start: 2, end: 10 },
    };
    const promise = services.extractText(config, "job-2");
    handlers.reject(new Error("extract error"));
    await expect(promise).rejects.toThrow("extract error");
  });
});

describe("getJobProgress", () => {
  it("calls google.script.run.getJobProgress with jobId and resolves with progress", async () => {
    const handlers = captureHandlers();
    const progress = { message: "Processing row 2 of 10", current: 2, total: 10 };
    const promise = services.getJobProgress("job-123");
    handlers.resolve(progress);
    await expect(promise).resolves.toEqual(progress);
    expect(mockRun.getJobProgress).toHaveBeenCalledWith("job-123");
  });

  it("resolves with null when no progress is available", async () => {
    const handlers = captureHandlers();
    const promise = services.getJobProgress("job-456");
    handlers.resolve(null);
    await expect(promise).resolves.toBeNull();
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.getJobProgress("job-789");
    handlers.reject(new Error("progress error"));
    await expect(promise).rejects.toThrow("progress error");
  });
});
