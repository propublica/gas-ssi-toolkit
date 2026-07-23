import type {
  ExtractTextConfig,
  ImportDriveLinksConfig,
  PrepRecipeParams,
  PrepRecipeResult,
  RunConfig,
  RunStats,
} from "../shared/types";

/**
 * google.script.run serializes RPC results through a JSON-like bridge that can
 * coerce an undefined value to null in transit. Nothing in this app's RPC
 * payloads gives null and undefined different meaning anywhere — including at
 * the top level, where a "nothing" result (runBatchAI, getActiveRangeInfo,
 * getJobProgress) is represented as undefined, never null. That means this
 * conversion is unconditional, with no position-dependent exception to
 * remember: every result that crosses back into client code is normalized
 * here, once, so no future wrapper or comparison needs to know this quirk
 * exists at all.
 */
export function normalizeNulls<T>(value: T): T {
  if (value === null) return undefined as T;
  if (Array.isArray(value)) return value.map((item) => normalizeNulls(item)) as T;
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as object).map(([key, v]) => [key, normalizeNulls(v)]),
    ) as T;
  }
  return value;
}

export function getSheetHeaders(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((headers: unknown) => resolve(normalizeNulls(headers) as string[]))
      .withFailureHandler((err: Error) => reject(err))
      .getSheetHeaders();
  });
}

export function runBatchAI(config: RunConfig, jobId?: string): Promise<RunStats | undefined> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) =>
        resolve(normalizeNulls(result) as RunStats | undefined),
      )
      .withFailureHandler((err: Error) => reject(err))
      .runBatchAI(config, jobId);
  });
}

export function runTool(fn: string, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runTool(fn, jobId);
  });
}

export function prepRecipe(params: PrepRecipeParams): Promise<PrepRecipeResult> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) => resolve(normalizeNulls(result) as PrepRecipeResult))
      .withFailureHandler((err: Error) => reject(err))
      .prepRecipe(params);
  });
}

export function importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .importDriveLinks(config, jobId);
  });
}

export function extractText(config: ExtractTextConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .extractText(config, jobId);
  });
}

export function getActiveRangeInfo(): Promise<{ start: number; end: number } | undefined> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) =>
        resolve(normalizeNulls(result) as { start: number; end: number } | undefined),
      )
      .withFailureHandler((err: Error) => reject(err))
      .getActiveRangeInfo();
  });
}

export function getJobProgress(
  jobId: string,
): Promise<{ message?: string; current?: number; total?: number } | undefined> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) =>
        resolve(
          normalizeNulls(result) as
            | { message?: string; current?: number; total?: number }
            | undefined,
        ),
      )
      .withFailureHandler((err: Error) => reject(err))
      .getJobProgress(jobId);
  });
}

export function formatMarkdownSelection(): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .formatMarkdownSelection();
  });
}
