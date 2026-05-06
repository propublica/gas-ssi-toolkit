# Fix Coverage Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address failing coverage thresholds in `src/server/drive.ts` and `src/client/services.ts` by adding targeted unit tests.

**Architecture:** Add missing test cases to existing Jest test files to exercise uncovered functions and branches. No source code changes required.

**Tech Stack:** Jest, ts-jest

---

### Task 1: Add tests for `getActiveRangeInfo` in `services.test.ts`

**Files:**
- Modify: `__tests__/services.test.ts`

- [ ] **Step 1: Add test block for `getActiveRangeInfo`**

Append to the end of `__tests__/services.test.ts`:

```typescript
describe("getActiveRangeInfo", () => {
  it("calls google.script.run.getActiveRangeInfo and resolves with range", async () => {
    const handlers = captureHandlers();
    const range = { start: 1, end: 5 };
    const promise = services.getActiveRangeInfo();
    handlers.resolve(range);
    await expect(promise).resolves.toEqual(range);
    expect(mockRun.getActiveRangeInfo).toHaveBeenCalledTimes(1);
  });

  it("resolves with null when no range is active", async () => {
    const handlers = captureHandlers();
    const promise = services.getActiveRangeInfo();
    handlers.resolve(null);
    await expect(promise).resolves.toBeNull();
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.getActiveRangeInfo();
    handlers.reject(new Error("range error"));
    await expect(promise).rejects.toThrow("range error");
  });
});
```

- [ ] **Step 2: Run tests to verify**

Run: `npx jest __tests__/services.test.ts`
Expected: All tests pass, including the 3 new ones.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services.test.ts
git commit -m "test(client): add tests for getActiveRangeInfo service"
```

---

### Task 2: Add branch coverage tests to `drive.test.ts`

**Files:**
- Modify: `__tests__/drive.test.ts`

- [ ] **Step 1: Add error-handling and default branch tests to `fetchDriveMetadata`**

Append to the `describe("fetchDriveMetadata", ...)` block in `__tests__/drive.test.ts`:

```typescript
  it("handles non-JSON error responses in fetchDriveMetadata", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      {
        getResponseCode: () => 400,
        getContentText: () => "Not a JSON string",
      },
    ]);
    const { errors } = fetchDriveMetadata(["id"], "token");
    expect(errors.get("id")).toBe("HTTP 400");
  });

  it("handles JSON error responses missing message in fetchDriveMetadata", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      {
        getResponseCode: () => 400,
        getContentText: () => JSON.stringify({ error: {} }),
      },
    ]);
    const { errors } = fetchDriveMetadata(["id"], "token");
    expect(errors.get("id")).toBe("HTTP 400");
  });

  it("uses default mimeType and size when missing in JSON response", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({}),
      },
    ]);
    const { metadata } = fetchDriveMetadata(["id"], "token");
    expect(metadata.get("id")).toEqual({
      mimeType: "application/octet-stream",
      size: 0,
    });
  });
```

- [ ] **Step 2: Add error-handling branch tests to `downloadDriveFiles`**

Append to the `describe("downloadDriveFiles", ...)` block in `__tests__/drive.test.ts`:

```typescript
  it("handles non-JSON error responses in downloadDriveFiles", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getResponseCode: () => 500, getContentText: () => "Server Error" },
    ]);
    const { errors } = downloadDriveFiles(["id"], new Map(), "token");
    expect(errors.get("id")).toBe("HTTP 500");
  });

  it("handles JSON error responses missing message in downloadDriveFiles", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getResponseCode: () => 401, getContentText: () => JSON.stringify({ error: {} }) },
    ]);
    const { errors } = downloadDriveFiles(["id"], new Map(), "token");
    expect(errors.get("id")).toBe("HTTP 401");
  });
```

- [ ] **Step 3: Run tests to verify**

Run: `npx jest __tests__/drive.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add __tests__/drive.test.ts
git commit -m "test(server): add edge-case branch tests for Drive API calls"
```

---

### Task 3: Final Coverage Verification

- [ ] **Step 1: Run full coverage suite**

Run: `npm run test:coverage`

- [ ] **Step 2: Verify thresholds**

Expected:
- `src/client/services.ts`: Functions: 100%
- `src/server/drive.ts`: Branches: >= 95%
- All tests pass, process exits with code 0.
