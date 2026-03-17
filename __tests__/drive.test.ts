/**
 * Tests for src/server/drive.ts
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockAlert = jest.fn();
const mockUi = {
  alert: mockAlert,
  ButtonSet: { OK: "OK" },
};

(globalThis as any).Drive = {
  Files: {
    export: jest.fn(),
  },
};

(globalThis as any).DriveApp = {
  getFileById: jest.fn(),
};

(globalThis as any).DocumentApp = {
  openById: jest.fn(),
};

(globalThis as any).SpreadsheetApp = {
  openById: jest.fn(),
};

(globalThis as any).Utilities = {
  base64Encode: jest.fn().mockReturnValue("base64data=="),
  Charset: { UTF_8: "UTF-8" },
};

(globalThis as any).MimeType = {
  GOOGLE_DOCS: "application/vnd.google-apps.document",
  GOOGLE_SHEETS: "application/vnd.google-apps.spreadsheet",
  PDF: "application/pdf",
};

// ── Import after mocks ─────────────────────────────────────────

import {
  checkDriveService,
  extractTextUniversal,
  prepareDriveAttachments,
} from "../src/server/drive";

// ── Tests ──────────────────────────────────────────────────────

describe("checkDriveService", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    (globalThis as any).Drive = { Files: {} };
  });

  it("returns true when Drive.Files is accessible", () => {
    (globalThis as any).Drive = { Files: {} };
    expect(checkDriveService(mockUi as any)).toBe(true);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("returns false and shows alert when Drive.Files throws", () => {
    (globalThis as any).Drive = {
      get Files() {
        throw new Error("Not enabled");
      },
    };
    expect(checkDriveService(mockUi as any)).toBe(false);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });
});

describe("extractTextUniversal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as any).Drive = { Files: {} };
  });

  it("reads text directly from a Google Doc", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/vnd.google-apps.document",
    });
    (DocumentApp.openById as jest.Mock).mockReturnValue({
      getBody: () => ({ getText: () => "doc body text" }),
    });

    expect(extractTextUniversal("docId123")).toBe("doc body text");
  });

  it("performs OCR and returns text for a PDF", () => {
    const mockBlob = {};
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getName: () => "report.pdf",
      getBlob: () => mockBlob,
    });
    (globalThis as any).Drive = {
      Files: {
        create: jest.fn().mockReturnValue({ id: "tempDocId" }),
        remove: jest.fn(),
      },
    };
    (DocumentApp.openById as jest.Mock).mockReturnValue({
      getBody: () => ({ getText: () => "ocr text from pdf" }),
    });

    expect(extractTextUniversal("pdfId123")).toBe("ocr text from pdf");
    expect((Drive.Files as any).remove).toHaveBeenCalledWith("tempDocId");
  });

  it("returns skip message for unsupported file types", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/zip",
    });

    expect(extractTextUniversal("zipId123")).toBe("[Skipped: Unsupported Type]");
  });

  it("returns error string when an exception is thrown", () => {
    (DriveApp.getFileById as jest.Mock).mockImplementation(() => {
      throw new Error("File not found");
    });

    expect(extractTextUniversal("badId")).toBe("[Error: File not found]");
  });

  it("performs OCR for image files", () => {
    const mockBlob = {};
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "image/png",
      getName: () => "scan.png",
      getBlob: () => mockBlob,
    });
    (globalThis as any).Drive = {
      Files: {
        create: jest.fn().mockReturnValue({ id: "tempImgDocId" }),
        remove: jest.fn(),
      },
    };
    (DocumentApp.openById as jest.Mock).mockReturnValue({
      getBody: () => ({ getText: () => "ocr text from image" }),
    });

    expect(extractTextUniversal("imgId123")).toBe("ocr text from image");
    expect((Drive.Files as any).remove).toHaveBeenCalledWith("tempImgDocId");
  });
});

describe("prepareDriveAttachments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as any).Drive = {
      Files: { export: jest.fn() },
    };
  });

  it("returns empty array for empty input", () => {
    expect(prepareDriveAttachments([])).toEqual([]);
  });

  it("encodes a PDF by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 1024,
      getName: () => "report.pdf",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["pdfId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("application/pdf");
    expect(result[0].data).toBe("base64data==");
  });

  it("encodes an image by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "image/png",
      getSize: () => 512,
      getName: () => "photo.png",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["imgId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("image/png");
  });

  it("encodes a video by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "video/mp4",
      getSize: () => 1024,
      getName: () => "clip.mp4",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["videoId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("video/mp4");
  });

  it("encodes an audio file by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "audio/mpeg",
      getSize: () => 512,
      getName: () => "audio.mp3",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["audioId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("audio/mpeg");
  });

  it("exports a Google Doc as PDF", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/vnd.google-apps.document",
      getName: () => "doc.gdoc",
    });
    (Drive.Files.export as jest.Mock).mockReturnValue({
      getBytes: () => [1, 2, 3],
    });

    const result = prepareDriveAttachments(["docId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("application/pdf");
    expect(Drive.Files.export).toHaveBeenCalledWith("docId", "application/pdf");
  });

  it("exports each sheet of a Google Sheets file as a separate CSV part", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/vnd.google-apps.spreadsheet",
      getName: () => "data.gsheet",
    });
    const mockSheet1 = {
      getName: () => "Sheet1",
      getDataRange: () => ({
        getValues: () => [
          ["a", "b"],
          ["1", "2"],
        ],
      }),
    };
    const mockSheet2 = {
      getName: () => "Sheet2",
      getDataRange: () => ({
        getValues: () => [
          ["x", "y"],
          ["3", "4"],
        ],
      }),
    };
    (SpreadsheetApp.openById as jest.Mock).mockReturnValue({
      getSheets: () => [mockSheet1, mockSheet2],
    });

    const result = prepareDriveAttachments(["sheetId"]);
    expect(result).toHaveLength(2);
    expect(result[0].mime_type).toBe("text/csv");
    expect(result[1].mime_type).toBe("text/csv");
    expect(Utilities.base64Encode).toHaveBeenCalledTimes(2);
  });

  it("throws a descriptive error for unsupported file types", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/zip",
      getName: () => "archive.zip",
    });

    expect(() => prepareDriveAttachments(["zipId"])).toThrow("Unsupported file type");
  });

  it("throws pre-flight error for PDF exceeding raw size threshold before downloading blob", () => {
    // 36MB raw * 4/3 = 48MB encoded > 47MB INLINE_MAX_PDF_BYTES
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 36 * 1024 * 1024,
      getName: () => "big.pdf",
    });

    expect(() => prepareDriveAttachments(["bigPdfId"])).toThrow("File too large");
    // blob should NOT have been fetched
    expect(DriveApp.getFileById("bigPdfId").getBlob).toBeUndefined();
  });

  it("throws per-PDF error mentioning Files API when encoded PDF exceeds 47MB", () => {
    const ALMOST_PREFLIGHT = Math.floor((47 * 1024 * 1024) / (4 / 3)) - 1;
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => ALMOST_PREFLIGHT,
      getName: () => "large.pdf",
      getBlob: () => ({ getBytes: () => new Array(ALMOST_PREFLIGHT).fill(0) }),
    });
    // Return a data string whose .length exceeds INLINE_MAX_PDF_BYTES
    (Utilities.base64Encode as jest.Mock).mockReturnValue("x".repeat(48 * 1024 * 1024));

    expect(() => prepareDriveAttachments(["largePdfId"])).toThrow(/PDF.*too large|too large.*PDF/i);
  });

  it("throws total request error mentioning Files API when combined encoded size exceeds 95MB", () => {
    // Two images, each fine individually, combined > 95MB encoded
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "image/jpeg",
      getSize: () => 1024,
      getName: () => "img.jpg",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });
    (Utilities.base64Encode as jest.Mock).mockReturnValue(
      "x".repeat(50 * 1024 * 1024), // 50MB each → 100MB total > 95MB
    );

    expect(() => prepareDriveAttachments(["img1", "img2"])).toThrow(/combined|total/i);
  });

  it("error messages reference the Gemini Files API escape hatch", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 36 * 1024 * 1024,
      getName: () => "big.pdf",
    });

    expect(() => prepareDriveAttachments(["bigPdfId"])).toThrow(/Files API/i);
  });

  it("returns combined parts from multiple files of different types", () => {
    (DriveApp.getFileById as jest.Mock)
      .mockReturnValueOnce({
        getMimeType: () => "application/pdf",
        getSize: () => 1024,
        getName: () => "doc.pdf",
        getBlob: () => ({ getBytes: () => [1, 2, 3] }),
      })
      .mockReturnValueOnce({
        getMimeType: () => "image/png",
        getSize: () => 512,
        getName: () => "chart.png",
        getBlob: () => ({ getBytes: () => [4, 5, 6] }),
      });

    const result = prepareDriveAttachments(["pdfId", "imgId"]);
    expect(result).toHaveLength(2);
    expect(result[0].mime_type).toBe("application/pdf");
    expect(result[1].mime_type).toBe("image/png");
  });
});
