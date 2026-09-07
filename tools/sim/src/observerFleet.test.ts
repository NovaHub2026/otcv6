import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fleetRow, parseFleetArgs, renderFleet, type FleetRow } from './observerFleet.js';
import type { ObserverLoadReport } from './observerLoad.js';

/**
 * The driver that produced the release's observer evidence, watched failing.
 *
 * **Cycle Audit 10 (a8-03).** `observerFleet.ts` had no test of any kind: 0 of
 * 266 lines under the unit project, beneath a `tools/sim` floor of 35% that a
 * whole file at zero still satisfies. It is the file that decides whether ten
 * thousand observers held — the headline of `PH-30-TEN-THOUSAND-OBSERVERS.md` —
 * and it decided that from `established === size` alone, discarding the
 * `gapEvents` and `closeEvents` counters Cycle Audit 8 added one layer down.
 *
 * A venue that accepts every socket, delivers three ticks and then closes each
 * observer with `client fell behind` is the likeliest failure at that size, and
 * it rendered as `complete: yes`, `gaps 0`, with no column in the table that
 * could have said otherwise. So the truncated fleet is the first test here.
 */

/** A worker's report, healthy by default and broken by the overrides. */
function report(overrides: Partial<ObserverLoadReport> = {}): ObserverLoadReport {
  const attempted = overrides.attempted ?? 100;
  return {
    attempted,
    established: overrides.established ?? attempted,
    refused: [],
    ticksDelivered: 4_000,
    gaps: 0,
    duplicates: 0,
    gapEvents: 0,
    closeEvents: 0,
    latencyMs: { p50: 4, p90: 9, p99: 12, max: 40 },
    connectMs: { p50: 2, p90: 5, p99: 8, max: 20 },
    engineCpuSeconds: 9,
    harnessCpuSeconds: 3,
    wallSeconds: 25,
    windowSeconds: 20,
    ticksInWindow: 3_000,
    instrumentBound: false,
    complete: overrides.established === undefined || overrides.established === attempted,
    ...overrides,
  };
}

const NO_SAMPLE = { connections: null, subscribers: null, residentBytes: null };
const during = { connections: 1_250, subscribers: 10_000, residentBytes: 520_000_000 };
const after = { connections: 0, subscribers: 0, residentBytes: 300_000_000 };
const baseline = { connections: 0, subscribers: 0, residentBytes: 210_000_000 };

describe('a fleet the venue cut off is not a fleet that held (a8-03)', () => {
  it('is incomplete when the venue closed observers mid-hold, and the table says which', () => {
    // Five workers of a thousand: every socket accepted, every observer cut
    // off. Established is perfect, which is exactly why it is not the test.
    const truncated = [
      report({ attempted: 2_000, closeEvents: 2_000, complete: false }),
      report({ attempted: 2_000, closeEvents: 1_800, complete: false }),
      report({ attempted: 2_000 }),
      report({ attempted: 2_000 }),
      report({ attempted: 2_000 }),
    ];
    const row = fleetRow(10_000, truncated, during, after);

    expect(row.established, 'the venue accepted every socket').toBe(10_000);
    expect(row.closeEvents, 'the close frames never reached the row').toBe(3_800);
    expect(row.gapEvents).toBe(0);
    expect(
      row.complete,
      'ten thousand observers cut off mid-hold rendered as a complete fleet',
    ).toBe(false);

    const table = renderFleet([row], baseline, 'abc1234', '16 cores, 32.0 GB');
    // The counters are columns, not only fields: a table that carries the
    // number nowhere is the state this finding was raised about.
    expect(table, 'the header has no column for a truncated delivery').toContain('| closed |');
    expect(table).toContain('| gap frames |');
    expect(table).toMatch(/\| 3800 \|/);
    expect(table, 'the row still reads complete').not.toMatch(/\| yes \|\s*$/m);
    expect(table).toContain('truncated: the venue told 0 gaps and cut 3800 observers off');
  });

  it("does not take a worker's word for it over the worker's own counters", () => {
    // This is the pre-Cycle-Audit-8 worker report, exactly: `complete: true`
    // because every observer was established, beside a close count that says
    // every one of them was cut off. The driver believed the boolean. Both
    // layers now judge the same way, and this is the one that survives a
    // regression in the other.
    const row = fleetRow(
      4_000,
      [
        report({ attempted: 2_000, closeEvents: 2_000, complete: true }),
        report({ attempted: 2_000, gapEvents: 40, complete: true }),
      ],
      during,
      after,
    );
    expect(row.established).toBe(4_000);
    expect(row.complete, 'the driver read the boolean and ignored the counters underneath it').toBe(
      false,
    );
    expect(row.closeEvents).toBe(2_000);
    expect(row.gapEvents).toBe(40);
  });

  it('is incomplete when the venue told a gap, even with nothing closed', () => {
    const row = fleetRow(
      2_000,
      [report({ attempted: 2_000, gapEvents: 7, complete: false })],
      during,
      after,
    );
    expect(row.gapEvents).toBe(7);
    expect(row.complete).toBe(false);
    expect(renderFleet([row], baseline, 'abc1234', 'm')).toContain(
      'truncated: the venue told 7 gaps and cut 0 observers off',
    );
  });

  it('is complete, and says so, when every observer was established and held', () => {
    const row = fleetRow(
      4_000,
      [report({ attempted: 2_000 }), report({ attempted: 2_000 })],
      during,
      after,
    );
    expect(row.complete).toBe(true);
    expect(row.gapEvents).toBe(0);
    expect(row.closeEvents).toBe(0);
    const table = renderFleet([row], baseline, 'abc1234', 'm');
    expect(table).toMatch(/\| yes \|/);
    expect(table).not.toContain('truncated');
  });

  it('carries a worker that outworked the engine into the row, and marks it', () => {
    // `instrumentBound` was `false` in every fleet row ever produced, because
    // the driver never passed the engine's pid to a worker. Carrying the flag
    // is half the fix; the other half is `worker()` passing the pid.
    const row = fleetRow(
      2_000,
      [report({ attempted: 1_000, instrumentBound: true }), report({ attempted: 1_000 })],
      during,
      after,
    );
    expect(row.instrumentBound, 'the harness outworked the engine and the row hid it').toBe(true);
    expect(renderFleet([row], baseline, 'abc1234', 'm')).toContain('| **yes** |');
  });

  it('still names a refusal, and both reasons when a fleet fails in both ways', () => {
    const row = fleetRow(
      2_000,
      [
        report({
          attempted: 1_000,
          established: 700,
          refused: [{ reason: '503 from the venue', count: 300 }],
          complete: false,
        }),
        report({ attempted: 1_000, closeEvents: 12, complete: false }),
      ],
      during,
      after,
    );
    expect(row.established).toBe(1_700);
    expect(row.complete).toBe(false);
    const table = renderFleet([row], baseline, 'abc1234', 'm');
    expect(table).toContain('300 never established (300 × 503 from the venue)');
    expect(table).toContain('truncated: the venue told 0 gaps and cut 12 observers off');
  });

  it('adds a missing sample up without inventing one', () => {
    const row = fleetRow(1_000, [report({ attempted: 1_000 })], NO_SAMPLE, NO_SAMPLE);
    const table = renderFleet([row], NO_SAMPLE, 'abc1234', 'm');
    expect(table).toContain('| — | — | — |');
  });
});

describe('the fleet driver reads its arguments (a8-03)', () => {
  it('defaults to the four sizes the evidence was produced at', () => {
    const options = parseFleetArgs([]);
    expect(options.sizes).toEqual([1_000, 2_500, 5_000, 10_000]);
    expect(options.workers).toBe(8);
    expect(options.holdMs).toBe(20_000);
    expect(options.perConnection).toBe(8);
    expect(options.arrivalMs).toBe(2);
    expect(options.out).toBeNull();
  });

  it('reads every flag, and the sizes in the order given', () => {
    const options = parseFleetArgs([
      '--sizes',
      '10, 20,30',
      '--workers',
      '4',
      '--hold',
      '500',
      '--per-connection',
      '2',
      '--arrival',
      '7',
      '--out',
      'report.md',
    ]);
    expect(options.sizes).toEqual([10, 20, 30]);
    expect(options.workers).toBe(4);
    expect(options.holdMs).toBe(500);
    expect(options.perConnection).toBe(2);
    expect(options.arrivalMs).toBe(7);
    expect(options.out).toBe('report.md');
  });

  it('refuses what it cannot run rather than running something else', () => {
    expect(() => parseFleetArgs(['--sizes'])).toThrow(RangeError);
    expect(() => parseFleetArgs(['--nope', '1'])).toThrow(/Unknown option/);
    expect(() => parseFleetArgs(['--sizes', 'abc'])).toThrow(/at least one size/);
    expect(() => parseFleetArgs(['--workers', '0'])).toThrow(/positive integer/);
    expect(() => parseFleetArgs(['--hold', '1.5'])).toThrow(/positive integer/);
  });
});

describe('the table a reader will be handed', () => {
  it('names the commit, the machine and the venue at rest', () => {
    const rows: FleetRow[] = [fleetRow(1_000, [report({ attempted: 1_000 })], during, after)];
    const table = renderFleet(rows, baseline, 'deadbee', '16 cores, 31.2 GB');
    expect(table).toContain('Commit: `deadbee`');
    expect(table).toContain('Machine: 16 cores, 31.2 GB');
    expect(table).toContain('Venue at rest: RSS 200 MB, 0 connections');
    // Every header cell has a row cell under it, or the table is misaligned in
    // a way a reader will silently misread.
    const lines = table.split('\n').filter((l) => l.startsWith('|'));
    const widths = lines.map((l) => l.split('|').length);
    expect(new Set(widths).size, `ragged table: ${widths.join(',')}`).toBe(1);
  });
});

/**
 * The wiring between the driver and its workers, read as text.
 *
 * `observerFleetWorker.ts` runs `main()` at import, so no unit test can call
 * it; what is under test is which arguments cross the `spawn` boundary, and
 * `operations.test.ts` reads `main.ts` as text for the same reason. The
 * quantity at stake is `instrumentBound`: the driver passed six arguments and
 * no pid, so the flag that says "this harness outworked the engine, its
 * latency is its own scheduling" was false by construction in every fleet row
 * ever published, including the ten-thousand table (a8-03).
 */
describe('the driver tells its workers which process the engine is (a8-03)', () => {
  const read = (name: string): string =>
    readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), name), 'utf8');

  it('passes the engine pid to every worker it spawns', () => {
    const driver = read('observerFleet.ts');
    const spawnCall = /const child = spawn\(([\s\S]*?)\n {6}\);/.exec(driver);
    expect(spawnCall, 'the driver no longer spawns a worker').not.toBeNull();
    expect(
      spawnCall![1],
      'the worker is spawned without an engine pid: instrumentBound can never be true',
    ).toContain('enginePid');
    expect(driver, 'the pid the driver has is not the one it passes').toMatch(
      /worker\([\s\S]{0,240}engine\.pid/,
    );
  });

  it('is read by the worker as the seventh argument', () => {
    const worker = read('observerFleetWorker.ts');
    expect(worker).toMatch(
      /const \[baseUrl, assets, observers, holdMs, perConnection, arrival, enginePid\]/,
    );
    expect(worker, 'the worker reads the pid and does not hand it to the harness').toContain(
      'enginePid: Number(enginePid)',
    );
  });
});
