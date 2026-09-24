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

/**
 * PH-31. The operator asked for this after using the strip: "cuando un botón
 * está desactivado debe aparecer en gris". Both button components kept the
 * colour of what they do — a green `+10`, a red `−10` — and only dropped their
 * opacity, so a level the market's ceiling had refused still read as
 * available, and the way to find out was to click it.
 */
describe('a button that cannot be pressed looks like one (PH-31)', () => {
  it('drops the kind’s colour for the neutral surface when disabled', () => {
    const kit = code(path.join(app, 'ui/kit.tsx'));
    // The background is the theme's raised surface when disabled, not the
    // kind's own — asserted on the expression, because the colours themselves
    // are the theme's to change.
    expect(kit).toMatch(/background:\s*disabled\s*\?\s*T\.raised\s*:\s*background/);
    expect(kit).toMatch(/border:\s*`1px solid \$\{disabled \? T\.line : border\}`/);
    expect(kit).toMatch(/color:\s*disabled\s*\?\s*T\.faint/);
    expect(kit).toMatch(/cursor:\s*disabled\s*\?\s*'not-allowed'/);
  });

  it('greys the Lab panel’s keys the same way, pressed or not', () => {
    const controls = code(path.join(app, 'lab/Controles.tsx'));
    expect(controls).toMatch(/background:\s*disabled\s*\?\s*T\.raised\s*:\s*lit\s*\?/);
    expect(controls).toMatch(/border:\s*`1px solid \$\{disabled \? T\.line : tone\.border\}`/);
  });
});

/**
 * The quiet notice is about the engine, not about the market (2026-09-23).
 *
 * The Human Owner watched the panel blink between `en vivo` and a warning
 * about the engine's health while the price was rolling normally. It was the
 * notice firing on the market's own quiet: a Hawkes process leaves a gap of
 * three mean intervals about five per cent of the time, and at PH-34's tick
 * rates that is often enough to see. Measured on the catalogue's own arrivals,
 * 400,000 ticks per asset, gaps longer than `k` mean intervals per hour:
 *
 * | asset    | k=3   | k=5   | k=10 | k=15 | k=20 |
 * | -------- | ----- | ----- | ---- | ---- | ---- |
 * | eurusd   | 193.4 | 31.7  | 0.3  | 0.0  | 0.0  |
 * | aapl     | 385.0 | 68.9  | 1.3  | 0.0  | 0.0  |
 * | dogeusdt | 1,095.7 | 283.5 | 14.1 | 0.9 | 0.0 |
 *
 * The longest natural gap in that run was 15.9 s of EUR/USD, sixteen times its
 * mean. So the threshold is twenty means and never under the catch-up bound,
 * which is the point past which the runtime itself calls a market behind.
 */
describe('the panel calls a market quiet only when the engine has stopped', () => {
  const chart = readFileSync(path.join(app, 'preview', 'PreviewChart.tsx'), 'utf8');

  it('waits at least twenty mean intervals, and at least the catch-up bound', () => {
    const multiple = /export const STALL_MULTIPLE = (\d+);/.exec(chart);
    expect(multiple, 'STALL_MULTIPLE is no longer declared where this reads it').not.toBeNull();
    expect(
      Number(multiple![1]),
      'a gap of ten means is ordinary on this catalogue',
    ).toBeGreaterThanOrEqual(20);
    const floor = /export const MIN_QUIET_MS = ([\d_]+);/.exec(chart);
    expect(floor, 'MIN_QUIET_MS is no longer declared where this reads it').not.toBeNull();
    expect(
      Number(floor![1]!.replace(/_/g, '')),
      'below the catch-up bound nothing is behind',
    ).toBeGreaterThanOrEqual(15_000);
  });

  it('takes both into account rather than the multiple alone', () => {
    expect(chart).toMatch(
      /Math\.max\(\s*STALL_MULTIPLE \* asset\.meanIntervalMs,\s*MIN_QUIET_MS,?\s*\)/,
    );
  });

  it('says it in Spanish, like every other status', () => {
    const es = readFileSync(path.join(app, '..', 'lib', 'es.ts'), 'utf8');
    expect(es).toMatch(/quiet: \(seconds: number\)/);
    expect(chart).toMatch(/es\.preview\.status\.quiet\(/);
  });
});

describe('a hole in the record is named by every status that follows it (Cycle Audit 12)', () => {
  const chart = readFileSync(path.join(app, 'preview', 'PreviewChart.tsx'), 'utf8');

  it('appends the bounds at every setStatus, not at three of seven', () => {
    // **A hole is a fact about the record, not about the connection.** PH-34
    // added the suffix and reached three of the seven statuses; the reconnect
    // countdown — which can hold the screen for thirty seconds an attempt —
    // the history reload and the history-only status all dropped it. Reverting
    // that fix passed the whole web unit suite, and the browser case cannot
    // discriminate it: its own scenario reaches the screen through
    // `liveStatus()`, which carries the suffix by another path.
    //
    // So this counts. Every `setStatus` either calls `liveStatus()` — which
    // appends the suffix itself — or appends `holeSuffix()` in its own
    // template.
    const calls = chart.match(/setStatus\(/g) ?? [];
    expect(calls.length, 'the count moved; check each new status names the hole').toBeGreaterThan(
      5,
    );
    const bodies = chart.split('setStatus(').slice(1);
    const silent = bodies.filter((body) => {
      const call = body.slice(0, body.indexOf(';'));
      return !/holeSuffix\(\)/.test(call) && !/liveStatus\(\)/.test(call);
    });
    expect(silent, `${String(silent.length)} status(es) drop the hole bounds`).toHaveLength(0);
  });

  it('states the bounds rather than calling it a gap', () => {
    const es = readFileSync(path.join(app, '..', 'lib', 'es.ts'), 'utf8');
    expect(es).toMatch(/holeBounded: \(/);
    expect(chart).toMatch(/es\.preview\.status\.holeBounded\(hole\.from, hole\.to\)/);
  });
});
