/**
 * @jest-environment jsdom
 */

const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  getSheetHeaders: jest.fn(),
  getActiveRangeInfo: jest.fn(),
  runBatchAI: jest.fn(),
  runTool: jest.fn(),
  prepRecipe: jest.fn(),
  getJobProgress: jest.fn(),
  importDriveLinks: jest.fn(),
  extractText: jest.fn(),
  formatMarkdownSelection: jest.fn(),
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

describe("normalizeNulls", () => {
  it("returns primitives unchanged", () => {
    expect(services.normalizeNulls(5)).toBe(5);
    expect(services.normalizeNulls("x")).toBe("x");
    expect(services.normalizeNulls(true)).toBe(true);
  });

  it("converts a top-level null to undefined — no position-dependent exception", () => {
    expect(services.normalizeNulls(null)).toBeUndefined();
  });

  it("preserves a top-level undefined unchanged", () => {
    expect(services.normalizeNulls(undefined)).toBeUndefined();
  });

  it("converts a null object property to undefined", () => {
    expect(services.normalizeNulls({ a: null, b: "x" })).toEqual({ a: undefined, b: "x" });
  });

  it("converts a null array element to undefined", () => {
    expect(services.normalizeNulls([1, null, "x"])).toEqual([1, undefined, "x"]);
  });

  it("normalizes null at any nesting depth", () => {
    expect(services.normalizeNulls({ config: { systemPromptCol: null, tools: [] } })).toEqual({
      config: { systemPromptCol: undefined, tools: [] },
    });
  });

  it("leaves an object with no nulls completely unchanged", () => {
    const value = { promptCols: [{ col: "a", kind: "text" }], model: "gemini-3.1-flash-lite" };
    expect(services.normalizeNulls(value)).toEqual(value);
  });
});

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

  it("resolves with the RunStats returned by the RPC call", async () => {
    const handlers = captureHandlers();
    const config = { promptCols: [{ col: "col_a", kind: "text" }], outputCol: "out" };
    const stats = {
      rowCount: 10,
      totalTimeMs: 4200,
      totalInputTokens: 500,
      totalOutputTokens: 300,
      totalTokenCost: 0.002,
      totalGroundingQueries: 0,
      totalGroundingCost: 0,
      testedAt: 1234567890,
      config: {
        promptCols: [{ col: "col_a", kind: "text" }],
        tools: [],
        prefixWithColName: false,
      },
    };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve(stats);
    await expect(promise).resolves.toEqual(stats);
  });

  it("resolves with undefined when the RPC call returns null", async () => {
    const handlers = captureHandlers();
    const config = { promptCols: [{ col: "col_a", kind: "text" }], outputCol: "out" };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve(null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("normalizes a null nested inside the returned config (google.script.run boundary coercion)", async () => {
    const handlers = captureHandlers();
    const config = { promptCols: [{ col: "col_a", kind: "text" }], outputCol: "out" };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve({
      rowCount: 10,
      totalTimeMs: 1000,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokenCost: 0.001,
      totalGroundingQueries: 0,
      totalGroundingCost: 0,
      testedAt: 1234567890,
      config: {
        promptCols: [{ col: "col_a", kind: "text" }],
        systemPromptCol: null, // as google.script.run's bridge may deliver an omitted value
        tools: [],
        prefixWithColName: false,
        model: null,
      },
    });
    const result = await promise;
    expect(result?.config.systemPromptCol).toBeUndefined();
    expect(result?.config.model).toBeUndefined();
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
        { colTitle: "Drive Link", fillStrategy: { kind: "list-drive-folder", inputId: "folder" } },
        { colTitle: "AI_Summarization", fillStrategy: { kind: "create-empty" } },
      ],
      inputValues: { folder: "https://drive.google.com/drive/folders/abc123" },
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
    const promise = services.prepRecipe({ cols: [], inputValues: {} });
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

  it("resolves with undefined when no progress is available", async () => {
    const handlers = captureHandlers();
    const promise = services.getJobProgress("job-456");
    handlers.resolve(null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.getJobProgress("job-789");
    handlers.reject(new Error("progress error"));
    await expect(promise).rejects.toThrow("progress error");
  });
});

describe("getActiveRangeInfo", () => {
  it("calls google.script.run.getActiveRangeInfo and resolves with range", async () => {
    const handlers = captureHandlers();
    const range = { start: 1, end: 5 };
    const promise = services.getActiveRangeInfo();
    handlers.resolve(range);
    await expect(promise).resolves.toEqual(range);
    expect(mockRun.getActiveRangeInfo).toHaveBeenCalledTimes(1);
  });

  it("resolves with undefined when no range is active", async () => {
    const handlers = captureHandlers();
    const promise = services.getActiveRangeInfo();
    handlers.resolve(null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.getActiveRangeInfo();
    handlers.reject(new Error("range error"));
    await expect(promise).rejects.toThrow("range error");
  });
});

describe("formatMarkdownSelection", () => {
  it("calls google.script.run.formatMarkdownSelection and resolves", async () => {
    const handlers = captureHandlers();
    const promise = services.formatMarkdownSelection();
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.formatMarkdownSelection).toHaveBeenCalledTimes(1);
  });

  it("rejects when the RPC fails", async () => {
    const handlers = captureHandlers();
    const promise = services.formatMarkdownSelection();
    handlers.reject(new Error("GAS error"));
    await expect(promise).rejects.toThrow("GAS error");
  });
});
