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
  Files: {},
};

(globalThis as any).DriveApp = {
  getFileById: jest.fn(),
};

(globalThis as any).DocumentApp = {
  openById: jest.fn(),
};

(globalThis as any).MimeType = {
  GOOGLE_DOCS: "application/vnd.google-apps.document",
  PDF: "application/pdf",
};

// ── Import after mocks ─────────────────────────────────────────

import { checkDriveService, extractTextUniversal } from "../src/server/drive";

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
      getMimeType: () => MimeType.GOOGLE_DOCS,
    });
    (DocumentApp.openById as jest.Mock).mockReturnValue({
      getBody: () => ({ getText: () => "doc body text" }),
    });

    expect(extractTextUniversal("docId123")).toBe("doc body text");
  });

  it("performs OCR and returns text for a PDF", () => {
    const mockBlob = {};
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => MimeType.PDF,
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
