/**
 * Whether the panel's engine is the Lab-composed engine (ADR-0018 §2).
 *
 * The deployment declares it by pointing both bases at one origin; the panel
 * reads that declaration server-side and says it on every screen. Nothing is
 * probed and nothing is guessed: two different origins are two engines, and
 * then only the Lab screen wears the banner.
 */
export function isLabMode(labBase: string | undefined, apiBase: string | undefined): boolean {
  if (labBase === undefined || apiBase === undefined) return false;
  const origin = (raw: string): string | null => {
    try {
      return new URL(raw).origin;
    } catch {
      return null;
    }
  };
  const lab = origin(labBase);
  const api = origin(apiBase);
  return lab !== null && api !== null && lab === api;
}
