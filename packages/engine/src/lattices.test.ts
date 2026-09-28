// Invariant evidence: INV-002 (shared market), INV-009 (reproducible settlement).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE } from './catalogue.js';
import { FRAME_BEFORE_PH37, FRAME_BEFORE_PH40, LATTICE_BEFORE_PH37 } from './lattices.js';

/**
 * The lattice this release says it moved from is the one the previous release
 * published on.
 *
 * **Cycle Audit 12 built this, because the guard that existed was tautological.**
 * `LATTICE_BEFORE_PH37` is thirty floats that are the only surviving
 * description of what thirty live markets published on: a checkpoint written
 * before PH-37 declares no quantum, and the tick record and the candle history
 * never did, so when a price has to be re-expressed this table is the only
 * thing that can say from what. The test written with it asserted each value
 * against a band computed from *the same constant*, and an auditor's
 * **2.58×-wrong** entry passed the entire 3,529-test suite.
 *
 * A wrong entry is silent by construction — it converts a price to somewhere
 * nobody published — so the only check worth having compares against the thing
 * it claims to describe. `git archive` the previous tag, build its engine, read
 * its catalogue. Measured on this machine: about 4 s.
 *
 * The `@otc/*` links matter. The workspace's `node_modules/@otc/*` point at the
 * *current* packages, so an old tree left to itself imports today's core and
 * the comparison goes red on a clean checkout — a false alarm, not a silence
 * (Cycle Audit 12's refuter measured both). The materialised tree gets its own.
 */
const PREVIOUS_TAG = 'v2.3.1';
const REPO = path.resolve(import.meta.dirname, '../../..');

/** True when this tree is a git checkout that has the tag; a package has neither. */
function tagIsAvailable(): boolean {
  try {
    execFileSync('git', ['-C', REPO, 'rev-parse', `${PREVIOUS_TAG}^{commit}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function materialise(tag: string): string {
  const to = path.join(tmpdir(), `otc-previous-${tag}`);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  execFileSync('bash', ['-c', `git -C '${REPO}' archive ${tag} | tar -x -C '${to}'`]);
  const shared = path.join(REPO, 'node_modules');
  mkdirSync(path.join(to, 'node_modules', '@otc'), { recursive: true });
  for (const entry of readdirSync(shared)) {
    if (entry === '@otc') continue;
    symlinkSync(path.join(shared, entry), path.join(to, 'node_modules', entry));
  }
  for (const pkg of readdirSync(path.join(to, 'packages'))) {
    symlinkSync(path.join(to, 'packages', pkg), path.join(to, 'node_modules', '@otc', pkg));
  }
  return to;
}

function framesPublishedBy(
  tree: string,
): Record<string, { logQuantum: number; referencePrice: number; displayPrecision: number }> {
  execFileSync(path.join(tree, 'node_modules/.bin/tsc'), ['-b', 'packages/engine'], { cwd: tree });
  const probe = path.join(tree, 'frame-probe.mjs');
  writeFileSync(
    probe,
    `import { ASSET_CATALOGUE } from '@otc/engine';\n` +
      `const out = {};\n` +
      `for (const a of ASSET_CATALOGUE) out[a.definition.id] = {\n` +
      `  logQuantum: a.instrument.logQuantum,\n` +
      `  referencePrice: a.instrument.referencePrice,\n` +
      `  displayPrecision: a.instrument.displayPrecision };\n` +
      `console.log(JSON.stringify(out));\n`,
  );
  return JSON.parse(execFileSync('node', [probe], { cwd: tree, encoding: 'utf8' })) as Record<
    string,
    { logQuantum: number; referencePrice: number; displayPrecision: number }
  >;
}

function lattticesPublishedBy(tree: string): Record<string, number> {
  execFileSync(path.join(tree, 'node_modules/.bin/tsc'), ['-b', 'packages/engine'], { cwd: tree });
  const probe = path.join(tree, 'lattice-probe.mjs');
  writeFileSync(
    probe,
    `import { ASSET_CATALOGUE } from '@otc/engine';\n` +
      `const out = {};\n` +
      `for (const a of ASSET_CATALOGUE) out[a.definition.id] = a.instrument.logQuantum;\n` +
      `console.log(JSON.stringify(out));\n`,
  );
  return JSON.parse(execFileSync('node', [probe], { cwd: tree, encoding: 'utf8' })) as Record<
    string,
    number
  >;
}

describe('the lattice the release carries is the one the release before it published', () => {
  it(`matches ${PREVIOUS_TAG}'s catalogue, asset for asset, exactly`, () => {
    if (!existsSync(path.join(REPO, 'packages')) || !tagIsAvailable()) {
      // An integration package has no git history; there is nothing to compare
      // against and nothing to be wrong about, because the table ships frozen.
      return;
    }
    const tree = materialise(PREVIOUS_TAG);
    const published = lattticesPublishedBy(tree);
    const carried: Record<string, number> = {};
    for (const asset of ASSET_CATALOGUE)
      carried[asset.definition.id] = LATTICE_BEFORE_PH37[asset.definition.id]!;
    // Exact. A price is an integer count of quanta, and a quantum that is
    // nearly right converts it to a price nobody published.
    expect(carried).toEqual(published);

    // **And the whole frame, not only the quantum (PH-38.2).** A price is
    // `referencePrice * exp(logQuantum * price)` rendered to `displayPrecision`
    // decimals, so declaring the past with today's precision loses digits that
    // were published: eurusd published seven and was answered with six, tsla
    // and meta published four and were answered with two. Checking only the
    // quantum is what let that through — the table was right about the one
    // field it was checked on.
    const publishedFrames = framesPublishedBy(tree);
    const carriedFrames: Record<string, unknown> = {};
    for (const asset of ASSET_CATALOGUE)
      carriedFrames[asset.definition.id] = FRAME_BEFORE_PH37[asset.definition.id]!;
    expect(carriedFrames).toEqual(publishedFrames);
  }, 120_000);
});

/**
 * **The second table, and why it can be written from today's catalogue**
 * (the readiness audit of 2026-09-28). PH-40.3 moved six assets'
 * `displayPrecision` and nothing else — every quantum and reference byte for byte
 * what `v2.4.0` published — so `FRAME_BEFORE_PH40` is the current frames with six
 * overrides. If a later phase moves a quantum, this test is what says the frozen
 * table has stopped describing what `v2.4.0` published.
 */
describe('the frames v2.4.0 published are today’s, with six older precisions', () => {
  const OLDER_PRECISION: Readonly<Record<string, number>> = {
    'tsla-otc': 2,
    'meta-otc': 2,
    'btcusdt-otc': 0,
    'bnbusdt-otc': 2,
    'aix-idx-otc': 2,
    'tcx-idx-otc': 2,
  };

  it('differs from the current catalogue in exactly those six, and only in precision', () => {
    expect(Object.keys(FRAME_BEFORE_PH40).sort()).toEqual(
      ASSET_CATALOGUE.map((a) => a.definition.id).sort(),
    );
    const moved: string[] = [];
    for (const asset of ASSET_CATALOGUE) {
      const id = asset.definition.id;
      const then = FRAME_BEFORE_PH40[id]!;
      const now = asset.instrument;
      // A quantum or a reference that moved would make this table a conversion,
      // not a relabelling, and it is not one.
      expect(then.logQuantum, `${id} quantum`).toBe(now.logQuantum);
      expect(then.referencePrice, `${id} reference`).toBe(now.referencePrice);
      if (then.displayPrecision !== now.displayPrecision) moved.push(id);
      expect(then.displayPrecision, `${id} precision`).toBe(
        OLDER_PRECISION[id] ?? now.displayPrecision,
      );
    }
    expect(moved.sort()).toEqual(Object.keys(OLDER_PRECISION).sort());
  });
});
