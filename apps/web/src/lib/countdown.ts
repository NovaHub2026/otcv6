/**
 * A countdown, as a clock reads it (PH-24.22, PH-24.24).
 *
 * `m:ss`, or `h:mm:ss` when hours are asked for. Whole seconds, rounded up, so
 * a countdown reads `0:00` only when the time really is gone.
 */
export function formatCountdown(remainingMs: number, hours = false): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const ss = String(total % 60).padStart(2, '0');
  if (!hours) return `${String(Math.floor(total / 60))}:${ss}`;
  const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
  return `${String(Math.floor(total / 3600))}:${mm}:${ss}`;
}
