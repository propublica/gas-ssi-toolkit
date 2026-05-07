# Fix Coverage Thresholds Design

**Goal:** Address failing coverage thresholds in `src/server/drive.ts` (branches) and `src/client/services.ts` (functions) by adding targeted test cases.

**Targeted Failures:**
1. `src/client/services.ts`: Functions 100% threshold not met (Currently 87.5% because `getActiveRangeInfo` is untested).
2. `src/server/drive.ts`: Branches 95% threshold not met (Currently 88.52% because error-handling branches in `fetchDriveMetadata` and `downloadDriveFiles` are not fully exercised).

## Proposed Changes

### 1. `__tests__/services.test.ts`
- Add a new `describe("getActiveRangeInfo", ...)` block.
- **Test Case 1 (Success)**: Verify it calls `google.script.run.getActiveRangeInfo` and resolves with the returned range `{ start: number, end: number }`.
- **Test Case 2 (Failure)**: Verify it rejects with the error when the failure handler is triggered.

### 2. `__tests__/drive.test.ts`
- Add test cases to `describe("fetchDriveMetadata", ...)`:
    - **Branch Coverage: JSON Parse Error**: Mock a response with code 400 and invalid JSON in `getContentText`.
    - **Branch Coverage: Missing error message**: Mock a response with code 400 and JSON that doesn't contain `error.message`.
    - **Branch Coverage: Missing mimeType/size**: Mock a response with code 200 and JSON missing `mimeType` and `size` fields to exercise the `??` defaults.
- Add test cases to `describe("downloadDriveFiles", ...)`:
    - **Branch Coverage: JSON Parse Error**: Mock a response with code 400 and invalid JSON.
    - **Branch Coverage: Missing error message**: Mock a response with code 400 and JSON missing `error.message`.

## Verification Plan
1. Run `npm run test:coverage`.
2. Confirm `src/client/services.ts` shows 100% functions.
3. Confirm `src/server/drive.ts` shows > 95% branches.
4. Ensure all other tests still pass.
