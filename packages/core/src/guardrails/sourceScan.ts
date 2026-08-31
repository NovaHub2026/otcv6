/**
 * Source-level guardrails.
 *
 * Several foundational invariants are properties that code either has or
 * silently loses. Economic blindness, replay determinism and portability are all
 * violated by a single innocuous line — a `Math.random()` here, a `Date.now()`
 * there — and none of those lines look wrong in review. These scanners turn each
 * one into a build failure.
 *
 * The scanners are pure functions over source text so they can be unit-tested
 * against synthetic inputs, rather than only against the repository as it
 * happens to be today.
 */

export interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

/**
 * Strip comments and string literals so that a scan matches real code rather
 * than prose. Deliberately simple: it handles line comments, block comments,
 * the three string forms, and regular-expression literals well enough for
 * TypeScript source that has already been formatted by Prettier.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let previousMeaningful = '';

  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 1;
      out += '""';
      continue;
    }
    if (c === '/' && /[=(,:[!&|?{;+\-*%<>~^]/.test(previousMeaningful)) {
      // Regular-expression literal, distinguished from division by what precedes it.
      i += 1;
      while (i < n && source[i] !== '/') {
        if (source[i] === '\\') i += 1;
        if (source[i] === '[') {
          while (i < n && source[i] !== ']') i += 1;
        }
        i += 1;
      }
      i += 1;
      out += '//';
      continue;
    }

    out += c;
    if (!/\s/.test(c)) previousMeaningful = c;
    i += 1;
  }
  return out;
}

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Ambient nondeterminism. Any of these makes the containing module
 * unreplayable, and replay is a product invariant (INV-009).
 */
export const AMBIENT_RULES: readonly Rule[] = [
  {
    name: 'no-ambient-time',
    pattern: /\b(?:Date\s*\.\s*now|new\s+Date|performance\s*\.\s*now|process\s*\.\s*hrtime)\b/,
    reason: 'Ambient time makes a module unreplayable. Take a Clock instead.',
  },
  {
    name: 'no-ambient-randomness',
    pattern:
      /\b(?:Math\s*\.\s*random|randomBytes|randomUUID|randomInt|getRandomValues|randomFillSync)\b/,
    reason:
      'Ambient randomness cannot be replayed or isolated per asset. Draw from a RandomStream instead.',
  },
];

/**
 * Non-portable floating-point operations.
 *
 * ECMAScript specifies `+ - * /`, comparison and `Math.sqrt` exactly, but leaves
 * the transcendental functions and the `**` operator implementation-approximated.
 * A market model built on them replays only approximately, which is not replay
 * at all: INV-009 requires a settled contract to be reproducible, and results
 * that differ in the last bits between Node versions do not satisfy that.
 */
export const PORTABILITY_RULES: readonly Rule[] = [
  {
    name: 'no-nonportable-math',
    pattern:
      /\bMath\s*\.\s*(?:log|log2|log10|log1p|exp|expm1|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b/,
    reason:
      'ECMAScript does not specify this function exactly, so results differ between engines and versions. Use the kernel’s portable equivalent.',
  },
  {
    name: 'no-exponent-operator',
    pattern: /[^*\s]\s*\*\*\s*[^*]/,
    reason:
      'The ** operator is implementation-approximated. Use an explicit constant or a portable helper.',
  },
];

/**
 * Economic vocabulary that must never appear in the price path (INV-001).
 * Terms are specific rather than generic so that ordinary words such as
 * "position" — which legitimately names a cursor position — are not flagged.
 */
export const ECONOMIC_BLINDNESS_RULES: readonly Rule[] = [
  {
    name: 'no-economic-inputs',
    pattern:
      /\b(?:payout|brokerExposure|userBalance|accountBalance|wager|stakeAmount|profitAndLoss|brokerPnl|traderPnl|winRatio|houseEdge)\b/i,
    reason:
      'The price core must be economically blind: it may never see payout, exposure, balances or profit (INV-001).',
  },
];

export function scanSource(file: string, source: string, rules: readonly Rule[]): Violation[] {
  const stripped = stripCommentsAndStrings(source);
  const lines = stripped.split('\n');
  const violations: Violation[] = [];
  for (const rule of rules) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (rule.pattern.test(line)) {
        violations.push({
          rule: rule.name,
          file,
          line: i + 1,
          text: line.trim(),
          reason: rule.reason,
        });
      }
    }
  }
  return violations;
}
