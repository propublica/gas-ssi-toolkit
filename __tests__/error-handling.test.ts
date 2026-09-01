/**
 * Tests for src/server/error-handling.ts
 */

import {
  DomainError,
  logError,
  toSafeMessage,
  formatCellError,
  withErrorScrubbing,
  GENERIC_FAILURE_MESSAGE,
} from "../src/server/error-handling";

describe("DomainError", () => {
  it("is an instance of Error", () => {
    expect(new DomainError("known") instanceof Error).toBe(true);
  });

  it("preserves the message it was constructed with", () => {
    expect(new DomainError("known reason").message).toBe("known reason");
  });
});

describe("toSafeMessage", () => {
  it("returns a DomainError's own message verbatim", () => {
    expect(toSafeMessage(new DomainError("safe detail"), "fallback")).toBe("safe detail");
  });

  it("returns the fallback for a plain Error", () => {
    expect(toSafeMessage(new Error("raw internal detail"), "fallback")).toBe("fallback");
  });

  it("returns the fallback for a non-Error thrown value", () => {
    expect(toSafeMessage("some string was thrown", "fallback")).toBe("fallback");
    expect(toSafeMessage(undefined, "fallback")).toBe("fallback");
  });
});

describe("formatCellError", () => {
  it("wraps the message in brackets with an Error prefix", () => {
    expect(formatCellError("something failed")).toBe("[Error: something failed]");
  });
});

describe("logError", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("logs the site and the error's constructor name for an Error instance", () => {
    logError("mySite", new DomainError("secret internal detail"));
    expect(consoleErrorSpy).toHaveBeenCalledWith("mySite", { kind: "DomainError" });
  });

  it("logs typeof for a non-Error thrown value", () => {
    logError("mySite", "a raw string was thrown");
    expect(consoleErrorSpy).toHaveBeenCalledWith("mySite", { kind: "string" });
  });

  it("never includes the caught error's message in the log call", () => {
    logError("mySite", new Error("cell content that must not be retained"));
    const loggedArgs = JSON.stringify(consoleErrorSpy.mock.calls[0]);
    expect(loggedArgs).not.toContain("cell content that must not be retained");
  });

  it("passes through numeric and boolean meta fields", () => {
    logError("mySite", new Error("x"), { httpCode: 503, wasTruncated: true });
    expect(consoleErrorSpy).toHaveBeenCalledWith("mySite", {
      kind: "Error",
      httpCode: 503,
      wasTruncated: true,
    });
  });
});

describe("withErrorScrubbing", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns the callback's result when it succeeds", () => {
    expect(withErrorScrubbing("site", () => "ok")).toBe("ok");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("rethrows a DomainError's message verbatim without logging it", () => {
    expect(() =>
      withErrorScrubbing("site", () => {
        throw new DomainError('Column "Foo" not found');
      }),
    ).toThrow('Column "Foo" not found');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs and throws the generic fallback for a non-DomainError exception", () => {
    expect(() =>
      withErrorScrubbing("Import Drive Links", () => {
        throw new Error("Drive Advanced Service internal detail");
      }),
    ).toThrow(GENERIC_FAILURE_MESSAGE);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Import Drive Links", { kind: "Error" });
  });

  it("never includes the caught exception's message in the thrown error", () => {
    let thrown: Error | undefined;
    try {
      withErrorScrubbing("site", () => {
        throw new Error("cell content that must not be retained");
      });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).not.toContain("cell content that must not be retained");
  });
});
