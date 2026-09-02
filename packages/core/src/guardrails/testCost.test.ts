import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readRepositoryFile, repoRoot } from './repository.js';
import {
  isStatisticalTestFile,
  isTestFile,
  scanOptionsFor,
  stripCommentsAndStrings,
  stripCommentsKeepingStrings,
} from './sourceScan.js';

/**
 * Assertion cost in the fast unit suite.
 *
 * A matcher call costs roughly 25 microseconds. That is irrelevant once and
 * ruinous a hundred thousand times: an assertion inside a large loop turns a
 * millisecond of real work into five seconds of matcher overhead, which is
 * exactly the unit project's timeout.
 *
 * This has now bitten twice. `regime.test.ts` made 200,000 `expect()` calls and
 * sat at 5.08s, failing only when something else competed for CPU. Then
 * `cascade.test.ts` failed the PH-5 phase gate the same way. Both were latent
 * for as long as nothing ran beside them, which is the worst kind of failure:
 * it appears when the suite gets busier, and it looks like the new work broke
 * something.
 *
 * The fix in both cases was the same — count inside the loop, assert once after
 * it — and it reads better too, because a failure reports "3 invalid values"
 * rather than stopping at the first.
 *
 * ## What the detector reads
 *
 * Cycle Audit 2 measured the original detector against seven loop shapes and it
 * caught one. The rewrite caught the counting `for` in its Prettier spelling
 * and nothing else; the out-of-band audit (a2-07) walked past it with
 * `for…of`, `while`, `.forEach`, `.map`, a prefix `++`, a decrementing loop, a
 * multi-line header, a brace-less body, a `50 * 1000` bound, an `arr.length`
 * bound, and an assertion inside a helper called from the loop — eleven shapes
 * for one. A guardrail that catches a twelfth of its subject is worse than
 * none, because the record then claims the class is closed.
 *
 * So this reads structure rather than a line. Every loop construct is found in
 * the comment- and string-stripped source with its body's extent; every
 * `expect(` — and every call to a local helper whose body contains one — is
 * charged the product of the iteration counts of the loops enclosing it. Bounds
 * are read as far as a file can say them: literals, constant arithmetic, a
 * `const` defined in the file, `.length` of an array whose size is known, array
 * literals, `new Array(n)`, `Array.from({ length })`, `.slice`, and — because
 * the dataset a test iterates is usually built by a call — the largest literal
 * argument of the call that built it, when that literal is itself at or above
 * the limit. A scalar bound the file cannot resolve is suspect, as before. A
 * collection whose size the file cannot resolve is not charged: `for (const
 * field of fields)` is the ordinary way to assert over a handful of cases, and
 * a guard that cried wolf on every one of them would be weakened rather than
 * obeyed.
 */

/** Loop bound above which a per-iteration assertion is a problem. */
const LOOP_BOUND_LIMIT = 20_000;

/** How deep a binding is followed before giving up. */
const RESOLUTION_DEPTH = 8;

const GROUPS = ['packages', 'tools', 'apps'];

/** Every `*.test.ts` that is not statistical, across the workspace. */
function unitTestFiles(): string[] {
  return GROUPS.flatMap((group) => listSourceFiles(group)).filter(
    (file) => isTestFile(file) && !isStatisticalTestFile(file),
  );
}

/** Every `*.stat.test.ts` in the workspace. */
function statisticalTestFiles(): string[] {
  return GROUPS.flatMap((group) => listSourceFiles(group)).filter(isStatisticalTestFile);
}

// ---------------------------------------------------------------------------
// Reading sizes out of a file
// ---------------------------------------------------------------------------

const NUMERIC_LITERAL = /^(?:0x[0-9a-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)$/i;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ITERATION_METHODS = new Set([
  'forEach',
  'map',
  'flatMap',
  'filter',
  'every',
  'some',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'reduce',
  'reduceRight',
]);
/** Methods that return a collection of the receiver's size. */
const SIZE_PRESERVING = new Set(['fill', 'map', 'keys', 'values', 'entries', 'reverse', 'sort']);
/** Methods that return at most the receiver's size. */
const SIZE_BOUNDED = new Set(['filter', 'flat']);

/** The index of the bracket that balances the one at `open`, or -1. */
function matching(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const close = pairs[text[open]!];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return c === close ? i : -1;
    }
  }
  return -1;
}

/** The index of the bracket that the one at `close` balances, walking backwards, or -1. */
function matchingBackwards(text: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const c = text[i]!;
    if (c === ')' || c === ']' || c === '}') depth += 1;
    else if (c === '(' || c === '[' || c === '{') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on a top-level occurrence of any of `separators`. */
function splitTopLevel(text: string, separators: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (depth === 0 && separators.includes(c)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unwrap(expression: string): string {
  let text = expression.trim();
  while (text.startsWith('(') && matching(text, 0) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/**
 * What one test file lets the detector resolve: its bindings, and from them the
 * value of a scalar expression or the size of a collection expression.
 */
class FileFacts {
  private readonly bindings = new Map<string, string>();

  constructor(readonly code: string) {
    for (const match of code.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+?)?\s*=(?!=)\s*/g,
    )) {
      const start = match.index + match[0].length;
      const end = splitTopLevel(code.slice(start, start + 2000), ';')[0]!.length;
      if (!this.bindings.has(match[1]!))
        this.bindings.set(match[1]!, code.slice(start, start + end));
    }
  }

  /** Whether the file binds this name at all: an unbound name is an import or a parameter. */
  hasBinding(name: string): boolean {
    return this.bindings.has(name);
  }

  /** A scalar's value, or `undefined` when the file does not say. */
  evaluate(expression: string, depth = 0): number | undefined {
    if (depth > RESOLUTION_DEPTH) return undefined;
    const text = unwrap(expression);
    if (text.length === 0) return undefined;
    if (NUMERIC_LITERAL.test(text)) return Number(text.replace(/_/g, ''));
    if (/^[-+]\s*\S/.test(text) && !/[-+*/%]/.test(text.slice(1))) {
      const magnitude = this.evaluate(text.slice(1), depth + 1);
      return magnitude === undefined ? undefined : text.startsWith('-') ? -magnitude : magnitude;
    }
    if (text === 'Infinity' || text === 'Number.POSITIVE_INFINITY') return Number.POSITIVE_INFINITY;
    if (text.endsWith('.length')) return this.sizeOf(text.slice(0, -'.length'.length), depth + 1);
    if (IDENTIFIER.test(text)) {
      const bound = this.bindings.get(text);
      return bound === undefined ? undefined : this.evaluate(bound, depth + 1);
    }
    const call = /^Math\.(floor|ceil|round|trunc|min|max)\((.*)\)$/s.exec(text);
    if (call !== null && matching(text, text.indexOf('(')) === text.length - 1) {
      const values = splitTopLevel(call[2]!, ',').map((part) => this.evaluate(part, depth + 1));
      if (values.some((value) => value === undefined)) return undefined;
      const numbers = values as number[];
      switch (call[1]) {
        case 'min':
          return Math.min(...numbers);
        case 'max':
          return Math.max(...numbers);
        default:
          return Math[call[1] as 'floor' | 'ceil' | 'round' | 'trunc'](numbers[0]!);
      }
    }
    for (const operators of ['+-', '*/%']) {
      const parts = splitTopLevel(text, operators);
      if (parts.length < 2) continue;
      // Rebuild the operator sequence so `a - b + c` folds left to right.
      let index = 0;
      const symbols: string[] = [];
      for (const part of parts.slice(0, -1)) {
        index += part.length;
        symbols.push(text[index]!);
        index += 1;
      }
      // A leading sign or an exponent's sign is not a binary operator.
      if (
        parts[0]!.trim() === '' ||
        parts.some((part) => /[eE]$/.test(part.trim()) && operators === '+-')
      ) {
        continue;
      }
      let value = this.evaluate(parts[0]!, depth + 1);
      for (let i = 1; i < parts.length && value !== undefined; i += 1) {
        const right = this.evaluate(parts[i]!, depth + 1);
        if (right === undefined) return undefined;
        const symbol = symbols[i - 1]!;
        value =
          symbol === '+'
            ? value + right
            : symbol === '-'
              ? value - right
              : symbol === '*'
                ? value * right
                : symbol === '/'
                  ? value / right
                  : value % right;
      }
      return value;
    }
    return undefined;
  }

  /** A collection's element count, or `undefined` when the file does not say. */
  sizeOf(expression: string, depth = 0): number | undefined {
    if (depth > RESOLUTION_DEPTH) return undefined;
    const text = unwrap(expression);
    if (text.length === 0) return undefined;
    if (text.startsWith('[') && matching(text, 0) === text.length - 1) {
      const inner = text.slice(1, -1).trim();
      if (inner.length === 0) return 0;
      if (inner.startsWith('...') && !inner.includes(','))
        return this.sizeOf(inner.slice(3), depth + 1);
      const elements = splitTopLevel(inner, ',').filter((part) => part.trim().length > 0);
      return elements.some((part) => part.trim().startsWith('...')) ? undefined : elements.length;
    }
    if (IDENTIFIER.test(text)) {
      const bound = this.bindings.get(text);
      return bound === undefined ? undefined : this.sizeOf(bound, depth + 1);
    }
    const constructed = /^(?:new\s+)?Array\((.*)\)$/s.exec(text);
    if (constructed !== null && matching(text, text.indexOf('(')) === text.length - 1) {
      const args = splitTopLevel(constructed[1]!, ',');
      return args.length === 1 ? this.evaluate(args[0]!, depth + 1) : args.length;
    }
    const from = /^Array\.from\((.*)\)$/s.exec(text);
    if (from !== null && matching(text, text.indexOf('(')) === text.length - 1) {
      const first = splitTopLevel(from[1]!, ',')[0]!.trim();
      const length = /^\{\s*length\s*:\s*(.+?)\s*\}$/s.exec(first);
      return length === null ? this.sizeOf(first, depth + 1) : this.evaluate(length[1]!, depth + 1);
    }
    // A method chain: `base.method(args)`.
    if (text.endsWith(')')) {
      const open = matchingBackwards(text, text.length - 1);
      const head = /^(.*?)\s*[?!]*\.\s*([A-Za-z_$][\w$]*)\s*$/s.exec(text.slice(0, open));
      if (open > 0 && head !== null) {
        const [, base, method] = head;
        const args = splitTopLevel(text.slice(open + 1, -1), ',').map((part) => part.trim());
        if (SIZE_PRESERVING.has(method!)) return this.sizeOf(base!, depth + 1);
        if (SIZE_BOUNDED.has(method!)) return this.sizeOf(base!, depth + 1);
        if (method === 'slice') {
          const size = this.sizeOf(base!, depth + 1);
          const start =
            args[0] === undefined || args[0] === '' ? 0 : this.evaluate(args[0], depth + 1);
          const end = args[1] === undefined ? size : this.evaluate(args[1], depth + 1);
          if (start === undefined || end === undefined) return size;
          return Math.max(0, Math.min(size ?? end, end) - start);
        }
        if (method === 'concat') return undefined;
      }
      // Any other call: the dataset a test iterates is usually built by one.
      // Its size is unknown, unless a literal argument at or above the limit
      // says what it was built to hold (a2-07: `for (const t of ticks)` over
      // `drain(engine, 100_000)`).
      const inner = open === -1 ? '' : text.slice(open + 1, -1);
      const literals = splitTopLevel(inner, ',')
        .map((part) => this.evaluate(part, depth + 1))
        .filter((value): value is number => value !== undefined && value >= LOOP_BOUND_LIMIT);
      return literals.length === 0 ? undefined : Math.max(...literals);
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Loops and their bodies
// ---------------------------------------------------------------------------

interface Loop {
  readonly label: string;
  readonly iterations: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

/** The extent of a loop body that begins after the header ending at `after`. */
function bodyAfter(code: string, after: number): { readonly start: number; readonly end: number } {
  let i = after;
  while (i < code.length && /\s/.test(code[i]!)) i += 1;
  if (code[i] === '{') {
    const close = matching(code, i);
    return { start: i, end: close === -1 ? code.length : close + 1 };
  }
  // A brace-less body is one statement, to its semicolon.
  const statement = splitTopLevel(code.slice(i), ';')[0]!;
  return { start: i, end: i + statement.length + 1 };
}

/**
 * The iterations a comparison performs from a known start.
 *
 * `undefined` when the condition cannot be read as `variable <op> bound` or the
 * bound cannot be sized: a collection whose size the file does not state.
 * `Infinity` when the bound is a bare identifier the file never binds — an
 * imported constant or a parameter, whose size the file *could* have stated and
 * did not — which is the shape Cycle Audit 2 planted and the one that stays
 * suspect. A name the file binds to something it cannot evaluate
 * (`const last = ticks[ticks.length - 1]!.instant`) is a bound the file states.
 */
function iterationsOfComparison(
  facts: FileFacts,
  variable: string,
  condition: string,
  step: number,
  start: number | undefined,
): number | undefined {
  const text = unwrap(condition);
  const forward = new RegExp(`^${variable}\\s*(<=|<|>=|>|!==|!=)\\s*(.+)$`, 's').exec(text);
  const reversed = new RegExp(`^(.+?)\\s*(<=|<|>=|>|!==|!=)\\s*${variable}$`, 's').exec(text);
  let operator: string;
  let boundText: string;
  if (forward !== null) {
    operator = forward[1]!;
    boundText = forward[2]!;
  } else if (reversed !== null) {
    operator = reversed[2]!.replace('<', '>').replace('>', '<');
    boundText = reversed[1]!;
  } else {
    return undefined;
  }
  const bound = facts.evaluate(boundText);
  if (bound === undefined) {
    const name = unwrap(boundText);
    return IDENTIFIER.test(name) && !facts.hasBinding(name) ? Number.POSITIVE_INFINITY : undefined;
  }
  if (start === undefined) return undefined;
  const span = Math.abs(bound - start) + (operator === '<=' || operator === '>=' ? 1 : 0);
  return Math.max(0, Math.ceil(span / Math.max(1e-12, Math.abs(step))));
}

/**
 * The step a `for` update clause takes: a number; `undefined` when the clause
 * cannot be read or the amount is a value the file states but cannot size; or
 * `'unbound'` when the amount is a bare identifier the file never binds, which
 * is suspect for the same reason an unbound bound is.
 */
function stepOf(
  facts: FileFacts,
  variable: string,
  update: string,
): number | 'unbound' | undefined {
  const text = update.trim();
  if (text === `${variable}++` || text === `++${variable}`) return 1;
  if (text === `${variable}--` || text === `--${variable}`) return -1;
  const compound =
    new RegExp(`^${variable}\\s*([+-])=\\s*(.+)$`, 's').exec(text) ??
    new RegExp(`^${variable}\\s*=\\s*${variable}\\s*([+-])\\s*(.+)$`, 's').exec(text);
  if (compound === null) return undefined;
  const amount = facts.evaluate(compound[2]!);
  if (amount === undefined) {
    const name = unwrap(compound[2]!);
    return IDENTIFIER.test(name) && !facts.hasBinding(name) ? 'unbound' : undefined;
  }
  return compound[1] === '+' ? amount : -amount;
}

/** Every loop in a stripped source, with what it iterates and where its body is. */
function loopsIn(facts: FileFacts): Loop[] {
  const code = facts.code;
  const loops: Loop[] = [];
  const trailingWhiles = new Set<number>();

  // do { … } while (…)
  for (const match of code.matchAll(/\bdo\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = matching(code, open);
    if (close === -1) continue;
    const tail = /^\s*while\s*\(/.exec(code.slice(close + 1));
    let iterations = 1;
    if (tail !== null) {
      const conditionOpen = close + 1 + tail[0].length - 1;
      trailingWhiles.add(conditionOpen);
      const conditionClose = matching(code, conditionOpen);
      const condition = code.slice(conditionOpen + 1, conditionClose);
      const variable = /^\s*([A-Za-z_$][\w$]*)/.exec(condition)?.[1];
      if (variable !== undefined) {
        iterations =
          iterationsOfComparison(facts, variable, condition, 1, facts.evaluate(variable)) ?? 1;
      }
    }
    loops.push({ label: 'do…while', iterations, bodyStart: open, bodyEnd: close + 1 });
  }

  // while (…)
  for (const match of code.matchAll(/\bwhile\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    if (trailingWhiles.has(open)) continue;
    const close = matching(code, open);
    if (close === -1) continue;
    const condition = code.slice(open + 1, close);
    const variable = /^\s*([A-Za-z_$][\w$]*)/.exec(condition)?.[1];
    // A condition that cannot be read — `while (queue.length > 0)` — is a loop
    // over a collection the file cannot size, and is not charged.
    const iterations =
      variable === undefined
        ? 1
        : (iterationsOfComparison(facts, variable, condition, 1, facts.evaluate(variable)) ?? 1);
    const body = bodyAfter(code, close + 1);
    loops.push({
      label: `while (${condition.trim()})`,
      iterations,
      bodyStart: body.start,
      bodyEnd: body.end,
    });
  }

  // for (…)
  for (const match of code.matchAll(/\bfor\s*(?:await\s*)?\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matching(code, open);
    if (close === -1) continue;
    const header = code.slice(open + 1, close);
    const body = bodyAfter(code, close + 1);
    const iteration =
      /^\s*(?:const|let|var)\s+(?:[A-Za-z_$][\w$]*|\[[^\]]*\]|\{[^}]*\})\s+(?:of|in)\s+(.+)$/s.exec(
        header,
      );
    if (iteration !== null) {
      const iterable = iteration[1]!.trim();
      // A collection the file cannot size is not charged (see the docstring).
      const size = facts.sizeOf(iterable) ?? 1;
      loops.push({
        label: `for…of ${iterable}`,
        iterations: size,
        bodyStart: body.start,
        bodyEnd: body.end,
      });
      continue;
    }
    const clauses = splitTopLevel(header, ';');
    if (clauses.length !== 3) {
      // `for (;;)`: no bound to read, so nothing to charge.
      loops.push({
        label: `for (${header.trim()})`,
        iterations: 1,
        bodyStart: body.start,
        bodyEnd: body.end,
      });
      continue;
    }
    const init = /^\s*(?:let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.+)$/s.exec(clauses[0]!);
    if (init === null) {
      loops.push({
        label: `for (${header.trim()})`,
        iterations: 1,
        bodyStart: body.start,
        bodyEnd: body.end,
      });
      continue;
    }
    const variable = init[1]!;
    const start = facts.evaluate(init[2]!);
    const step = stepOf(facts, variable, clauses[2]!);
    const iterations =
      step === 'unbound'
        ? Number.POSITIVE_INFINITY
        : step === undefined || step === 0
          ? 1
          : (iterationsOfComparison(facts, variable, clauses[1]!, step, start) ?? 1);
    loops.push({
      label: `for (${header.replace(/\s+/g, ' ').trim()})`,
      iterations,
      bodyStart: body.start,
      bodyEnd: body.end,
    });
  }

  // receiver.forEach((x) => …) and its siblings
  for (const match of code.matchAll(/\.\s*([A-Za-z]+)\s*\(/g)) {
    if (!ITERATION_METHODS.has(match[1]!)) continue;
    const open = match.index + match[0].length - 1;
    const close = matching(code, open);
    if (close === -1) continue;
    // The receiver: walk back over a member chain, jumping over balanced brackets.
    let i = match.index - 1;
    while (i >= 0 && /\s/.test(code[i]!)) i -= 1;
    const end = i + 1;
    while (i >= 0) {
      const c = code[i]!;
      if (c === ')' || c === ']') {
        const opener = matchingBackwards(code, i);
        if (opener === -1) break;
        i = opener - 1;
        continue;
      }
      if (/[\w$.?!]/.test(c)) {
        i -= 1;
        continue;
      }
      break;
    }
    const receiver = code.slice(i + 1, end).trim();
    const size = facts.sizeOf(receiver) ?? 1;
    loops.push({
      label: `${receiver}.${match[1]!}(…)`,
      iterations: size,
      bodyStart: open,
      bodyEnd: close + 1,
    });
  }

  return loops;
}

/** Local functions whose body asserts: a call to one is an assertion (a2-07, C-08). */
function assertingHelpers(code: string): string[] {
  const names: string[] = [];
  const declarations = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+?)?\s*=\s*(?:async\s*)?(?:<[^>]*>)?\s*\(/g,
  ];
  for (const pattern of declarations) {
    for (const match of code.matchAll(pattern)) {
      const parametersOpen = match.index + match[0].length - 1;
      const parametersClose = matching(code, parametersOpen);
      if (parametersClose === -1) continue;
      const rest = code.slice(parametersClose + 1);
      const arrow = /^\s*(?::\s*[^=>{]+?)?\s*(=>)?\s*\{/.exec(rest);
      if (arrow === null) continue;
      const bodyOpen = parametersClose + 1 + arrow[0].length - 1;
      const bodyClose = matching(code, bodyOpen);
      if (bodyClose === -1) continue;
      if (/\bexpect\s*\(/.test(code.slice(bodyOpen, bodyClose))) names.push(match[1]!);
    }
  }
  return [...new Set(names)];
}

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly bound: number;
  readonly loops: readonly string[];
}

/** Assertions executed inside large loops, in a stripped source. */
export function offencesIn(file: string, source: string): Offence[] {
  const facts = new FileFacts(stripCommentsAndStrings(source, scanOptionsFor(file)));
  const code = facts.code;
  const loops = loopsIn(facts);
  const helpers = assertingHelpers(code);
  const sites = [...code.matchAll(/\bexpect\s*\(/g)].map((match) => match.index);
  for (const helper of helpers) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${helper}\\s*\\(`, 'g'))) {
      sites.push(match.index);
    }
  }
  const found: Offence[] = [];
  for (const site of sites) {
    const enclosing = loops.filter((loop) => loop.bodyStart <= site && site < loop.bodyEnd);
    if (enclosing.length === 0) continue;
    const bound = enclosing.reduce((product, loop) => product * loop.iterations, 1);
    if (bound < LOOP_BOUND_LIMIT) continue;
    const line = code.slice(0, site).split('\n').length;
    if (found.some((offence) => offence.line === line)) continue;
    found.push({
      file,
      line,
      bound,
      loops: enclosing.map((loop) => `${loop.label} × ${String(loop.iterations)}`),
    });
  }
  return found;
}

function render(offence: Offence): string {
  const bound = Number.isFinite(offence.bound)
    ? `${String(offence.bound)} assertions`
    : 'an unbounded or unreadable loop';
  return `${offence.file}:${String(offence.line)} (${bound}: ${offence.loops.join(' in ')})`;
}

/**
 * Assertion loops the detector has found that are owed a fix.
 *
 * Each entry is a finding carried in the open, not an exemption: it names the
 * file, the loop and the count, it is asserted below to still be exactly that —
 * so it cannot outlive the loop it describes — and it is here rather than
 * silenced so the next edit to the file closes it.
 */
const KNOWN_ASSERTION_LOOPS: readonly {
  readonly file: string;
  readonly loop: string;
  readonly bound: number;
  readonly owed: string;
}[] = [
  {
    // **a2-07.** Found by the rewritten detector: the bound is `ticks.length`
    // and `ticks` is `drain(build(), 20_000)`, asserted to hold exactly 20,000
    // ticks two lines earlier. Three matchers per tick is 60,000 matcher calls,
    // about 1.5 s of overhead in a 20 s budget. The old detector never matched
    // a bound containing a `.`, so it read this as no loop at all.
    file: 'packages/engine/src/engine.test.ts',
    loop: 'for (let i = 0; i < ticks.length; i += 1)',
    bound: 20_000,
    owed: 'count the out-of-order ticks inside the loop and assert once after it',
  },
  {
    // **a2-07.** `entries` is `store.readRecord(ASSET, 1, 100_000)`: the literal
    // is a cap, and the record read is a few dozen entries. The detector reads
    // what the file states — up to 100,000 — and cannot know the record is
    // short; the test can say so by reading with the cap it expects.
    file: 'packages/runtime/src/failover.test.ts',
    loop: 'for…of entries',
    bound: 100_000,
    owed: 'read the record with a cap the test expects to fill, or count and assert once',
  },
];

function isKnown(offence: Offence): boolean {
  return KNOWN_ASSERTION_LOOPS.some(
    (known) =>
      known.file === offence.file &&
      known.bound === offence.bound &&
      offence.loops.some((loop) => loop.startsWith(known.loop)),
  );
}

describe('the fast suite stays fast', () => {
  const files = unitTestFiles();
  const all = files.flatMap((file) => offencesIn(file, readRepositoryFile(file)));

  it('has unit tests to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never asserts inside a large loop', () => {
    expect(
      all.filter((offence) => !isKnown(offence)).map(render),
      'count inside the loop and assert once after it — a matcher call is ~25us, ' +
        'and this has already caused two timeouts that looked like unrelated failures',
    ).toEqual([]);
  });

  it('carries no known assertion loop that has since been fixed', () => {
    for (const known of KNOWN_ASSERTION_LOOPS) {
      const still = all.filter(isKnown).filter((offence) => offence.file === known.file);
      expect(
        still.length,
        `${known.file} no longer has "${known.loop}" at ${String(known.bound)} — remove its ` +
          `entry (it was owed: ${known.owed})`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('the loop detector reads every shape the audit planted (a2-07)', () => {
  const body = '      expect(z).toBeGreaterThanOrEqual(0);\n';
  const flagged: readonly [string, string][] = [
    ['C-01 counting for', `for (let z = 0; z < 50_000; z++) {\n${body}}`],
    ['C-02 for…of over new Array(n)', `for (const z of new Array(50_000).fill(0)) {\n${body}}`],
    ['C-03 while', `let z = 0;\nwhile (z < 50_000) {\n${body}  z += 1;\n}`],
    [
      'C-04 Array.from({ length }).forEach',
      `Array.from({ length: 100_000 }).forEach((z) => {\n${body}});`,
    ],
    ['C-05 bound from an unknown constant', `for (let z = 0; z < IMPORTED_BOUND; z++) {\n${body}}`],
    [
      'C-06 bound is arr.length',
      `const arr = new Array(50_000).fill(0);\nfor (let z = 0; z < arr.length; z++) {\n${body}}`,
    ],
    ['C-07 prefix ++', `for (let z = 0; z < 50_000; ++z) {\n${body}}`],
    [
      'C-08 assertion in a helper called from the loop',
      `const check = (z: number): void => {\n${body}};\nfor (let z = 0; z < 50_000; z++) {\n  check(z);\n}`,
    ],
    ['C-09 .map with expect', 'new Array(50_000).fill(0).map((z) => expect(z).toBe(0));'],
    ['C-10 multi-line header', `for (\n  let z = 0;\n  z < 50_000;\n  z++\n) {\n${body}}`],
    ['C-11 z += 1', `for (let z = 0; z < 50_000; z += 1) {\n${body}}`],
    [
      'C-12 brace-less body',
      'for (let z = 0; z < 50_000; z++) expect(z).toBeGreaterThanOrEqual(0);',
    ],
    [
      'C-13 nested 300 × 300',
      `for (let a = 0; a < 300; a++) {\n  for (let b = 0; b < 300; b++) {\n${body}  }\n}`,
    ],
    ['C-14 decrementing', `for (let z = 50_000; z > 0; z--) {\n${body}}`],
    ['C-15 literal expression bound', `for (let z = 0; z < 50 * 1000; z++) {\n${body}}`],
    ['a const bound', `const SAMPLES = 100_000;\nfor (let z = 0; z < SAMPLES; z += 1) {\n${body}}`],
    [
      'a const derived from a const',
      `const BASE = 1000;\nconst SAMPLES = BASE * 100;\nfor (let z = 0; z < SAMPLES; z += 1) {\n${body}}`,
    ],
    [
      'for…of over a dataset built by a call with a large literal argument',
      `const ticks = drain(build(), 100_000);\nfor (const z of ticks) {\n${body}}`,
    ],
    [
      'for…of over an array literal spread from a sized array',
      `const xs = [...new Array(50_000)];\nfor (const z of xs) {\n${body}}`,
    ],
    [
      'a sliced dataset that is still large',
      `const xs = Array.from({ length: 100_000 }).slice(10);\nfor (const z of xs) {\n${body}}`,
    ],
    ['do…while', `let z = 0;\ndo {\n${body}  z += 1;\n} while (z < 50_000);`],
    [
      'a for…in over a large object',
      `const o = new Array(50_000).fill(0);\nfor (const z in o) {\n${body}}`,
    ],
    [
      'nested for…of inside a counting for',
      `const xs = new Array(300).fill(0);\nfor (let a = 0; a < 300; a++) {\n  for (const z of xs) {\n${body}  }\n}`,
    ],
    [
      '.every over an entries() chain',
      `const xs = new Array(50_000).fill(0);\nxs.entries().every((z) => expect(z).toBeDefined());`,
    ],
  ];
  const legitimate: readonly [string, string][] = [
    ['a small counting loop', `for (let z = 0; z < 100; z++) {\n${body}}`],
    [
      'nested loops under the limit',
      `for (let a = 0; a < 100; a++) {\n  for (let b = 0; b < 100; b++) {\n${body}  }\n}`,
    ],
    ['for…of over a literal', `for (const z of [1, 2, 3]) {\n${body}}`],
    ['for…of over a collection the file cannot size', `for (const z of fields) {\n${body}}`],
    ['forEach over Object.keys', `Object.keys(x).forEach((z) => {\n${body}});`],
    [
      'a sliced dataset that is small',
      `const xs = Array.from({ length: 100_000 }).slice(0, 10);\nfor (const z of xs) {\n${body}}`,
    ],
    [
      'a large loop that counts and asserts once after it',
      `let invalid = 0;\nfor (let z = 0; z < 50_000; z++) {\n  if (z < 0) invalid += 1;\n}\nexpect(invalid).toBe(0);`,
    ],
    [
      'a helper that asserts, called once',
      `const check = (z: number): void => {\n${body}};\ncheck(1);`,
    ],
    [
      'a dataset built by a call with only small literals',
      `const ticks = drain(build(), 1_000);\nfor (const z of ticks) {\n${body}}`,
    ],
    [
      'a large loop whose assertion is in a comment or a string',
      `for (let z = 0; z < 50_000; z++) {\n  // expect(z).toBe(0)\n  const s = "expect(z)";\n}`,
    ],
    ['a while over a small bound', `let z = 0;\nwhile (z < 100) {\n${body}  z += 1;\n}`],
  ];

  it.each(flagged)('flags %s', (_label, snippet) => {
    expect(offencesIn('x.test.ts', snippet).map(render)).not.toEqual([]);
  });

  it.each(legitimate)('does not flag %s', (_label, snippet) => {
    expect(offencesIn('x.test.ts', snippet).map(render)).toEqual([]);
  });

  it('reports the product of nested bounds and names the loops', () => {
    const [offence] = offencesIn(
      'x.test.ts',
      `for (let a = 0; a < 300; a++) {\n  for (let b = 0; b < 300; b++) {\n${body}  }\n}`,
    );
    expect(offence?.bound).toBe(90_000);
    expect(offence?.line).toBe(3);
    expect(offence?.loops).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// PH-11.3: the synchronous-driver rule
// ---------------------------------------------------------------------------

/**
 * A statistical test must not drive the engine through a synchronous entry point
 * when a yielding one exists.
 *
 * ## Why this guard exists, and why it did not before
 *
 * This defect has now recurred three times:
 *
 * - **B-005** (PH-4) — calibration loops that never returned to the event loop.
 *   Cost a phase gate.
 * - **B-010** (PH-10.3) — `latticeTies.stat.test.ts` drove btcusd for 25 seconds
 *   synchronously.
 * - **PH-11.3** — `withheld.stat.test.ts` used `runBattery` instead of
 *   `runBatteryAsync`; under coverage instrumentation that was **627 seconds**
 *   of uninterrupted CPU.
 *
 * Each time the symptom is the most confusing failure this project produces: the
 * worker's own RPC channel starves, and the run fails with
 * `Timeout calling "onTaskUpdate"` **while reporting every test as passed**.
 *
 * B-010 concluded that no static guard could see it, because the offending loop
 * is bounded at a small number and the per-iteration cost is unbounded — the
 * source looks identical to the many short driver loops that are fine.
 *
 * That conclusion was right about *loops* and wrong about *entry points*. Every
 * recurrence went through a function whose yielding twin already existed and was
 * two characters away in the import list. That is statically visible, and it is
 * the whole of what this checks.
 *
 * ## What counts as reaching a driver
 *
 * **Cycle Audit 4, m-8.** The named-import check was the whole rule, and an
 * auditor walked past it with `lab.runBattery(x)` and
 * `const { runBattery } = await import('@otc/lab')`. **a2-07** then walked past
 * the call patterns with `lab["runBattery"]()` and
 * `const f = lab.runBattery; f(x)`. Chasing spellings was the mistake: any
 * mention of the driver's name — in code or in a string used as a key — is
 * reaching it, so any mention is an offence, with exactly one exception.
 *
 * ## The escape hatch, and why it is spelled the way it is
 *
 * `catalogue.stat.test.ts` legitimately imports the synchronous variant, to
 * assert that it rejects bad input. Renaming it on import —
 * `calibrateAsset as calibrateAssetSync` — is how a test says the synchronous
 * behaviour is the subject rather than the vehicle. That alias is allowed only
 * where {@link SYNCHRONOUS_DRIVER_EXEMPTIONS} names the file, and only while
 * the file asserts a refusal: a2-07 (C-20) showed that "any alias containing
 * `Sync`" let any file call a driver under an honest-looking name.
 */
describe('statistical tests use the yielding driver', () => {
  /** Entry points that walk a whole dataset and have an `...Async` twin. */
  const SYNCHRONOUS_DRIVERS = [
    'runBattery',
    'runSimulation',
    'calibrateAsset',
    'estimateDirectionalEdge',
  ] as const;

  /** Files that may import a synchronous driver under a `…Sync` alias, and which. */
  const SYNCHRONOUS_DRIVER_EXEMPTIONS: Record<string, readonly string[]> = {
    'packages/engine/src/catalogue.stat.test.ts': ['calibrateAsset'],
  };

  const statisticalTests = statisticalTestFiles();

  it('finds statistical tests to check', () => {
    expect(statisticalTests.length).toBeGreaterThan(5);
  });

  it.each(SYNCHRONOUS_DRIVERS)(
    'no statistical test reaches %s except to assert its refusal',
    (driver) => {
      const offenders: string[] = [];
      for (const file of statisticalTests) {
        // Strings are kept: `lab["runBattery"]` names the driver in one.
        const code = stripCommentsKeepingStrings(readRepositoryFile(file), scanOptionsFor(file));
        const mentions = [...code.matchAll(new RegExp(`\\b${driver}\\b`, 'g'))].map((m) => m.index);
        if (mentions.length === 0) continue;
        const exempt = (SYNCHRONOUS_DRIVER_EXEMPTIONS[file] ?? []).includes(driver);
        const asserted = /\.toThrow\s*\(/.test(code);
        const aliasImport = new RegExp(`\\b${driver}\\s+as\\s+([A-Za-z_$][\\w$]*Sync)\\b`).exec(
          code,
        );
        if (exempt && asserted && aliasImport !== null && mentions.length === 1) continue;
        const how =
          exempt && aliasImport !== null && !asserted
            ? 'is exempt but no longer asserts a refusal'
            : exempt && mentions.length > 1
              ? 'mentions the driver beyond its aliased import'
              : 'reaches the synchronous driver';
        offenders.push(`${file} ${how} (${driver})`);
      }
      expect([...new Set(offenders)]).toEqual([]);
    },
  );

  it('keeps no exemption that no longer imports its driver', () => {
    for (const [file, drivers] of Object.entries(SYNCHRONOUS_DRIVER_EXEMPTIONS)) {
      expect(statisticalTests, `${file} is exempt but is not a statistical test`).toContain(file);
      const code = stripCommentsKeepingStrings(readRepositoryFile(file), scanOptionsFor(file));
      for (const driver of drivers) {
        expect(code, `${file} no longer imports ${driver} under a Sync alias`).toMatch(
          new RegExp(`\\b${driver}\\s+as\\s+\\w+Sync\\b`),
        );
      }
    }
    expect(path.isAbsolute(repoRoot)).toBe(true);
  });
});
