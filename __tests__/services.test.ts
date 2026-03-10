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
    const config = { userPromptCols: ["col_a"], outputCol: "out" };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.runBatchAI).toHaveBeenCalledWith(config);
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.runBatchAI({
      userPromptCols: [],
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
    expect(mockRun.runTool).toHaveBeenCalledWith("importDriveLinks");
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
      driveFolder: { url: "https://drive.google.com/folder/abc", colTitle: "Drive Link" },
      outputCol: { colTitle: "AI_Summarization" },
    };
    const result: import("../src/shared/types").PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      colNames: { driveLink: "Drive Link", outputCol: "AI_Summarization" },
    };
    const promise = services.prepRecipe(params);
    handlers.resolve(result);
    await expect(promise).resolves.toEqual(result);
    expect(mockRun.prepRecipe).toHaveBeenCalledWith(params);
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.prepRecipe({});
    handlers.reject(new Error("prep error"));
    await expect(promise).rejects.toThrow("prep error");
  });
});
