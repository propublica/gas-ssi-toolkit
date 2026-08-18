/**
 * error-handling.ts — Shared primitives for turning a caught exception into a
 * safe user-facing message plus a structured backend log entry.
 *
 * DomainError marks a message deliberately hand-written to be shown to the
 * user verbatim (Gemini's own structured API error, a validation message like
 * "unknown tool 'x'", the missing-API-key message). Anything that is NOT a
 * DomainError is an exception from a layer this code doesn't fully control
 * (Drive, Docs, network) and is never shown verbatim — see T12 in
 * docs/threat_models/ssi-toolkit-threat-model.md.
 *
 * No subclasses: no catch site needs to distinguish *which kind* of
 * DomainError it caught, only *whether* it caught one.
 */
export class DomainError extends Error {}

export type LogMeta = Record<string, number | boolean>;

/**
 * Log an error server-side via console.error (the V8 Apps Script runtime maps
 * this to ERROR severity in Cloud Logging, unlike Logger.log which carries no
 * severity).
 *
 * Never logs e.message — a caught exception's message can originate from a
 * layer this code doesn't control and may echo cell content, file names, or
 * other data this tool must not retain in Cloud Logging (T12). Only the
 * error's type is logged. `meta` is restricted to number|boolean so a call
 * site cannot smuggle arbitrary text through it.
 *
 * `site` must be a hardcoded string literal at the call site — never built
 * from user input.
 */
export function logError(site: string, e: unknown, meta?: LogMeta): void {
  const kind = e instanceof Error ? e.constructor.name : typeof e;
  console.error(site, { kind, ...meta });
}

/**
 * Resolve the message a user is allowed to see: a DomainError's message was
 * deliberately authored for this purpose and passes through unchanged;
 * anything else falls back to the caller-provided generic string.
 */
export function toSafeMessage(e: unknown, fallback: string): string {
  return e instanceof DomainError ? e.message : fallback;
}

/**
 * Log e unless it's a DomainError. A DomainError's message is already shown
 * to the user via toSafeMessage, and — since DomainError has no subclasses —
 * logError's `kind` field would just record the literal string "DomainError"
 * for every one of them, adding no distinguishing signal. Call this instead
 * of logError directly at any site that also calls toSafeMessage on the same
 * caught value.
 */
export function logUnexpected(site: string, e: unknown, meta?: LogMeta): void {
  if (!(e instanceof DomainError)) logError(site, e, meta);
}

/**
 * Cell-write error convention — brackets flag this as a diagnostic written by
 * the tool, not data the user or model produced.
 */
export function formatCellError(message: string): string {
  return `[Error: ${message}]`;
}

/**
 * Fallback for an RPC-boundary function whose body throws something other
 * than a DomainError. Deliberately does NOT say "see script logs" — most
 * users of this add-on have edit access to the spreadsheet but not to the
 * Apps Script project, so they can't see Cloud Logging at all. This wording
 * is actionable for that audience instead.
 */
export const GENERIC_FAILURE_MESSAGE =
  "Something went wrong — try again, or contact an admin if it persists.";

/**
 * Run an RPC-exposed function's body with the standard scrub-and-log
 * behavior: a DomainError's message passes through to the client verbatim
 * (see toSafeMessage); anything else is logged (type only) and replaced with
 * GENERIC_FAILURE_MESSAGE before crossing the google.script.run boundary.
 *
 * `site` is used for logging only — it never reaches the user, so it can
 * name the internal function rather than mimic user-facing copy.
 */
export function withErrorScrubbing<T>(site: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    logUnexpected(site, e);
    throw new Error(toSafeMessage(e, GENERIC_FAILURE_MESSAGE));
  }
}
