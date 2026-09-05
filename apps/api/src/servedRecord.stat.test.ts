// Invariant evidence: INV-002 (shared market), INV-003 (single underlying stream),
// INV-008 (continuous market state), INV-010 (private generator state).
// Not INV-006: at the size a test can afford the battery tests no hypothesis
// (Cycle Audit 9, a4-05/a1-03); the leak-through-the-wire evidence is the fake
// venue in `servedAssurance.test.ts`, and the venue's own record is graded by
// `npm run assurance:served` at the sizes a venue retains.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { assertTickOrder, timeframe, type Candle } from '@otc/core';
import { ASSET_CATALOGUE } from '@otc/engine';
import {
  joinServedRecords,
  readServedRecord,
  seamIndicesOf,
  servedAssurance,
  ServedRecordError,
  type ServedRecord,
} from '@otc/lab';

/**
 * PH-25.1 — the served record, read from outside the process.
 *
 * `servedRecord.test.ts` proved the client against frames it was handed. This
 * hands it a real `apps/api` over a real socket and asks the three questions
 * the phase exists for: do two observers hold the same record, is that record
 * the one the venue itself stored, and does it continue across a kill.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const entry = path.join(repoRoot, 'apps/api/dist/main.js');
const SECRET = 'e'.repeat(64);
/** The fastest tape in the catalogue, derived rather than named (PH-26.3). */
const ASSET = [...ASSET_CATALOGUE].sort(
  (a, b) => a.evidence.meanIntervalMs - b.evidence.meanIntervalMs,
)[0]!.definition.id;
/** Enough ticks on the fastest tape to close whole one-minute candles. */
const SPAN_TICKS = 1_800;
const RESUME_TICKS = 300;

interface Running {
  readonly child: ChildProcess;
  readonly port: number;
  readonly base: string;
  readonly output: () => string;
}

const started: ChildProcess[] = [];
const directories: string[] = [];

afterAll(async () => {
  for (const child of started) if (child.exitCode === null) child.kill('SIGKILL');
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

/** Boot on the first free port from `basePort` (see `clientReconstruction.stat.test.ts`). */
async function boot(stateDir: string, basePort: number): Promise<Running> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = basePort + attempt;
    try {
      return await bootOn(stateDir, port);
    } catch (error) {
      if (!String((error as Error).message).includes('EADDRINUSE')) throw error;
      // A failed attempt may have written into the state directory before the
      // port refused it (CA9 a8-11); the next attempt starts from nothing
      // rather than from a half-written record. The deliberate restart later
      // reuses the directory on purpose, after a clean boot.
      await rm(stateDir, { recursive: true, force: true });
      await mkdir(stateDir, { recursive: true });
    }
  }
  throw new Error(`no free port from ${basePort}`);
}

async function bootOn(stateDir: string, port: number): Promise<Running> {
  const nonce = randomUUID();
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      OTC_STATE_DIR: stateDir,
      OTC_MASTER_SECRET: SECRET,
      OTC_BOOT_NONCE: nonce,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited (${child.exitCode}):\n${output.slice(-2_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const health = (await response.json()) as { bootNonce: string | null };
        if (health.bootNonce === nonce) {
          return { child, port, base: `http://127.0.0.1:${port}`, output: () => output };
        }
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`service never became healthy:\n${output.slice(-2_000)}`);
}

interface MarketView {
  readonly sequence: number | null;
  readonly recovery:
    | { kind: 'fresh' }
    | { kind: 'resumed'; fromSequence: number }
    | { kind: 'seam'; reason: string; fromSequence: number | null }
    | null;
}

async function market(running: Running): Promise<MarketView> {
  const response = await fetch(`${running.base}/markets/${ASSET}`);
  return (await response.json()) as MarketView;
}

async function waitForTicks(running: Running, minSequence: number): Promise<MarketView> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const view = await market(running);
    if ((view.sequence ?? -1) >= minSequence) return view;
    if (Date.now() > deadline) throw new Error(`never reached sequence ${minSequence}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function read(running: Running, from: number, ticks: number): Promise<ServedRecord> {
  return readServedRecord({
    baseUrl: running.base,
    assetId: ASSET,
    from,
    stopAfter: { ticks },
    signal: AbortSignal.timeout(480_000),
  });
}

async function storedCandles(running: Running, from: number, to: number): Promise<Candle[]> {
  const response = await fetch(
    `${running.base}/markets/${ASSET}/history?timeframe=1m&from=${String(from)}&to=${String(to)}`,
  );
  if (!response.ok)
    throw new Error(`history answered ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { candles: Candle[] }).candles;
}

describe('the served record, read from outside the process', () => {
  it('is the same for two observers, is what the venue stored, and continues across a kill', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-served-'));
    directories.push(stateDir);
    const first = await boot(stateDir, 34_401);
    const live = await waitForTicks(first, 3);
    expect(live.recovery?.kind).toBe('fresh');
    const from = live.sequence! + 1;

    // Two connections, opened together, asking for the same next sequence.
    const [a, b] = await Promise.all([
      read(first, from, SPAN_TICKS),
      read(first, from, SPAN_TICKS),
    ]);
    for (const record of [a, b]) {
      expect(record.endedBy).toBe('rule');
      expect(record.gaps).toEqual([]);
      expect(record.closes).toEqual([]);
      expect(record.discontinuities).toEqual([]);
      expect(record.ticks).toHaveLength(SPAN_TICKS);
      expect(record.ticks[0]!.sequence).toBe(from);
    }
    // INV-002: the same market, tick for tick, and the same dataset byte for byte.
    expect(a.ticks).toEqual(b.ticks);
    const dataset = a.dataset();
    const other = b.dataset();
    expect(Array.from(dataset.prices)).toEqual(Array.from(other.prices));
    expect(Array.from(dataset.instants)).toEqual(Array.from(other.instants));
    // INV-010: the record holds ticks and the public instrument, nothing else.
    expect(Object.keys(a.instrument).sort()).toEqual([
      'displayPrecision',
      'family',
      'id',
      'logQuantum',
      'referencePrice',
    ]);

    // INV-003: the candles an observer folds from the served ticks are the
    // candles the venue stored from the same stream. Only whole minutes — the
    // first and last candle of any read are partial by construction.
    await new Promise((resolve) => setTimeout(resolve, 7_000)); // a flush
    const minute = timeframe('1m').durationMs;
    const firstWhole = Math.ceil(dataset.firstInstant / minute) * minute;
    const lastWhole = Math.floor(dataset.lastInstant / minute) * minute;
    expect(lastWhole - firstWhole, 'at least one whole minute was read').toBeGreaterThanOrEqual(
      minute,
    );
    const stored = await storedCandles(first, firstWhole, lastWhole);
    const folded = dataset.candles('1m');
    expect(stored.length).toBeGreaterThanOrEqual(1);
    for (const candle of stored) {
      const own = folded.find((c) => c.openInstant === candle.openInstant);
      expect(own, `served record has candle at ${String(candle.openInstant)}`).toBeDefined();
      // The dataset numbers the ticks it holds from one (it keeps prices and
      // instants, not sequences), so the shape is compared on the fold and the
      // sequences against the wire's own: the stored candle's first and last
      // ticks must be the served ticks at those positions.
      const { firstSequence, lastSequence, ...shape } = candle;
      const { firstSequence: _f, lastSequence: _l, ...ownShape } = own!;
      expect(ownShape).toEqual(shape);
      const first = a.ticks.find((t) => t.sequence === firstSequence);
      const last = a.ticks.find((t) => t.sequence === lastSequence);
      expect(first?.price, `first tick of ${String(candle.openInstant)}`).toBe(candle.open);
      expect(last?.price, `last tick of ${String(candle.openInstant)}`).toBe(candle.close);
      expect(lastSequence - firstSequence + 1).toBe(candle.tickCount);
    }

    // INV-008: SIGKILL — no shutdown hook, no final checkpoint — and the record
    // continues from where the observer left it, with any seam declared.
    await new Promise((resolve) => setTimeout(resolve, 7_000)); // a checkpoint
    first.child.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const last = a.ticks[a.ticks.length - 1]!.sequence;
    const second = await boot(stateDir, first.port + 1);
    const resumed = await market(second);
    expect(resumed.recovery?.kind, second.output().slice(-1_500)).not.toBe('fresh');

    // What the observer held ends at `last`; what the venue serves after the
    // restart begins where it resumed. The first run of this test found the
    // two are not the same window (PH-25.1 §6): the shipped service persists
    // checkpoints and candles, not ticks, so its replay window is process-local
    // and a restart forgets everything published before the resume point. A
    // client holding an older sequence is refused as "evicted", and with
    // `onGap=live` it is told — which is the honest behaviour, and is asserted;
    // the ticks it cannot be given are still in the venue's candle record
    // (INV-009), and that is asserted too.
    let c: ServedRecord;
    try {
      c = await read(second, last + 1, RESUME_TICKS);
    } catch (error) {
      if (!(error instanceof ServedRecordError) || error.status !== 400) throw error;
      const start = /starts at (\d+)/.exec(error.body);
      expect(start, `a refusal that names the retained window: ${error.body}`).not.toBeNull();
      const windowStart = Number(start![1]);
      // Forgotten exactly up to its resume point, and nothing after it.
      expect(resumed.recovery?.kind).toBe('resumed');
      expect(windowStart).toBe((resumed.recovery as { fromSequence: number }).fromSequence + 1);
      expect(windowStart).toBeGreaterThan(last + 1);

      c = await readServedRecord({
        baseUrl: second.base,
        assetId: ASSET,
        from: last + 1,
        onGap: 'live',
        stopAfter: { ticks: RESUME_TICKS },
        signal: AbortSignal.timeout(480_000),
      });
      // Told the gap, then everything the venue still holds, from the start of
      // its window — and the frame names where it picks up.
      expect(c.gaps).toEqual([
        {
          requested: last + 1,
          reason: expect.stringMatching(/retained/) as string,
          resumesAt: windowStart,
          afterSequence: null,
        },
      ]);
      expect(c.ticks[0]!.sequence).toBe(windowStart);
      expect(c.discontinuities).toEqual([]);

      // The hole the stream cannot replay, against the record the venue
      // stored. The fourth run measured **zero** stored candles spanning it
      // (finding c, PH-25.1 §5): the minute the kill fell in was open in the
      // recorder and died with the process, and after the resume the recorder
      // sees that minute from inside and withholds it (CA6-30) — so a SIGKILL
      // costs the candle record the minute it happened in. Measured and
      // recorded rather than asserted away; what is asserted is that no stored
      // bar claims sequences it did not fold: the record may have a hole, and
      // must never paper over one.
      await new Promise((resolve) => setTimeout(resolve, 7_000)); // a flush
      const bars = await storedCandles(
        second,
        Math.floor(dataset.lastInstant / minute) * minute - minute,
        Math.ceil(c.ticks[0]!.instant / minute) * minute + minute,
      );
      const spanning = bars.filter(
        (bar) => bar.lastSequence >= last + 1 && bar.firstSequence <= windowStart - 1,
      );
      for (const bar of bars) {
        expect(bar.tickCount, `bar at ${String(bar.openInstant)}`).toBe(
          bar.lastSequence - bar.firstSequence + 1,
        );
      }
      console.log(
        `[PH-25.1] hole ${String(last + 1)}–${String(windowStart - 1)} after the kill: ` +
          `${String(spanning.length)} stored 1m candle(s) span it; ${String(bars.length)} bars read around it`,
      );
      expect(c.ticks).toHaveLength(RESUME_TICKS);
    }
    if (c.gaps.length === 0) {
      expect(c.ticks).toHaveLength(RESUME_TICKS);
      // Strictly continuing, across the boundary and after it.
      assertTickOrder(a.ticks[a.ticks.length - 1]!, c.ticks[0]!);
      if (resumed.recovery?.kind === 'seam') {
        // A seam is a jump the record declares; the observer holds it as one
        // discontinuity, starting where the venue says the record ended.
        expect(c.discontinuities).toHaveLength(1);
        expect(c.discontinuities[0]!.afterSequence).toBe(last);
        expect(resumed.recovery.fromSequence).toBeGreaterThanOrEqual(last);
      } else {
        expect(c.discontinuities, JSON.stringify(resumed.recovery)).toEqual([]);
        expect(c.ticks[0]!.sequence).toBe(last + 1);
      }
    }

    // ---- PH-25.2: the battery on what the wire carried ----------------------
    //
    // At the size a test can afford the battery cannot see a product-margin
    // edge, and the verdict must say so: `undecided` or `clean`, never
    // `exploitable`, with a floor per horizon it measured rather than assumed.
    // The occupancy floor is lowered as `standing.test.ts` lowers it, so that
    // a record this short tests anything at all; every other setting is the
    // one the venue would run with.
    const battery = { minimumBucketSamples: 25 } as const;
    const alone = await servedAssurance(a, { at: Date.now(), battery });
    // Honest about what this size can decide (CA9 a4-05): at 1,800 ticks no
    // bucket qualifies, zero hypotheses are tested, and the verdict is
    // `undecided` with its floors — never `clean`, and `not exploitable` here
    // would be vacuous. The assertion is the exact shape of that verdict.
    expect(alone.hypothesesTested).toBe(0);
    expect(alone.outcome).toBe('undecided');
    expect(alone.ticks).toBe(SPAN_TICKS);
    expect(alone.horizons.length).toBeGreaterThan(0);
    for (const horizon of alone.horizons) expect(horizon.detectionFloorPp).toBeGreaterThan(0);
    // No seam in a single uninterrupted read, and the verdict says which
    // family it therefore could not build rather than running it on nothing.
    expect(alone.withheldUnavailable).toContain('wh-seam-proximity');

    // Across the restart: the two reads joined as one record, the join's hole
    // — a told gap or a declared seam — reaching the battery as a seam index
    // read off the record itself, so the withheld seam family is built.
    const joined = joinServedRecords(a, c);
    expect(joined.ticks).toHaveLength(SPAN_TICKS + RESUME_TICKS);
    const seams = seamIndicesOf(joined);
    if (c.gaps.length > 0 || c.discontinuities.length > 0) {
      expect(seams).toEqual([SPAN_TICKS]);
    } else {
      expect(seams).toEqual([]);
    }
    const across = await servedAssurance(joined, { at: Date.now(), battery });
    expect(across.hypothesesTested).toBe(0);
    expect(across.outcome).toBe('undecided');
    expect(across.ticks).toBe(SPAN_TICKS + RESUME_TICKS);
    if (seams.length > 0) {
      expect(across.families).toContain('wh-seam-proximity');
      expect(across.withheldUnavailable).not.toContain('wh-seam-proximity');
    }
    console.log(
      `[PH-25.2] served record ${String(alone.ticks)} ticks: ${alone.outcome}, ` +
        `${String(alone.hypothesesTested)} hypotheses, floors ` +
        alone.horizons
          .map((h) => `${h.horizon} ${h.detectionFloorPp.toFixed(2)}pp/${String(h.samples)}`)
          .join(' ') +
        `; joined ${String(across.ticks)} ticks across the restart: ${across.outcome}, ` +
        `${String(across.hypothesesTested)} hypotheses, seams at ${JSON.stringify(seams)}, ` +
        `families ${String(across.families.length)}, unavailable ${JSON.stringify(across.withheldUnavailable)}`,
    );
  }, 900_000);

  it('a resume the venue cannot honour is a refusal, and with onGap=live it is told and kept', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-served-gap-'));
    directories.push(stateDir);
    const running = await boot(stateDir, 34_431);
    const live = await waitForTicks(running, 3);
    const beyond = live.sequence! + 100_000;

    await expect(
      readServedRecord({
        baseUrl: running.base,
        assetId: ASSET,
        from: beyond,
        stopAfter: { ticks: 1 },
      }),
    ).rejects.toMatchObject({ name: 'ServedRecordError', status: 400 });

    const told = await readServedRecord({
      baseUrl: running.base,
      assetId: ASSET,
      from: beyond,
      onGap: 'live',
      stopAfter: { ticks: 5 },
      signal: AbortSignal.timeout(60_000),
    });
    expect(told.gaps).toHaveLength(1);
    expect(told.gaps[0]!.requested).toBe(beyond);
    expect(told.gaps[0]!.afterSequence).toBeNull();
    expect(told.ticks).toHaveLength(5);
    // The hole is held as a gap, not counted as a jump and not filled.
    expect(told.discontinuities).toEqual([]);
    expect(told.ticks[0]!.sequence).toBeLessThan(beyond);
  }, 120_000);
});
