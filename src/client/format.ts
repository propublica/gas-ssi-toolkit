/**
 * format.ts — Small display-formatting helpers shared across client panels.
 */

/**
 * Formats a duration in milliseconds as a human-readable string: seconds with
 * one decimal below a minute ("4.2s"), minutes and whole seconds below an hour
 * ("1m 18s"), hours and whole minutes above that ("1h 30m").
 *
 * Rounds the total to whole seconds before deriving minutes/seconds (and whole
 * minutes before deriving hours/minutes) so a value like 119.6s becomes
 * "2m 0s", not "1m 60s" from rounding each unit independently. The seconds
 * threshold check itself rounds to one decimal first, so a value like 59.96s
 * (which displays as "60.0s" if left as seconds) correctly promotes to
 * "1m 0s" instead.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  const roundedTenths = Math.round(totalSeconds * 10) / 10;
  if (roundedTenths < 60) {
    return `${roundedTenths.toFixed(1)}s`;
  }

  const roundedSeconds = Math.round(totalSeconds);
  const totalMinutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
