/**
 * Tests for src/server/files.ts
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetchAll: jest.fn(),
};

// ── Import after mocks ─────────────────────────────────────────

import { uploadFilesToGemini } from "../src/server/files";

// ── Tests ──────────────────────────────────────────────────────

describe("uploadFilesToGemini", () => {
  beforeEach(() => jest.clearAllMocks());

  function mockUploadResponse(fileId: string, uri: string, mimeType: string) {
    return {
      getContentText: () => JSON.stringify({ file: { name: `files/${fileId}`, uri, mimeType } }),
    };
  }

  it("returns a map of fileId to uri and mimeType", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      mockUploadResponse(
        "file1",
        "https://generativelanguage.googleapis.com/v1beta/files/abc",
        "application/pdf",
      ),
      mockUploadResponse(
        "file2",
        "https://generativelanguage.googleapis.com/v1beta/files/def",
        "image/png",
      ),
    ]);
    const files = new Map([
      ["file1", new Uint8Array([1, 2, 3])],
      ["file2", new Uint8Array([4, 5, 6])],
    ]);
    const mimeTypes = new Map([
      ["file1", "application/pdf"],
      ["file2", "image/png"],
    ]);
    const result = uploadFilesToGemini(files, mimeTypes, "test-key");
    expect(result.get("file1")).toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      mimeType: "application/pdf",
    });
    expect(result.get("file2")).toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/def",
      mimeType: "image/png",
    });
  });

  it("returns empty map for empty input", () => {
    const result = uploadFilesToGemini(new Map(), new Map(), "key");
    expect(result.size).toBe(0);
    expect(UrlFetchApp.fetchAll as jest.Mock).not.toHaveBeenCalled();
  });

  it("throws when Files API returns an error", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getContentText: () => JSON.stringify({ error: { message: "quota exceeded" } }) },
    ]);
    const files = new Map([["fileId", new Uint8Array([1])]]);
    const mimeTypes = new Map([["fileId", "application/pdf"]]);
    expect(() => uploadFilesToGemini(files, mimeTypes, "key")).toThrow("quota exceeded");
  });

  it("processes files in sub-batches of 10", () => {
    const fileIds = Array.from({ length: 25 }, (_, i) => `file${i}`);
    const files = new Map(fileIds.map((id) => [id, new Uint8Array([1])]));
    const mimeTypes = new Map(fileIds.map((id) => [id, "application/pdf"]));

    const singleResponse = (id: string) => ({
      getContentText: () =>
        JSON.stringify({ file: { uri: `https://example.com/${id}`, mimeType: "application/pdf" } }),
    });

    // Three batches: 10 + 10 + 5
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce(fileIds.slice(0, 10).map(singleResponse))
      .mockReturnValueOnce(fileIds.slice(10, 20).map(singleResponse))
      .mockReturnValueOnce(fileIds.slice(20, 25).map(singleResponse));

    const result = uploadFilesToGemini(files, mimeTypes, "key");
    expect(UrlFetchApp.fetchAll as jest.Mock).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(25);
  });

  it("sends multipart content-type header", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      mockUploadResponse("f1", "https://example.com/f1", "application/pdf"),
    ]);
    uploadFilesToGemini(
      new Map([["f1", new Uint8Array([1])]]),
      new Map([["f1", "application/pdf"]]),
      "key",
    );
    const calls = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(calls[0].contentType).toMatch(/multipart\/related/);
    expect(calls[0].headers["X-Goog-Upload-Protocol"]).toBe("multipart");
  });
});
