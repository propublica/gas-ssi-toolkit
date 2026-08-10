/**
 * gemini-auth.ts — Gemini API credential resolution.
 *
 * Sole owner of GEMINI_API_KEY. Every Gemini REST call authenticates with the
 * `x-goog-api-key` header produced here.
 *
 * The key must never be interpolated into a request URL. UrlFetchApp can throw an
 * exception containing the full request URL on a fetch-level failure (DNS error,
 * timeout) — which `muteHttpExceptions` does not suppress — and both runInference()
 * and SSI() write raw exception messages into spreadsheet cells. A key in the URL
 * is therefore one network hiccup away from being readable in a cell.
 *
 * See T17/R24 in docs/threat_models/ssi-toolkit-threat-model.md.
 */

export const API_KEY_PROPERTY = "GEMINI_API_KEY";

export const MISSING_API_KEY_MESSAGE = `${API_KEY_PROPERTY} script property not set`;

/**
 * Report whether the API key is configured, without throwing.
 * For UI preflight checks that would rather alert than fail mid-run.
 */
export function hasGeminiApiKey(): boolean {
  return !!PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
}

/**
 * Credential header for a Gemini REST call. Resolve once per fetch batch —
 * every call reads a script property.
 *
 * @throws Error with MISSING_API_KEY_MESSAGE when the property is unset
 */
export function geminiAuthHeaders(): Record<string, string> {
  const apiKey = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
  if (!apiKey) throw new Error(MISSING_API_KEY_MESSAGE);
  return { "x-goog-api-key": apiKey };
}
