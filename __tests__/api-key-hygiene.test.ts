/// <reference types="node" />
/**
 * Credential-hygiene regression guard for T17/R24.
 *
 * These are source-scanning tests, not behavioral ones. They exist because the
 * T17 fix is easy to undo by accident: the next person adding a Gemini endpoint
 * will copy an existing `?key=` snippet from a tutorial, and nothing else in the
 * suite would notice.
 *
 * See docs/threat_models/ssi-toolkit-threat-model.md (T17) and
 * docs/superpowers/specs/2026-07-29-t17-api-key-header-design.md
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

// Flat, non-recursive by design: a future src/server/<subdir>/*.ts would go
// unscanned, and the file-count sanity check below would not catch it.
const SERVER_DIR = join(__dirname, "..", "src", "server");

const SERVER_FILES = readdirSync(SERVER_DIR).filter((f) => f.endsWith(".ts"));

/**
 * Credential names that must never appear as a URL query parameter. This is a
 * fixed name list, not structural detection — a credential passed under a
 * name not listed here would evade the guard.
 */
const CREDENTIAL_PARAM = "(?:key|api_?key|access_token|token|bearer|secret|authorization)";

// Line-scoped: a URL hand-split across two lines could evade these patterns.
// Acceptable because Prettier does not produce that shape.
const URL_CREDENTIAL_PATTERNS = [
  // ?key=${apiKey}  — template interpolation
  new RegExp(`[?&]${CREDENTIAL_PARAM}=\\$\\{`, "i"),
  // "?key=" + apiKey / `?key=` + apiKey — string or template-literal concatenation
  new RegExp(`[?&]${CREDENTIAL_PARAM}=["'\`]?\\s*\\+`, "i"),
];

function offendingLines(source: string, patterns: RegExp[]): string[] {
  return source
    .split("\n")
    .map((line, i) => ({ line: line.trim(), lineNo: i + 1 }))
    .filter(({ line }) => patterns.some((p) => p.test(line)))
    .map(({ line, lineNo }) => `${lineNo}: ${line}`);
}

describe("credential hygiene in src/server", () => {
  it("scans a plausible number of server files", () => {
    // Guards against the glob silently matching nothing and the suite passing vacuously.
    expect(SERVER_FILES.length).toBeGreaterThan(5);
  });

  it.each(SERVER_FILES)("%s does not put a credential in a URL query string", (file) => {
    const source = readFileSync(join(SERVER_DIR, file), "utf8");
    // Gemini and Drive both accept a credential header; a key in the URL can be
    // echoed back by a UrlFetchApp exception and written into a cell.
    expect(offendingLines(source, URL_CREDENTIAL_PATTERNS)).toEqual([]);
  });

  it("names the GEMINI_API_KEY property in gemini-auth.ts only", () => {
    const namingFiles = SERVER_FILES.filter((file) =>
      readFileSync(join(SERVER_DIR, file), "utf8").includes("GEMINI_API_KEY"),
    );
    // Exact by intent: enforces single ownership of the key property name.
    // This will (deliberately) fail on even a benign mention of GEMINI_API_KEY
    // in another file's comment. The fix is to move the mention, not loosen
    // this assertion.
    expect(namingFiles).toEqual(["gemini-auth.ts"]);
  });
});
