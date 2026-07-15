/**
 * safe-writes.ts — The only file permitted to call setValue/setValues/
 * setRichTextValue/setRichTextValues in src/server/. Every Apps Script write
 * of content that the acting user did not directly type into that specific
 * cell (AI output, Drive-extracted text, a re-write of existing cell
 * content, a recipe form-field value) must go through one of the four
 * writeSafe* primitives below. Enforced by an ESLint rule — see
 * eslint.config.mjs. See docs/threat_models/ssi-toolkit-threat-model.md, T6.
 */

// Sheets functions that make outbound HTTP requests — the exfiltration vector for formula injection.
// We scan the whole formula body so nested calls like =IF(1=1,IMAGE("evil"),0) are caught too.
const WEB_FETCH_PATTERN = /\b(image|importdata|importxml|importhtml|importrange|importfeed)\s*\(/i;

/**
 * Prevent formula injection when writing untrusted-origin text to a Sheets cell.
 *
 * Sheets evaluates values beginning with =, +, or - as formulas. If the formula
 * contains a web-fetch function (IMAGE, IMPORTDATA, IMPORTXML, IMPORTHTML, IMPORTRANGE,
 * IMPORTFEED) — anywhere in the formula, including nested positions — it could make an
 * outbound HTTP request that exfiltrates adjacent cell data. Those values are rejected
 * with an explicit error string.
 *
 * Other formula-prefixed values (=SUM, -IF, etc.) are safe to prefix with ' so Sheets
 * treats them as literal text instead of evaluating them — this is a correctness
 * guarantee (untrusted text displays as written, not silently reinterpreted) as much
 * as a security one.
 */
export function sanitizeForCell(value: string): string {
  if (!value.length || !/^[=+-]/.test(value[0])) return value;
  if (WEB_FETCH_PATTERN.test(value)) {
    return "[SSI Error: AI response contained an external request formula — output rejected]";
  }
  return `'${value}`;
}

type Range = GoogleAppsScript.Spreadsheet.Range;

export function writeSafeValue(range: Range, value: unknown): void {
  range.setValue(typeof value === "string" ? sanitizeForCell(value) : value);
}
