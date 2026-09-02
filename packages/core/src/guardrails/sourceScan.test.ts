import { describe, expect, it } from 'vitest';
import {
  AMBIENT_RULES,
  decodeIdentifierEscapes,
  importSpecifiers,
  moduleSpecifiers,
  scanSource,
  stripCommentsAndStrings,
  stripCommentsKeepingStrings,
  tokenize,
} from './sourceScan.js';

/**
 * The lexer's corpus: every construct an audit has used to hide code from a
 * scanner, kept as a permanent case.
 *
 * Three audits in a row defeated the source scanners with a lexing gap one
 * construct wide — comment markers inside strings (CA5-05), a regex class
 * containing `/*` (CA6-03), and then a regex after a keyword or a backtick
 * inside `${}` (a2-01, a2-02). Each fix handled the construct it was shown and
 * the next audit found the neighbour. So the cases live here, all of them, and
 * a lexer change that reopens any one of them fails the unit suite.
 *
 * Every case is the same shape: some construct, then a `Date.now()` and a
 * static `@otc/engine` import that must still be seen by all three scanners.
 * The labels are the auditor's (a2's plant table), so the record and the test
 * name the same thing.
 */

const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
/** `a`, built at run time so no tool between here and disk decodes it. */
const ESCAPED_A = `${BACKSLASH}u0061`;
const ESCAPED_A_BRACED = `${BACKSLASH}u{61}`;

const HIDDEN = ['const t = Date.now();', "import * as gen from '@otc/engine';", 'const c = "*/";'];

interface Case {
  readonly label: string;
  readonly construct: string;
  readonly jsx?: boolean;
}

/** Constructs that hid code from at least one scanner before the shared lexer. */
const EVASIONS: readonly Case[] = [
  { label: 'CA5-05: comment markers inside strings', construct: "const OPEN = '/*';" },
  { label: 'CA6-03 / S-10: regex class containing /* after =', construct: 'const r = /[/*]/;' },
  {
    label: 'a2-01 S-02 / D-19 / W-17: regex after return',
    construct: 'function f(s: string): boolean {\n  return /[/*]/.test(s);\n}',
  },
  {
    label: 'a2-01 S-03: regex after the ) of an if head',
    construct: 'if (x > 0) /[/*]/.test("a");',
  },
  {
    label: 'a2-01 S-04 / D-21 / W-19: regex class with an escaped ] then //*',
    construct: `const r = /[${BACKSLASH}]//*]/;`,
  },
  {
    label: 'a2-01 S-05 / S-07: regex containing a quote after return',
    construct: "function g(s: string): boolean {\n  return /'/.test(s);\n}",
  },
  { label: 'a2-01 S-13 / S-19: regex after typeof', construct: 'const t13 = typeof /[/*]/;' },
  {
    label: 'a2-01 S-20: regex after the } of a block',
    construct: 'function h(): void {}\n/[/*]/.test("a");',
  },
  {
    label: 'a2-01: regex after case',
    construct: 'switch (x) {\n  case /[/*]/.test("a"):\n    break;\n}',
  },
  {
    label: 'a2-01: regex after in / of / instanceof',
    construct: 'const a = "x" in /[/*]/;\nfor (const m of /[/*]/.exec("a") ?? []) void m;',
  },
  { label: 'a2-01: regex after void / throw', construct: 'void /[/*]/;\nthrow /[/*]/;' },
  {
    label: 'a2-01: regex after yield / await / else / do',
    construct:
      'async function* k() {\n  yield /[/*]/;\n  await /[/*]/;\n}\nif (x) {\n} else /[/*]/.test("a");\ndo /[/*]/.test("a");\nwhile (false);',
  },
  {
    label: 'a2-01: regex after the ) of a while and a for head',
    construct: 'while (false) /[/*]/.test("a");\nfor (;;) /[/*]/.test("a");',
  },
  {
    label: 'a2-02 S-01 / D-20 / W-18: template with a backtick inside ${}',
    construct: `const s = ${BACKTICK}\${"${BACKTICK}"}${BACKTICK};`,
  },
  {
    label: 'a2-02 (23): template whose substitution contains a backtick and a call',
    construct: `const s = ${BACKTICK}\${"${BACKTICK}" + String(1)}${BACKTICK};`,
  },
  {
    label: 'a2-02: template nested inside a substitution inside a template',
    construct: `const s = ${BACKTICK}a\${${BACKTICK}b\${"${BACKTICK}"}c${BACKTICK}}d${BACKTICK};`,
  },
  {
    label: 'a2-02: a substitution containing a regex class and a string with a comment marker',
    construct: `const s = ${BACKTICK}\${/[/*]/.test("*/") ? "/*" : "x"}${BACKTICK};`,
  },
  {
    label: 'a2-01: postfix non-null assertion before a division',
    construct: 'const q = xs[0]! / ys[1]! / 2;',
  },
  { label: 'shebang', construct: '#!/usr/bin/env node' },
  {
    label: 'S-09 / D-13: JSX text with an apostrophe',
    construct: "function Note(): unknown {\n  return <p>Don't panic</p>;\n}",
    jsx: true,
  },
  {
    label: 'JSX-A / D-23: a JSX closing tag before an import',
    construct: 'function Note(): unknown {\n  return <p>x</p>;\n}',
    jsx: true,
  },
  {
    label: 'JSX-B: a self-closing element',
    construct: 'function Note(): unknown {\n  return <Chart />;\n}',
    jsx: true,
  },
  {
    label: 'JSX: nested elements, attributes with quotes, expression containers, fragments',
    construct:
      'function Note(): unknown {\n  return (\n    <>\n      <div className="a\'b" style={{ color: "#fff" }}>\n        {items.map((i) => (\n          <li key={i}>{i > 1 ? "it\'s" : `x`}</li>\n        ))}\n        text with "quotes" and \'apostrophes\' and a / slash\n      </div>\n    </>\n  );\n}',
    jsx: true,
  },
  {
    label: 'JSX: a comment container and a comparison inside a container',
    construct:
      'function Note(): unknown {\n  return <p>{/* a comment */}{a < b && c > d ? "y" : "n"}</p>;\n}',
    jsx: true,
  },
];

/** Constructs that were never a problem, and must not become one. */
const CONTROLS: readonly Case[] = [
  { label: 'S-06: a division chain', construct: 'const q = steps / 2 / 1;' },
  { label: 'S-07: a string containing */', construct: 'const s = "*/";' },
  { label: 'S-08: an apostrophe inside a double-quoted string', construct: 'const s = "it\'s";' },
  {
    label: 'S-09: a regex containing escaped slashes',
    construct: `const r = /${BACKSLASH}/${BACKSLASH}//;`,
  },
  {
    label: 'S-11: a line continuation inside a string',
    construct: `const s = 'a${BACKSLASH}\nb';`,
  },
  { label: 'S-12: a regex class [//]', construct: 'const r = /[//]/;' },
  {
    label: 'S-14: a regex as an arrow body',
    construct: 'const f = (s: string) => /[/*]/.test(s);',
  },
  { label: 'a URL inside a string', construct: 'const u = "http://example.com/*/x";' },
  {
    label: 'a regex with flags followed by a division',
    construct: 'const n = /a/gi.test("a") ? 1 / 2 : 3;',
  },
  {
    label: 'a property named return or from before a division',
    construct: 'const n = obj.return / 2 + Buffer.from("aa", "hex").length / 3;',
  },
  {
    label: 'a generic arrow in a .tsx file is not JSX',
    construct: 'const id = <T,>(x: T): T => x;',
    jsx: true,
  },
  {
    label: 'a type argument after an identifier in a .tsx file is not JSX',
    construct: 'const xs: Array<string> = []; const m = new Map<string, number>();',
    jsx: true,
  },
  {
    label: 'a comparison in a .tsx file is not JSX',
    construct: 'const lt = a < b && c > d;',
    jsx: true,
  },
];

function withHidden(c: Case): string {
  return [c.construct, ...HIDDEN].join('\n');
}

describe('the lexer sees code after every construct an audit has hidden it behind', () => {
  it.each([...EVASIONS, ...CONTROLS].map((c) => [c.label, c] as const))('%s', (_label, c) => {
    const source = withHidden(c);
    const options = { jsx: c.jsx === true };
    const file = c.jsx === true ? 'x.tsx' : 'x.ts';

    // The ambient scan sees the call.
    const time = scanSource(file, source, AMBIENT_RULES).filter(
      (v) => v.rule === 'no-ambient-time',
    );
    expect(time, 'Date.now() hidden from scanSource').toHaveLength(1);
    // Its line number is right: the call is on the line after the construct.
    expect(time[0]!.line).toBe(c.construct.split('\n').length + 1);

    // The dependency scan sees the import.
    expect(moduleSpecifiers(source, options), 'import hidden from moduleSpecifiers').toContain(
      '@otc/engine',
    );

    // The follower scan sees the specifier and the identifier.
    const kept = stripCommentsKeepingStrings(source, options);
    expect(kept, 'import hidden from stripCommentsKeepingStrings').toContain('@otc/engine');
    expect(kept).toContain('Date.now()');

    // And the tokens still spell the source.
    expect(
      tokenize(source, options)
        .map((t) => t.text)
        .join(''),
    ).toBe(source);
    // Line numbering survives both renderings.
    expect(stripCommentsAndStrings(source, options).split('\n')).toHaveLength(
      source.split('\n').length,
    );
    expect(kept.split('\n')).toHaveLength(source.split('\n').length);
  });
});

describe('what the lexer removes', () => {
  it('drops a genuine comment, including one that looks like an import', () => {
    const source = '/* import x from "@otc/engine" */ const a = 1; // Date.now()\n';
    expect(stripCommentsKeepingStrings(source)).not.toContain('@otc/engine');
    expect(scanSource('x.ts', source, AMBIENT_RULES)).toHaveLength(0);
  });

  it('drops string and template contents but keeps template substitutions as code', () => {
    const source = `const m = "Date.now()";\nconst t = ${BACKTICK}Date.now() \${Date.now()}${BACKTICK};`;
    const found = scanSource('x.ts', source, AMBIENT_RULES).filter(
      (v) => v.rule === 'no-ambient-time',
    );
    // The string and the template's literal text are prose; the substitution is a call.
    expect(found.map((v) => v.line)).toEqual([2]);
  });

  it('drops a regex body, so /createMarketEngine/ trips no identifier scan, but keeps its flags', () => {
    expect(stripCommentsKeepingStrings('const r = /createMarketEngine/gi;')).toBe(
      'const r = / /gi;',
    );
    expect(stripCommentsAndStrings('const r = /createMarketEngine/gi;')).toBe('const r = / /gi;');
  });

  it('blanks JSX text in the code rendering and keeps it in the string-keeping one', () => {
    const source = "const e = <p>payout Don't</p>;";
    expect(stripCommentsAndStrings(source, { jsx: true })).toBe('const e = <p></p>;');
    expect(stripCommentsKeepingStrings(source, { jsx: true })).toBe(source);
  });

  it('never opens a JSX element in a .ts file', () => {
    const source = 'const a = x < y;\nconst b = z > w;\nconst t = Date.now();';
    expect(scanSource('x.ts', source, AMBIENT_RULES)).toHaveLength(1);
    expect(stripCommentsAndStrings(source)).toBe(source);
  });

  it('resynchronises at the end of a line when a regex guess is wrong', () => {
    // After a `}` a `/` may begin a regex; with no closing slash on the line the
    // guess fails and the `/` is the division it was. (With a second slash on
    // the line the guess would hold to it, and that is the bound on the damage:
    // one line, never a file. Real code parenthesises an object before dividing
    // it, and `)` is division.)
    const source = 'const q = {} / 2;\nconst t = Date.now();';
    expect(stripCommentsAndStrings(source)).toBe(source);
    expect(scanSource('x.ts', source, AMBIENT_RULES)).toHaveLength(1);
  });

  it('hands back a < that opens no closing element', () => {
    const source = 'const f = <T extends object>(x: T): T => x;\nconst t = Date.now();';
    expect(scanSource('x.tsx', source, AMBIENT_RULES)).toHaveLength(1);
  });
});

describe('identifier escapes are decoded (a2-05: G1-15, G1-33, G1-35, W-05, K-05)', () => {
  it('decodes both escape forms', () => {
    expect(decodeIdentifierEscapes(`Math.r${ESCAPED_A}ndom`)).toBe('Math.random');
    expect(decodeIdentifierEscapes(`Math.r${ESCAPED_A_BRACED}ndom`)).toBe('Math.random');
    expect(decodeIdentifierEscapes('plain')).toBe('plain');
  });

  it('so an escaped Math.random, Math.exp and .payout reach the rules', () => {
    const source = [
      `const p15 = Math.r${ESCAPED_A}ndom();`,
      `const p33 = (this as { payout: number }).p${ESCAPED_A}yout;`,
      `const p35 = Math.${BACKSLASH}u0065xp(0.1);`,
    ].join('\n');
    const stripped = stripCommentsAndStrings(source);
    expect(stripped).toContain('Math.random()');
    expect(stripped).toContain('.payout;');
    expect(stripped).toContain('Math.exp(0.1)');
  });

  it('so an escaped MasterKeyring or RandomStream is seen by the identifier scans', () => {
    const source = `import { M${ESCAPED_A}sterKeyring } from '@otc/core';\nexport const w05 = core.R${ESCAPED_A}ndomStream;`;
    const kept = stripCommentsKeepingStrings(source);
    expect(kept).toContain('MasterKeyring');
    expect(kept).toContain('RandomStream');
  });

  it('decodes escapes inside a specifier string too', () => {
    expect(moduleSpecifiers(`import x from '@otc/${BACKSLASH}u0065ngine';`)).toEqual([
      '@otc/engine',
    ]);
  });
});

describe('module specifiers', () => {
  it('reads every static and dynamic form', () => {
    const source = [
      "import a from 'a';",
      "import { b } from 'b';",
      "import type { c } from 'c';",
      "import * as d from 'd';",
      "import 'e';",
      "export * from 'f';",
      "export { g } from 'g';",
      "const h = await import('h');",
      "const i = require ( 'i' );",
      `const j = import(${BACKTICK}j${BACKTICK});`,
      "import k = require('k');",
      "const l = await import(\n  // a comment\n  'l',\n);",
    ].join('\n');
    expect(moduleSpecifiers(source)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
    ]);
  });

  it('does not read a fixture string, a method named from, or import.meta as an import', () => {
    const source = [
      'const fixture = "import * as engineModule from \'@otc/engine\';";',
      "const bytes = Buffer.from('302e0201', 'hex');",
      "const xs = Array.from('abc');",
      'const url = import.meta.url;',
      "const r = obj.require('x');",
    ].join('\n');
    expect(moduleSpecifiers(source)).toEqual([]);
  });

  it('reports a computed specifier rather than silently reading nothing (a2-12: D-06, D-07)', () => {
    const source = [
      "const spec = '@otc/lab';",
      'const d07 = import(spec);',
      "const d06 = import(['@otc', 'lab'].join('/'));",
      `const d05 = import(${BACKTICK}@otc/\${name}${BACKTICK});`,
      "const ok = import('@otc/core');",
    ].join('\n');
    const found = importSpecifiers(source);
    expect(found.literal).toEqual(['@otc/core']);
    expect(found.computed).toHaveLength(3);
    expect(found.computed[0]).toBe('spec');
    expect(found.computed[1]).toContain("['@otc', 'lab'].join('/')");
  });
});
