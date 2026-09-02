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
 * happens to be today. `sourceScan.test.ts` holds the corpus: every construct
 * an audit has used to hide something from a scanner, kept as a permanent case.
 *
 * ## One lexer, and why there is only one
 *
 * **Cycle Audit 5, CA5-05.** The follower guard stripped comments with
 * `source.replace(/\/\*[\s\S]*?\*\//g, ' ')`, which is not aware of string
 * literals. Two adjacent constants — `const OPEN = '/*'` and
 * `const CLOSE = '*' + '/'` — made a plain static engine import between them
 * look like the inside of a comment, and the guard that exists to make a
 * follower structurally unable to generate went green while an auditor gave one
 * a real engine.
 *
 * **Cycle Audit 6, CA6-03.** The character scanner written to fix that knew a
 * string from a comment and did not know a **regular-expression literal**. A
 * regex whose character class contains `/*` is valid JavaScript and needs no
 * escape — `const SEPARATOR = /[/*]/;` — and everything between it and the next
 * comment terminator vanished from the scan, including a plain static engine import. Same
 * outcome as CA5-05, in the function written to fix CA5-05.
 *
 * **Out-of-band audit 7, a2-01 and a2-02.** The CA6-03 fix told a regex from a
 * division by the *character* before it, drawn from a punctuation set. A regex
 * that follows a **keyword** — `return /[/*]/`, `typeof /x/`, `case`, `in`,
 * `of`, `yield`, `await`, `throw` — is preceded by a letter, so it was read as
 * division and its `/*` opened a comment again. Third recurrence of the same
 * class, one trigger wider each time, and this one defeated all three scanners
 * at once: economic and ambient vocabulary, dependency direction, and the
 * follower guard that INV-002 and INV-010 rest on. In the same audit, a backtick
 * inside a string inside `${}` — `` `${"`"}` `` — was read as the template's
 * closing delimiter, because `${…}` was scanned as text rather than as code.
 *
 * The lesson, recorded here rather than in a commit message: **three
 * hand-written scanners that each nearly lex JavaScript are three places to be
 * wrong.** There is now one tokenizer, {@link tokenize}, and the three public
 * functions differ only in how they render its tokens. It handles the
 * constructs a real lexer has to: line and block comments; the three string
 * forms, with template substitutions lexed as nested code (recursively, so a
 * template inside a substitution inside a template is fine); regular-expression
 * literals, decided by the previous *token* — after a keyword, an opening
 * bracket, an operator, a statement boundary, or the `)` of an `if`/`while`/
 * `for` head a `/` starts a regex, and after an identifier, a number, a `)` or a
 * `]` it is division — with character classes in which `/` does not terminate;
 * and, for `.tsx` sources, JSX elements whose text may contain apostrophes and
 * quotes that are not string delimiters. Identifier escapes are decoded, so
 * `Math.r\u0061ndom` reaches the rules as `Math.random`.
 *
 * Two safety rules keep a misjudged token from swallowing a file. A regex or a
 * string that reaches the end of its line unterminated is not one — the `/` was
 * a division after all, or the file is malformed — so a wrong guess costs at
 * most the rest of one line. And a JSX element that never closes is not one
 * either: the `<` is handed back as an operator. Either way the scan
 * resynchronises at the next line rather than at the next matching delimiter
 * somewhere in the file, which is what every evasion so far has exploited.
 *
 * What the lexer cannot do is see *through* strings: `this["pay" + "out"]`,
 * `core["Random" + "Stream"]` and `import(["@otc", "lab"].join("/"))` name their
 * target only at run time. Those are closed by construct bans — no bracket
 * access on a global, no computed import specifier below `apps/` — and where
 * they cannot be, the residue is recorded in the audit rather than claimed.
 */

export interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface ScanOptions {
  /**
   * The source may contain JSX. Only `.tsx` files may: in a `.ts` file `<T>`
   * is a type argument or a comparison and must never open an element.
   */
  readonly jsx?: boolean;
}

export type TokenKind = 'code' | 'comment' | 'string' | 'template' | 'regex' | 'jsx-text';

export interface Token {
  readonly kind: TokenKind;
  /**
   * The token's source text, verbatim — except for `code`, where identifier
   * escapes (`\u0061`, `\u{61}`) are decoded so a rule sees the identifier the
   * engine sees.
   */
  readonly text: string;
  /**
   * The literal's value, for a `string` and for a `template` with no
   * substitution. A template with substitutions is emitted as several
   * `template` chunks around the nested code, and carries no value. For a
   * `regex`, its flags.
   */
  readonly value?: string;
}

// ---------------------------------------------------------------------------
// The tokenizer
// ---------------------------------------------------------------------------

/**
 * Keywords after which a `/` begins a regular-expression literal.
 *
 * a2-01: `return /[/*]/.test(s)` is idiomatic, valid, review-invisible code,
 * and the previous version read it as `return` divided by something.
 */
const REGEX_AFTER_KEYWORDS: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'instanceof',
  'void',
  'delete',
  'new',
  'yield',
  'await',
  'throw',
  'do',
  'else',
]);

/**
 * Keywords whose parenthesised head is followed by a statement, so that after
 * its `)` a `/` begins a regex: `if (x) /re/.test(y)`. After any other `)` —
 * a call, a grouping — it is division.
 */
const CONTROL_HEAD_KEYWORDS: ReadonlySet<string> = new Set(['if', 'while', 'for', 'with']);

/** Punctuation after which a `/` is division: the end of an operand. */
const DIVISION_AFTER_PUNCTUATION: ReadonlySet<string> = new Set([')', ']', '++', '--']);

/** Punctuation after which a `<` may open a JSX element: an expression is expected. */
const JSX_AFTER_PUNCTUATION: ReadonlySet<string> = new Set([
  '(',
  ',',
  '=',
  ':',
  '?',
  '{',
  '[',
  '&&',
  '||',
  '??',
  '=>',
  '!',
]);

const JSX_AFTER_KEYWORDS: ReadonlySet<string> = new Set(['return', 'yield', 'await', 'default']);

/** Two-character operators that change what the next `/` or `<` means. */
const OPERATOR_PAIRS: ReadonlySet<string> = new Set(['++', '--', '=>', '&&', '||', '??']);

const WORD_CHARACTER = /[A-Za-z0-9_$]/;
const WHITESPACE = /\s/;
const IDENTIFIER_ESCAPE = /\\u(?:\{([0-9A-Fa-f]{1,6})\}|([0-9A-Fa-f]{4}))/g;

/** `Math.r\u0061ndom` is `Math.random` to the engine, so it is to the scan. */
export function decodeIdentifierEscapes(text: string): string {
  if (!text.includes('\\u')) return text;
  return text.replace(
    IDENTIFIER_ESCAPE,
    (_match: string, braced: string | undefined, plain: string | undefined) => {
      const code = Number.parseInt(braced ?? plain ?? '', 16);
      return Number.isNaN(code) || code > 0x10ffff ? _match : String.fromCodePoint(code);
    },
  );
}

/** Decode the escapes a specifier could plausibly carry. */
function decodeStringEscape(escaped: string): string {
  switch (escaped[0]) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '0':
      return '\0';
    default:
      return escaped;
  }
}

type PreviousKind = 'none' | 'word' | 'punctuation' | 'literal';

class Lexer {
  readonly tokens: Token[] = [];
  index = 0;

  constructor(
    private readonly source: string,
    private readonly options: ScanOptions,
  ) {}

  /**
   * Scan code until the end of the input or — inside a template substitution or
   * a JSX expression container — until the `}` that closes it, which is left
   * for the caller. Returns whether it stopped at such a brace.
   */
  scanCode(untilBrace: boolean): boolean {
    const source = this.source;
    const n = source.length;
    let buffer = '';
    let previous = '';
    let previousKind: PreviousKind = 'none';
    let previousIsProperty = false;
    let depth = 0;
    const heads: boolean[] = [];
    let closedControlHead = false;

    const flush = (): void => {
      if (buffer.length === 0) return;
      this.tokens.push({ kind: 'code', text: decodeIdentifierEscapes(buffer) });
      buffer = '';
    };
    const literal = (token: Token, marker: string): void => {
      flush();
      this.tokens.push(token);
      previous = marker;
      previousKind = 'literal';
    };

    if (this.index === 0 && source.startsWith('#!')) {
      // A shebang is a comment to the engine and was a regex to the previous lexer.
      let end = source.indexOf('\n');
      if (end === -1) end = n;
      this.tokens.push({ kind: 'comment', text: source.slice(0, end) });
      this.index = end;
    }

    while (this.index < n) {
      const c = source[this.index]!;
      const next = source[this.index + 1];

      if (c === '/' && next === '/') {
        let end = source.indexOf('\n', this.index);
        if (end === -1) end = n;
        flush();
        this.tokens.push({ kind: 'comment', text: source.slice(this.index, end) });
        this.index = end;
        continue;
      }
      if (c === '/' && next === '*') {
        let end = source.indexOf('*/', this.index + 2);
        end = end === -1 ? n : end + 2;
        flush();
        this.tokens.push({ kind: 'comment', text: source.slice(this.index, end) });
        this.index = end;
        continue;
      }
      if (c === '"' || c === "'") {
        literal(this.scanString(c), c);
        continue;
      }
      if (c === '`') {
        flush();
        this.scanTemplate();
        previous = '`';
        previousKind = 'literal';
        continue;
      }
      if (c === '/') {
        const regexAllowed =
          previousKind === 'none' ||
          (previousKind === 'word' && !previousIsProperty && REGEX_AFTER_KEYWORDS.has(previous)) ||
          (previousKind === 'punctuation' &&
            (!DIVISION_AFTER_PUNCTUATION.has(previous) || (previous === ')' && closedControlHead)));
        if (regexAllowed) {
          const regex = this.scanRegex();
          if (regex !== null) {
            literal(regex, '/');
            continue;
          }
        }
        buffer += c;
        this.index += 1;
        previous = '/';
        previousKind = 'punctuation';
        continue;
      }
      if (c === '<' && this.options.jsx === true) {
        const jsxAllowed =
          previousKind === 'none' ||
          (previousKind === 'punctuation' && JSX_AFTER_PUNCTUATION.has(previous)) ||
          (previousKind === 'word' && !previousIsProperty && JSX_AFTER_KEYWORDS.has(previous));
        if (jsxAllowed) {
          flush();
          if (this.scanJsxElement()) {
            previous = '>';
            previousKind = 'literal';
            continue;
          }
        }
      }
      if (WORD_CHARACTER.test(c) || (c === '\\' && next === 'u')) {
        const word = this.scanWord();
        buffer += word;
        previousIsProperty = previousKind === 'punctuation' && previous === '.';
        previous = word;
        previousKind = 'word';
        continue;
      }
      if (WHITESPACE.test(c)) {
        buffer += c;
        this.index += 1;
        continue;
      }
      if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        if (untilBrace && depth === 0) {
          flush();
          return true;
        }
        depth -= 1;
      } else if (c === '(') {
        heads.push(
          previousKind === 'word' && !previousIsProperty && CONTROL_HEAD_KEYWORDS.has(previous),
        );
      } else if (c === ')') {
        closedControlHead = heads.pop() ?? false;
      }
      const pair = c + (next ?? '');
      if (OPERATOR_PAIRS.has(pair)) {
        buffer += pair;
        this.index += 2;
        previous = pair;
      } else if (
        c === '!' &&
        (previousKind === 'word' ||
          previousKind === 'literal' ||
          (previousKind === 'punctuation' && (previous === ')' || previous === ']')))
      ) {
        // TypeScript's postfix non-null assertion ends an operand — `x! / y` is
        // a division — where a prefix `!` begins one and `!/re/.test(y)` is a regex.
        buffer += c;
        this.index += 1;
        previous = ')';
        closedControlHead = false;
      } else {
        buffer += c;
        this.index += 1;
        previous = c;
      }
      previousKind = 'punctuation';
    }
    flush();
    return false;
  }

  private scanWord(): string {
    const source = this.source;
    const n = source.length;
    let j = this.index;
    while (j < n) {
      const ch = source[j]!;
      if (WORD_CHARACTER.test(ch)) {
        j += 1;
      } else if (ch === '\\' && source[j + 1] === 'u') {
        if (source[j + 2] === '{') {
          const close = source.indexOf('}', j + 3);
          j = close === -1 ? n : close + 1;
        } else {
          j += 6;
        }
      } else {
        break;
      }
    }
    const word = source.slice(this.index, j);
    this.index = j;
    return word;
  }

  /** A `'…'` or `"…"` literal. Unterminated at a newline, it ends there. */
  private scanString(quote: string): Token {
    const source = this.source;
    const n = source.length;
    const start = this.index;
    let j = start + 1;
    let value = '';
    while (j < n) {
      const ch = source[j]!;
      if (ch === '\\') {
        const escaped = source[j + 1];
        if (escaped === undefined) {
          j += 1;
          break;
        }
        if (escaped === '\n') {
          j += 2; // line continuation
          continue;
        }
        if (escaped === '\r' && source[j + 2] === '\n') {
          j += 3;
          continue;
        }
        // `\xHH`, `\uHHHH`, `\u{H…}`: decoded, so an escaped specifier is the
        // specifier it resolves to.
        let length = 2;
        if (escaped === 'x') {
          length = 4;
        } else if (escaped === 'u') {
          if (source[j + 2] === '{') {
            const close = source.indexOf('}', j + 3);
            length = close === -1 ? 2 : close - j + 1;
          } else {
            length = 6;
          }
        }
        if (length > 2) {
          const code = Number.parseInt(source.slice(j + 2, j + length).replace(/[{}]/g, ''), 16);
          if (!Number.isNaN(code) && code <= 0x10ffff) value += String.fromCodePoint(code);
          j += length;
          continue;
        }
        value += decodeStringEscape(escaped);
        j += 2;
        continue;
      }
      if (ch === quote) {
        j += 1;
        break;
      }
      if (ch === '\n') break;
      value += ch;
      j += 1;
    }
    this.index = j;
    return { kind: 'string', text: source.slice(start, j), value };
  }

  /**
   * A template literal. Each `${` hands the input to {@link scanCode}, which
   * lexes the substitution as code — strings, comments, regexes, nested
   * templates and all — and stops at the `}` that closes it (a2-02).
   */
  private scanTemplate(): void {
    const source = this.source;
    const n = source.length;
    const start = this.index;
    let chunkStart = start;
    let j = start + 1;
    let substituted = false;
    while (j < n) {
      const ch = source[j]!;
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') {
        j += 1;
        break;
      }
      if (ch === '$' && source[j + 1] === '{') {
        substituted = true;
        this.tokens.push({ kind: 'template', text: source.slice(chunkStart, j + 2) });
        this.index = j + 2;
        const closed = this.scanCode(true);
        chunkStart = this.index;
        if (!closed) {
          j = n;
          break;
        }
        j = this.index + 1; // past the `}`
        continue;
      }
      j += 1;
    }
    const text = source.slice(chunkStart, j);
    this.index = j;
    if (substituted) {
      this.tokens.push({ kind: 'template', text });
      return;
    }
    const raw = source.slice(start + 1, Math.max(start + 1, j - 1));
    this.tokens.push({
      kind: 'template',
      text,
      value: raw.replace(/\\(.)/gs, (_match, escaped: string) => decodeStringEscape(escaped)),
    });
  }

  /**
   * A regular-expression literal starting at the current `/`, or `null` when
   * no closing `/` arrives before the end of the line — in which case the `/`
   * was a division after all. `/` inside a character class does not close it.
   */
  private scanRegex(): Token | null {
    const source = this.source;
    const n = source.length;
    const start = this.index;
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const ch = source[j]!;
      if (ch === '\n' || ch === '\r') return null;
      if (ch === '\\') {
        const escaped = source[j + 1];
        if (escaped === undefined || escaped === '\n' || escaped === '\r') return null;
        j += 2;
        continue;
      }
      if (inClass) {
        if (ch === ']') inClass = false;
        j += 1;
        continue;
      }
      if (ch === '[') {
        inClass = true;
        j += 1;
        continue;
      }
      if (ch === '/') {
        j += 1;
        const flagsStart = j;
        while (j < n && /[A-Za-z]/.test(source[j]!)) j += 1;
        this.index = j;
        return { kind: 'regex', text: source.slice(start, j), value: source.slice(flagsStart, j) };
      }
      j += 1;
    }
    return null;
  }

  /**
   * A JSX element starting at the current `<`. Its markup is code, its
   * attribute strings are strings, its `{…}` containers are nested code, and
   * its text is `jsx-text` — prose in which an apostrophe is an apostrophe.
   *
   * Returns `false`, leaving nothing behind, when what follows is not a
   * well-formed element that closes: then the `<` is an operator or a type
   * argument and the caller lexes on.
   */
  private scanJsxElement(): boolean {
    const source = this.source;
    const n = source.length;
    const start = this.index;
    const savedTokens = this.tokens.length;
    const fail = (): boolean => {
      this.tokens.length = savedTokens;
      this.index = start;
      return false;
    };

    let j = start + 1;
    while (j < n && /[A-Za-z0-9_$.:-]/.test(source[j]!)) j += 1;
    const name = source.slice(start + 1, j);
    if (name.length === 0) {
      if (source[j] !== '>') return fail();
    } else if (!/^[A-Za-z_$]/.test(name) || j >= n || !/[\s/>]/.test(source[j]!)) {
      return fail();
    }

    let markupStart = start;
    let selfClosing = false;
    for (;;) {
      if (j >= n) return fail();
      const ch = source[j]!;
      if (ch === '"' || ch === "'") {
        this.tokens.push({ kind: 'code', text: source.slice(markupStart, j) });
        const end = source.indexOf(ch, j + 1);
        if (end === -1) return fail();
        this.tokens.push({
          kind: 'string',
          text: source.slice(j, end + 1),
          value: source.slice(j + 1, end),
        });
        j = end + 1;
        markupStart = j;
        continue;
      }
      if (ch === '{') {
        this.tokens.push({ kind: 'code', text: source.slice(markupStart, j + 1) });
        this.index = j + 1;
        if (!this.scanCode(true)) return fail();
        j = this.index;
        markupStart = j; // the closing brace joins the next markup chunk
        j += 1;
        continue;
      }
      if (ch === '/' && source[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      if (ch === '>') {
        j += 1;
        break;
      }
      if (ch === '<') return fail();
      j += 1;
    }
    this.tokens.push({ kind: 'code', text: source.slice(markupStart, j) });
    this.index = j;
    if (selfClosing) return true;

    for (;;) {
      if (this.index >= n) return fail();
      const ch = source[this.index]!;
      if (ch === '<') {
        if (source[this.index + 1] === '/') {
          const close = source.indexOf('>', this.index);
          if (close === -1) return fail();
          if (source.slice(this.index + 2, close).trim() !== name) return fail();
          this.tokens.push({ kind: 'code', text: source.slice(this.index, close + 1) });
          this.index = close + 1;
          return true;
        }
        if (!this.scanJsxElement()) return fail();
        continue;
      }
      if (ch === '{') {
        this.tokens.push({ kind: 'code', text: '{' });
        this.index += 1;
        if (!this.scanCode(true)) return fail();
        this.tokens.push({ kind: 'code', text: '}' });
        this.index += 1;
        continue;
      }
      let k = this.index;
      while (k < n && source[k] !== '<' && source[k] !== '{') k += 1;
      this.tokens.push({ kind: 'jsx-text', text: source.slice(this.index, k) });
      this.index = k;
    }
  }
}

/** Every token of a TypeScript source, in order; their texts concatenate back to it. */
export function tokenize(source: string, options: ScanOptions = {}): Token[] {
  const lexer = new Lexer(source, options);
  lexer.scanCode(false);
  return lexer.tokens;
}

function newlinesOf(text: string): string {
  let out = '';
  for (const ch of text) if (ch === '\n') out += '\n';
  return out;
}

/** A regex body is dropped: nothing executable hides in one, and `/createMarketEngine/` must not trip an identifier scan. */
function blankRegex(token: Token): string {
  return '/ /' + (token.value ?? '');
}

/**
 * Strip comments and every literal — strings, templates, JSX text — so a scan
 * matches code rather than prose. Line numbering is preserved. Template
 * substitutions are code and stay: `${Date.now()}` is a call.
 */
export function stripCommentsAndStrings(source: string, options: ScanOptions = {}): string {
  let out = '';
  for (const token of tokenize(source, options)) {
    switch (token.kind) {
      case 'code':
        out += token.text;
        break;
      case 'comment':
      case 'jsx-text':
        out += newlinesOf(token.text);
        break;
      case 'string':
      case 'template':
        out += '""' + newlinesOf(token.text);
        break;
      case 'regex':
        out += blankRegex(token);
        break;
    }
  }
  return out;
}

/**
 * Remove comments while leaving string contents intact.
 *
 * Specifiers have to survive, so this cannot be {@link stripCommentsAndStrings}:
 * that removes string contents too, and the specifier is a string. Regex bodies
 * are still dropped, for the reason given at {@link blankRegex}.
 */
export function stripCommentsKeepingStrings(source: string, options: ScanOptions = {}): string {
  let out = '';
  for (const token of tokenize(source, options)) {
    switch (token.kind) {
      case 'comment':
        out += newlinesOf(token.text);
        break;
      case 'regex':
        out += blankRegex(token);
        break;
      default:
        out += token.text;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Module specifiers
// ---------------------------------------------------------------------------

export interface ImportSpecifiers {
  /** Specifiers written as a string or a substitution-free template: what the module reaches. */
  readonly literal: readonly string[];
  /**
   * The argument text of every `import(…)` or `require(…)` whose specifier is
   * not a literal: a variable, a template with substitutions, an expression.
   * No scan can say what one of these reaches, which is why the dependency
   * guard refuses them below `apps/` (a2-12).
   */
  readonly computed: readonly string[];
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
 * `import` or `require` **in code**, with only whitespace, comments or an
 * opening parenthesis between. A string that merely contains those words is a
 * string, and `Buffer.from('hex')` is a method call: a keyword after `.` is a
 * property name.
 */
export function importSpecifiers(source: string, options: ScanOptions = {}): ImportSpecifiers {
  const literal: string[] = [];
  const computed: string[] = [];
  let expecting: 'nothing' | 'specifier' | 'argument' = 'nothing';
  let keyword = '';
  /** A computed argument being collected up to its closing parenthesis. */
  let capture: { text: string; depth: number } | null = null;
  const opens = (c: string): boolean => c === '(' || c === '[' || c === '{';
  const closes = (c: string): boolean => c === ')' || c === ']' || c === '}';

  for (const token of tokenize(source, options)) {
    if (capture !== null && token.kind !== 'code') {
      capture.text += token.text;
      continue;
    }
    if (token.kind === 'comment') continue;
    if (token.kind === 'string' || (token.kind === 'template' && token.value !== undefined)) {
      if (expecting !== 'nothing') literal.push(token.value!);
      expecting = 'nothing';
      continue;
    }
    if (token.kind !== 'code') {
      // A template with substitutions, a regex, JSX text: computed if it is the argument.
      if (expecting === 'argument') capture = { text: token.text, depth: 0 };
      expecting = 'nothing';
      continue;
    }
    const text = token.text;
    let i = 0;
    let previousChar = '';
    while (i < text.length) {
      const c = text[i]!;
      if (capture !== null) {
        if (opens(c)) capture.depth += 1;
        else if (closes(c)) {
          if (capture.depth === 0) {
            computed.push(capture.text.trim());
            capture = null;
            previousChar = c;
            i += 1;
            continue;
          }
          capture.depth -= 1;
        }
        capture.text += c;
        i += 1;
        continue;
      }
      if (WHITESPACE.test(c)) {
        i += 1;
        continue;
      }
      if (WORD_CHARACTER.test(c)) {
        let j = i;
        while (j < text.length && WORD_CHARACTER.test(text[j]!)) j += 1;
        const word = text.slice(i, j);
        if (expecting === 'argument') {
          capture = { text: word, depth: 0 };
          expecting = 'nothing';
        } else if (
          previousChar !== '.' &&
          (word === 'from' || word === 'import' || word === 'require')
        ) {
          expecting = 'specifier';
          keyword = word;
        } else {
          expecting = 'nothing';
        }
        previousChar = word[word.length - 1]!;
        i = j;
        continue;
      }
      if (c === '(' && expecting === 'specifier' && keyword !== 'from') {
        expecting = 'argument';
      } else if (expecting === 'argument' && c !== ')') {
        capture = { text: c, depth: opens(c) ? 1 : 0 };
        expecting = 'nothing';
      } else {
        expecting = 'nothing';
      }
      previousChar = c;
      i += 1;
    }
  }
  if (capture !== null) computed.push(capture.text.trim());
  return { literal, computed };
}

/** The literal specifiers only. See {@link importSpecifiers}. */
export function moduleSpecifiers(source: string, options: ScanOptions = {}): string[] {
  return [...importSpecifiers(source, options).literal];
}

// ---------------------------------------------------------------------------
// File-kind vocabulary shared by every guard (a2-03)
// ---------------------------------------------------------------------------

/**
 * What counts as a TypeScript source file.
 *
 * **Cycle Audit 6, CA6-12.** The dependency guard read only `.ts`, so seven of
 * `apps/web`'s nine files — every React component — were never opened. The fix
 * added `.tsx`, `.mts` and `.cts` to that guard alone; the out-of-band audit
 * (a2-03) then planted `Date.now()` in a `.mts` under `packages/engine/src` and
 * in a `.tsx` under `packages/chart/src`, and the replayability scan opened
 * neither. One list now, imported by every guard that walks a tree: a guard
 * should fail because a rule was broken, never because of how a file was
 * spelled.
 */
export const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts'];

/**
 * What can ship from `src/`. A checked-in `.js` under `src/` is still code the
 * package publishes, and an import in one is still a dependency edge.
 */
export const SHIPPED_EXTENSIONS: readonly string[] = [
  ...SOURCE_EXTENSIONS,
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

export function isDeclarationFile(name: string): boolean {
  return /\.d\.(?:ts|mts|cts)$/.test(name);
}

export function isTestFile(name: string): boolean {
  return /\.test\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name);
}

export function isStatisticalTestFile(name: string): boolean {
  return /\.stat\.test\.(?:ts|tsx|mts|cts)$/.test(name);
}

export function isJsxFile(name: string): boolean {
  return /\.(?:tsx|jsx)$/.test(name);
}

export function hasExtension(name: string, extensions: readonly string[]): boolean {
  return extensions.some((extension) => name.endsWith(extension)) && !isDeclarationFile(name);
}

/** The lexing options a file's name implies. */
export function scanOptionsFor(file: string): ScanOptions {
  return { jsx: isJsxFile(file) };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Ambient nondeterminism. Any of these makes the containing module
 * unreplayable, and replay is a product invariant (INV-009).
 *
 * **a2-05.** Every form here that is not the plain member access was planted
 * against the previous list and passed: `Date()` without `new`,
 * `Intl.DateTimeFormat`, `process.uptime()`, `performance.timeOrigin`,
 * `process.argv`, Node's `global`, `Reflect.get(Math, "random")`,
 * `new Function("return Math.random()")`, `eval`, `Math["random"]`, and a
 * module-level `export let` as a channel. The list is longer now, and the
 * three rules that ban a *construct* rather than a *name* — bracket access on
 * a global, dynamic evaluation, and a global used as a value — close the
 * forms that no list of names can, because they are how a name is hidden.
 */
export const AMBIENT_RULES: readonly Rule[] = [
  {
    name: 'no-ambient-time',
    pattern:
      /(?:\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bDate\s*\(|\bIntl\s*\.\s*DateTimeFormat\b|\bperformance\s*\.\s*(?:now|timeOrigin)\b|\bprocess\s*\.\s*(?:hrtime|uptime)\b)/,
    reason: 'Ambient time makes a module unreplayable. Take a Clock instead.',
  },
  {
    name: 'no-ambient-randomness',
    pattern:
      /\b(?:Math\s*\.\s*random|randomBytes|randomUUID|randomInt|getRandomValues|randomFillSync|randomFill|generateKey(?:Sync|Pair|PairSync)?|webcrypto)\b/,
    reason:
      'Ambient randomness cannot be replayed or isolated per asset. Draw from a RandomStream instead.',
  },
  {
    name: 'no-ambient-state',
    pattern:
      /(?:\bglobalThis\b|\bglobal\b|\bprocess\s*\.\s*(?:env|argv|execArgv|getBuiltinModule)\b|\bimport\s*\.\s*meta\b(?!\s*\.\s*(?:url|dirname|filename)\b))/,
    reason:
      'Ambient mutable state is an unguarded channel into the price path. Cycle Audit 2 planted ' +
      'a backdoor reading operator exposure through `globalThis` and armed by `process.env`, and ' +
      'every import-based and vocabulary-based guardrail passed it. Environment also makes a ' +
      'module unreplayable, for the same reason ambient time does (INV-001, INV-009). ' +
      '`import.meta` is a value here too — `(import.meta as Record<string, unknown>).env` ' +
      'reaches the environment through a cast (a2-05, G1-24) — so only its path members ' +
      '`url`, `dirname` and `filename` may be read.',
  },
  {
    name: 'no-computed-global-access',
    pattern:
      /\b(?:Math|Date|process|performance|Intl|crypto|Reflect|globalThis|global|Atomics)\s*\[/,
    reason:
      'Bracket access names the property in a string the scan cannot read: `Date["now"]` is ' +
      '`Date.now` and `Math["exp"]` is `Math.exp` (a2-05). Write the member access, or do not ' +
      'touch the global.',
  },
  {
    name: 'no-dynamic-evaluation',
    pattern:
      /(?:\bReflect\s*\.|\bnew\s+Function\s*\(|(?<![\w$.])Function\s*\(|(?<![\w$.])eval\s*\()/,
    reason:
      '`Reflect`, the `Function` constructor and `eval` reach any global by a name assembled at ' +
      'run time (a2-05). Nothing replayable needs them.',
  },
  {
    name: 'no-global-aliasing',
    pattern: /\b(?:Math|Date|process|performance|Intl|crypto|Reflect)\b(?!\s*[.[(])/,
    reason:
      'A global used as a value — `const M = Math`, `const { exp } = Math`, `f(Date)` — is a ' +
      'member access the scan will not see at the call site (a2-05). Name the member here.',
  },
  {
    name: 'no-mutable-module-state',
    pattern: /^\s*export\s+(?:let|var)\b/,
    reason:
      'A mutable module-level export is a channel any importer can write and the price path can ' +
      'read, and it names nothing (B-007, a2-05). Export a function or a readonly value.',
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
 *
 * What a vocabulary scan cannot see, and does not claim to: a word split across
 * string literals and joined at run time (`this["pay" + "out"]`). The bracket
 * access itself is what would have to be banned, and `record[key]` is ordinary
 * code. The behavioural tests — tick identity under trading, the settlement
 * mirror — are the defence against that form (B-007).
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
  const stripped = stripCommentsAndStrings(source, scanOptionsFor(file));
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
