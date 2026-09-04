import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PH-24.6: the panel speaks Spanish to the operator and explains itself only
 * behind ⓘ.
 *
 * Two source-level rules, because the browser suite runs only where Chromium
 * launches and a language rule that is off on most machines is not a rule:
 *
 * 1. **No explanatory paragraph inline.** A JSX text node longer than 140
 *    characters outside an `Info` tooltip is an explanation on the surface.
 * 2. **No English UI word in JSX text.** A list of the words the old panel used
 *    — `hosted`, `Create asset`, `Apply`, `Release market`… — may not appear as
 *    rendered text. What may remain in English is enumerated: the §3 banner,
 *    ids, `SIM`, timeframe ids, API field names inside tooltips.
 *
 * Both scan comment-stripped source, for the reason every guard here does: the
 * place an English word is likeliest to appear is the comment explaining why it
 * must not.
 */
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** JSX text nodes: what sits between a `>` and a `<` and is not an expression. */
function textNodes(source: string): string[] {
  return (
    [...source.matchAll(/>([^<>{}]+)</g)]
      .map((m) => m[1]!.replace(/\s+/g, ' ').trim())
      // A `>` also closes a TypeScript generic — `useState<T | null>(null); const…`
      // — and what follows it is code, not text. UI text carries none of these.
      .filter((t) => t.length > 0 && !/=>|\bconst\b|\buseState\b|\(\)|\w=\w|;\s*\w+\(/.test(t))
  );
}

const ENGLISH = [
  'Preview',
  'Create asset',
  'Create an asset',
  'Assets',
  'hosted',
  'idle',
  'retired',
  'rename',
  'retire',
  'save',
  'cancel',
  'Loading',
  'Measure',
  'Apply',
  'Preview',
  'Release market',
  'Run',
  'sampled ticks',
  'hypotheses tested',
  'acceptance rate',
  'reachability',
  'ticks in window',
  'sign source',
  'last applied',
  'open CALL',
  'open PUT',
  'expected',
  'actual',
  'agrees',
  'MARKET STATE',
  'CANDLE CLOSE CONTROL',
  'MARKET QUALITY',
  'SIMULATED POSITIONS',
  'SCENARIOS',
  'SESSION',
  'Register',
  'Registering',
  'watch it',
  'filter by',
  'bars',
  'live bar',
  'no live bar',
  'not hosted',
  'engine ok',
  'engine unreachable',
  'engine degraded',
  'nothing recorded yet',
  'no simulated position',
  'no reading yet',
  'lattice level',
  'previous magnitude',
  'keystream cursors',
];

describe('the panel speaks Spanish and explains itself behind ⓘ (PH-24.6)', () => {
  const files = tsxFiles(app);

  it('finds the panel', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('renders no explanatory paragraph inline', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = code(file);
      // Text handed to `Info` is allowed to be long: strip `<Info text={...}>`,
      // `info={...}`, `detail={...}` and `text={...}` props before scanning, and
      // the `es` dictionary is not a component.
      const stripped = source.replace(
        /(?:text|info|detail|title)=\{[\s\S]*?\}\s*(?=\/?>|\w+=)/g,
        '',
      );
      for (const node of textNodes(stripped)) {
        if (node.length > 140)
          offenders.push(
            `${path.relative(app, file)}: "${node.slice(0, 60)}…" (${String(node.length)} chars)`,
          );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders no English UI word as text', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const node of textNodes(code(file))) {
        for (const word of ENGLISH) {
          if (
            new RegExp(`(^|[^\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(
              node,
            )
          ) {
            offenders.push(`${path.relative(app, file)}: "${node}" contains "${word}"`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses one Info component everywhere', () => {
    const users = files.filter((f) => /\bInfo\b/.test(code(f)) && !/ui[\\/]kit\.tsx$/.test(f));
    expect(users.length, 'fewer pages use Info than exist').toBeGreaterThanOrEqual(6);
    const definitions = files.filter((f) => /export function Info\(/.test(readFileSync(f, 'utf8')));
    expect(definitions.map((f) => path.relative(app, f))).toEqual(['ui/kit.tsx']);
  });
});
