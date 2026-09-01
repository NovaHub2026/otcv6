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
/**
 * Remove comments while leaving string contents intact.
 *
 * **Cycle Audit 5, CA5-05.** The follower guard stripped comments with
 * `source.replace(/\/\*[\s\S]*?\*\//g, ' ')`, which is not aware of string
 * literals. Two adjacent constants —
 *
 * ```ts
 * const OPEN = '/*';
 * import * as engineModule from '@otc/engine';
 * const CLOSE = '*' + '/';
 * ```
 *
 * — made a plain static engine import look like the inside of a comment, and
 * the guard that exists to make a follower structurally unable to generate went
 * green while an auditor gave one a real engine.
 *
 * Specifiers have to survive, so this cannot be {@link stripCommentsAndStrings}:
 * that removes string contents too, and the specifier is a string. Scanning
 * character by character is the only way to tell a comment from a string that
 * looks like one.
 *
 * **Cycle Audit 6, CA6-03.** The first version knew a string from a comment and
 * did not know a **regular-expression literal** — thirty lines above a function
 * in this same file that does. A regex whose character class contains `/*` is
 * valid JavaScript and needs no escape:
 *
 * ```ts
 * const SEPARATOR = /[/*]/;
 * import * as gen from '@otc/engine';
 * const CLOSE = '*' + '/';
 * ```
 *
 * Everything between vanished from the scan, including a plain static engine
 * import. An auditor gave a follower a real engine, watched it produce ticks,
 * and every one of the 297 guardrail tests stayed green — the same outcome
 * CA5-05 produced, in the function written to fix CA5-05.
 *
 * The lesson recorded here rather than in a commit message: **a lexer that is
 * nearly right is a lexer that is wrong**, and this file already contained the
 * right one. The two scanners now handle the same three constructs and differ
 * only in what they emit.
 */
export function stripCommentsKeepingStrings(source: string): string {
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
      out += c;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          out += source[i]!;
          i += 1;
        }
        if (i < n) {
          out += source[i]!;
          i += 1;
        }
      }
      if (i < n) {
        out += source[i]!;
        i += 1;
      }
      previousMeaningful = quote;
      continue;
    }
    if (c === '/' && /[=(,:[!&|?{;+\-*%<>~^]/.test(previousMeaningful)) {
      // A regular-expression literal, told from division by what precedes it.
      // Its contents are dropped rather than kept: nothing executable can hide
      // inside one, and keeping them would let `/createMarketEngine/` trip the
      // identifier scan — a false positive is safe, but a needless one.
      i += 1;
      while (i < n && source[i] !== '/') {
        if (source[i] === '\\') i += 1;
        if (source[i] === '[') {
          while (i < n && source[i] !== ']') i += 1;
        }
        i += 1;
      }
      i += 1;
      out += '/ /';
      previousMeaningful = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) previousMeaningful = c;
    i += 1;
  }
  return out;
}

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
  {
    name: 'no-ambient-state',
    pattern: /\b(?:globalThis|process\s*\.\s*env)\b/,
    reason:
      'Ambient mutable state is an unguarded channel into the price path. Cycle Audit 2 planted ' +
      'a backdoor reading operator exposure through `globalThis` and armed by `process.env`, and ' +
      'every import-based and vocabulary-based guardrail passed it. Environment also makes a ' +
      'module unreplayable, for the same reason ambient time does (INV-001, INV-009).',
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
 * Vocabulary that must never appear in the price path.
 *
 * **Matched as substrings, not as whole words.** An earlier version anchored
 * each term with `\b`, which cannot fire inside camelCase: `\bpayout\b` does not
 * match `userPayout`, and `\bexpiration\b` does not match `selectedExpirationMs`.
 * The audit that found this planted `selectedExpirationMs` directly into the
 * price engine's input type and every guardrail passed.
 *
 * Terms are therefore specific enough to be unambiguous as substrings. Generic
 * words are deliberately absent: "position" legitimately names a cursor
 * position, and "contract" appears inside "contraction", which is ordinary
 * volatility vocabulary.
 */
export const ECONOMIC_BLINDNESS_RULES: readonly Rule[] = [
  {
    name: 'no-economic-inputs',
    pattern:
      /(?:payout|brokerExposure|userBalance|accountBalance|wagerAmount|stakeAmount|profitAndLoss|brokerPnl|traderPnl|winRatio|houseEdge)/i,
    reason:
      'The price core must be economically blind: it may never see payout, exposure, balances or profit (INV-001).',
  },
  {
    name: 'no-contract-inputs',
    pattern:
      /(?:expiration|expiryMs|expiresAt|contractHorizon|selectedHorizon|binaryHorizon|contractId|tradeDirection|positionDirection|entryInstant|payoutRatio|stakeSize|atMoneyPolicy|settlementOutcome)/i,
    reason:
      'Selecting an expiration must never change the market (INV-005). The price path may not ' +
      'name a contract, an expiration or a trade direction: if it can see one, a user choosing a ' +
      'different expiry could move the price.\n\n' +
      'Deliberately NOT listed: bare `horizonMs`. Calibration legitimately measures a ' +
      "30-second horizon at registration time to choose an asset's lattice, which is a " +
      'design-time constant rather than a per-contract input. Listing it produced a false ' +
      'positive on CalibrationEvidence, and a guardrail that cries wolf gets weakened rather ' +
      'than obeyed.',
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

/**
 * Every module specifier a file references, static or dynamic.
 *
 * A scanner rather than a pattern, because the two things a pattern cannot tell
 * apart are exactly the two that matter here: a specifier is a string, and a
 * *test fixture describing* an import is also a string.
 *
 * **Cycle Audit 6, CA6-13.** The dependency guard used
 * `/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/` over a comment-stripped
 * source. Sharing the correct comment scanner immediately surfaced the other
 * half of the problem: `singleWriter.test.ts` holds the string
 * `"import * as engineModule from '@otc/engine';"` as a fixture, and the pattern
 * read it as an import — a guardrail failing on another guardrail's evidence.
 *
 * So this walks tokens. A specifier is a string literal that follows `from`,
 * `import` or `require` **in code**, with only whitespace or an opening
 * parenthesis between. A string that merely contains those words is a string.
 */
export function moduleSpecifiers(source: string): string[] {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  let word = '';
  let expectingSpecifier = false;
  let previousMeaningful = '';

  const endWord = (): void => {
    if (word === 'from' || word === 'import' || word === 'require') expectingSpecifier = true;
    else if (word.length > 0) expectingSpecifier = false;
    if (word.length > 0) previousMeaningful = word[word.length - 1]!;
    word = '';
  };

  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      endWord();
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      endWord();
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      endWord();
      const quote = c;
      i += 1;
      let value = '';
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          i += 1;
          if (i < n) {
            value += source[i]!;
            i += 1;
          }
          continue;
        }
        value += source[i]!;
        i += 1;
      }
      i += 1;
      if (expectingSpecifier) out.push(value);
      expectingSpecifier = false;
      previousMeaningful = quote;
      continue;
    }
    if (c === '/' && /[=(,:[!&|?{;+\-*%<>~^]/.test(previousMeaningful)) {
      endWord();
      i += 1;
      while (i < n && source[i] !== '/') {
        if (source[i] === '\\') i += 1;
        if (source[i] === '[') {
          while (i < n && source[i] !== ']') i += 1;
        }
        i += 1;
      }
      i += 1;
      expectingSpecifier = false;
      previousMeaningful = '/';
      continue;
    }
    if (/[A-Za-z_$0-9]/.test(c)) {
      word += c;
      i += 1;
      continue;
    }
    endWord();
    // Whitespace and an opening parenthesis keep a keyword waiting, so both
    // `import('x')` and `require ( 'x' )` are seen. Anything else ends it.
    if (!/[\s(]/.test(c)) expectingSpecifier = false;
    if (!/\s/.test(c)) previousMeaningful = c;
    i += 1;
  }
  return out;
}
