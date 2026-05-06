/**
 * Tests for src/server/files.ts
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetchAll: jest.fn(),
};

// ── Import after mocks ─────────────────────────────────────────

import { uploadFilesToGemini } from "../src/server/files";

// ── Helpers ────────────────────────────────────────────────────

function makeBlob(id: string): GoogleAppsScript.Base.Blob {
  return { __id: id } as unknown as GoogleAppsScript.Base.Blob;
}

function mockInitResponse(sessionUri: string) {
  return {
    getResponseCode: () => 200,
    getHeaders: () => ({ "x-goog-upload-url": sessionUri }),
  };
}

function mockUploadResponse(uri: string, mimeType: string) {
  return {
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ file: { uri, mimeType } }),
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("uploadFilesToGemini", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns a map of fileId to uri and mimeType", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([
        mockInitResponse("https://upload.example.com/s1"),
        mockInitResponse("https://upload.example.com/s2"),
      ])
      .mockReturnValueOnce([
        mockUploadResponse(
          "https://generativelanguage.googleapis.com/v1beta/files/abc",
          "application/pdf",
        ),
        mockUploadResponse(
          "https://generativelanguage.googleapis.com/v1beta/files/def",
          "image/png",
        ),
      ]);

    const files = new Map([
      ["file1", makeBlob("file1")],
      ["file2", makeBlob("file2")],
    ]);
    const mimeTypes = new Map([
      ["file1", "application/pdf"],
      ["file2", "image/png"],
    ]);
    const { uploads } = uploadFilesToGemini(files, mimeTypes, "test-key");
    expect(uploads.get("file1")).toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      mimeType: "application/pdf",
    });
    expect(uploads.get("file2")).toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/def",
      mimeType: "image/png",
    });
  });

  it("returns empty map for empty input", () => {
    const { uploads } = uploadFilesToGemini(new Map(), new Map(), "key");
    expect(uploads.size).toBe(0);
    expect(UrlFetchApp.fetchAll as jest.Mock).not.toHaveBeenCalled();
  });

  it("records error when init request returns HTTP error", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValueOnce([
      { getResponseCode: () => 429, getHeaders: () => ({}) },
    ]);
    const files = new Map([["fileId", makeBlob("fileId")]]);
    const mimeTypes = new Map([["fileId", "application/pdf"]]);
    const { uploads, errors } = uploadFilesToGemini(files, mimeTypes, "key");
    expect(uploads.size).toBe(0);
    expect(errors.get("fileId")).toContain("429");
  });

  it("records error when init response is missing session URI", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValueOnce([
      { getResponseCode: () => 200, getHeaders: () => ({}) },
    ]);
    const files = new Map([["fileId", makeBlob("fileId")]]);
    const mimeTypes = new Map([["fileId", "application/pdf"]]);
    const { uploads, errors } = uploadFilesToGemini(files, mimeTypes, "key");
    expect(uploads.size).toBe(0);
    expect(errors.get("fileId")).toContain("session URI");
  });

  it("records error when upload response contains error in body", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse("https://upload.example.com/s1")])
      .mockReturnValueOnce([
        {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ error: { message: "quota exceeded" } }),
        },
      ]);
    const files = new Map([["fileId", makeBlob("fileId")]]);
    const mimeTypes = new Map([["fileId", "application/pdf"]]);
    const { uploads, errors } = uploadFilesToGemini(files, mimeTypes, "key");
    expect(uploads.size).toBe(0);
    expect(errors.get("fileId")).toContain("quota exceeded");
  });

  it("records error when upload response returns HTTP error status", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse("https://upload.example.com/s1")])
      .mockReturnValueOnce([{ getResponseCode: () => 429, getContentText: () => "" }]);
    const files = new Map([["fileId", makeBlob("fileId")]]);
    const mimeTypes = new Map([["fileId", "application/pdf"]]);
    const { uploads, errors } = uploadFilesToGemini(files, mimeTypes, "key");
    expect(uploads.size).toBe(0);
    expect(errors.get("fileId")).toContain("429");
  });

  it("records error when upload response contains non-JSON body", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse("https://upload.example.com/s1")])
      .mockReturnValueOnce([
        { getResponseCode: () => 200, getContentText: () => "<html>error</html>" },
      ]);
    const files = new Map([["fileId", makeBlob("fileId")]]);
    const mimeTypes = new Map([["fileId", "application/pdf"]]);
    const { uploads, errors } = uploadFilesToGemini(files, mimeTypes, "key");
    expect(uploads.size).toBe(0);
    expect(errors.get("fileId")).toContain("Invalid JSON");
  });

  it("sends resumable protocol headers in init request", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse("https://upload.example.com/s1")])
      .mockReturnValueOnce([mockUploadResponse("https://example.com/f1", "application/pdf")]);
    uploadFilesToGemini(
      new Map([["f1", makeBlob("f1")]]),
      new Map([["f1", "application/pdf"]]),
      "key",
    );
    const initCall = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(initCall[0].headers["X-Goog-Upload-Protocol"]).toBe("resumable");
    expect(initCall[0].headers["X-Goog-Upload-Command"]).toBe("start");
    expect(initCall[0].headers["X-Goog-Upload-Header-Content-Type"]).toBe("application/pdf");
  });

  it("passes Blob directly as payload in upload request — no Array.from()", () => {
    const blob = makeBlob("f1");
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse("https://upload.example.com/s1")])
      .mockReturnValueOnce([mockUploadResponse("https://example.com/f1", "application/pdf")]);
    uploadFilesToGemini(new Map([["f1", blob]]), new Map([["f1", "application/pdf"]]), "key");
    const uploadCall = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[1][0];
    expect(uploadCall[0].payload).toBe(blob);
  });

  it("uses the session URI from the init response as the upload URL", () => {
    const sessionUri = "https://upload.example.com/unique-session-123";
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse(sessionUri)])
      .mockReturnValueOnce([mockUploadResponse("https://example.com/f1", "application/pdf")]);
    uploadFilesToGemini(
      new Map([["f1", makeBlob("f1")]]),
      new Map([["f1", "application/pdf"]]),
      "key",
    );
    const uploadCall = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[1][0];
    expect(uploadCall[0].url).toBe(sessionUri);
  });

  it("skips upload phase entirely when all init requests fail", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValueOnce([
      { getResponseCode: () => 503, getHeaders: () => ({}) },
      { getResponseCode: () => 503, getHeaders: () => ({}) },
    ]);
    const files = new Map([
      ["f1", makeBlob("f1")],
      ["f2", makeBlob("f2")],
    ]);
    const mimeTypes = new Map([
      ["f1", "application/pdf"],
      ["f2", "application/pdf"],
    ]);
    const { uploads, errors } = uploadFilesToGemini(files, mimeTypes, "key");
    expect(UrlFetchApp.fetchAll as jest.Mock).toHaveBeenCalledTimes(1);
    expect(uploads.size).toBe(0);
    expect(errors.size).toBe(2);
  });
});
