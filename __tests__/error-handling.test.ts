/**
 * Tests for src/server/error-handling.ts
 */

import {
  DomainError,
  logError,
  toSafeMessage,
  formatCellError,
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
