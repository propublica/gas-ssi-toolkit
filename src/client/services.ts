import type { RunConfig } from "../shared/types";

let cachedHeaders: string[] | null = null;

export function getSheetHeaders(): Promise<string[]> {
  if (cachedHeaders !== null) return Promise.resolve(cachedHeaders);
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((headers: unknown) => {
        cachedHeaders = headers as string[];
        resolve(cachedHeaders);
      })
      .withFailureHandler((err: Error) => reject(err))
      .getSheetHeaders();
  });
}

export function invalidateHeaderCache(): void {
  cachedHeaders = null;
}

export function runBatchAI(config: RunConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runBatchAI(config);
  });
}

export function runTool(fn: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runTool(fn);
  });
}
