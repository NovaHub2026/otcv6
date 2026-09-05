#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  readServedRecord,
  servedAssurance,
  ServedRecordError,
  yieldToLoop,
  type ServedRecord,
} from '@otc/lab';
import {
  parse,
  report,
  retainedWindowStart,
  startFor,
  type AssetRun,
} from './servedAssuranceRun.js';

/**
 * PH-25.3 — the standing verdict on a running venue's served record.
 *
 * A deliberate act, not a test: point it at a venue, and it reads the longest
 * record the venue still serves for each asset, runs the battery on it, and
 * writes one Markdown record. An `exploitable` verdict is a non-zero exit, so
 * a scheduler sees it.
 *
 * Usage:
 *   node tools/sim/dist/servedAssuranceJob.js --base http://host:port
 *        [--assets a,b] [--out FILE] [--max-ticks N] [--label NAME]
 *
 * The clock is read here for the verdict's stamp and the run's duration, and
 * for nothing that generates (the guardrail scan's ambient-time allowlist).
 */

interface CatalogueRow {
  readonly id: string;
  readonly live: boolean;
  readonly retired: boolean;
}

interface MarketView {
  readonly sequence: number | null;
}

async function liveAssets(base: string, chosen: readonly string[] | null): Promise<string[]> {
  const response = await fetch(`${base}/catalogue`);
  if (!response.ok) throw new Error(`GET ${base}/catalogue answered ${String(response.status)}`);
  const rows = (await response.json()) as readonly CatalogueRow[];
  const live = rows.filter((row) => row.live && !row.retired).map((row) => row.id);
  if (chosen === null) return live;
  for (const id of chosen) {
    if (!live.includes(id)) throw new Error(`${id} is not a live asset of ${base}`);
  }
  return [...chosen];
}

async function newestSequence(base: string, assetId: string): Promise<number> {
  const response = await fetch(`${base}/markets/${encodeURIComponent(assetId)}`);
  if (!response.ok) throw new Error(`GET /markets/${assetId} answered ${String(response.status)}`);
  const view = (await response.json()) as MarketView;
  if (view.sequence === null) throw new Error(`${assetId} has published nothing`);
  return view.sequence;
}

/**
 * The longest record the venue still serves, ending at its newest sequence.
 *
 * Asks for `maxTicks`; when the venue refuses because its window is shorter,
 * the refusal names where the window starts and the read is repeated from
 * there. Nothing is guessed: a venue that refuses without naming its window
 * is a failure, not a shorter record.
 */
async function longestRecord(
  base: string,
  assetId: string,
  maxTicks: number,
): Promise<ServedRecord> {
  const newest = await newestSequence(base, assetId);
  let from = startFor(newest, maxTicks);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const record = await readServedRecord({
        baseUrl: base,
        assetId,
        from,
        stopAfter: { sequence: newest },
        signal: AbortSignal.timeout(300_000),
      });
      // The whole window, or nothing (Cycle Audit 9, a1-02/a4-01/a8-03): a read
      // the venue closed — its 1 MB replay cap says "fell behind" — or that the
      // timeout cut, or that ended short, is not the retained window, and a
      // verdict recorded on it would say "the venue's record" of a fragment.
      const expected = newest - from + 1;
      if (
        record.endedBy !== 'rule' ||
        record.closes.length > 0 ||
        record.ticks.length !== expected
      ) {
        throw new Error(
          `${assetId}: the read ended by ${record.endedBy}` +
            (record.closes.length > 0
              ? ` (close: ${record.closes.map((c) => c.reason).join('; ')})`
              : '') +
            ` with ${String(record.ticks.length)} of the ${String(expected)} ticks asked for ` +
            `(${String(from)}–${String(newest)}); a verdict is not recorded on a fragment.`,
        );
      }
      return record;
    } catch (error) {
      if (!(error instanceof ServedRecordError) || error.status !== 400 || attempt === 1)
        throw error;
      const start = retainedWindowStart(error.body);
      if (start === null || start <= from) throw error;
      from = start;
    }
  }
  throw new Error('unreachable');
}

/** What the venue says it is: its health, and whether it is the Lab composition. */
async function describeVenue(
  base: string,
): Promise<{ bootNonce: string | null; assets: number | null; labComposition: boolean }> {
  let bootNonce: string | null = null;
  let assets: number | null = null;
  try {
    const health = (await (await fetch(`${base}/health`)).json()) as {
      bootNonce?: unknown;
      assets?: unknown;
    };
    bootNonce = typeof health.bootNonce === 'string' ? health.bootNonce : null;
    assets = typeof health.assets === 'number' ? health.assets : null;
  } catch {
    /* a venue without /health is described as such */
  }
  let labComposition = false;
  try {
    labComposition = (await fetch(`${base}/lab/markets`)).status === 200;
  } catch {
    /* unreachable reads as absent */
  }
  return { bootNonce, assets, labComposition };
}

/** The commit this job was built from, or 'unknown' outside a checkout. */
function jobCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function digestOf(record: ServedRecord): { first: number; last: number; sha256: string } | null {
  const first = record.ticks[0];
  const last = record.ticks[record.ticks.length - 1];
  if (first === undefined || last === undefined) return null;
  const hash = createHash('sha256');
  for (const tick of record.ticks)
    hash.update(`${String(tick.sequence)}:${String(tick.instant)}:${String(tick.price)}\n`);
  return { first: first.sequence, last: last.sequence, sha256: hash.digest('hex') };
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));
  const startedAt = Date.now();
  const venue = await describeVenue(options.base);
  const assets = await liveAssets(options.base, options.assets);
  const runs: AssetRun[] = [];
  // The cross-asset family needs a second series; each asset is given the
  // previous asset's served record, so every asset after the first runs the
  // full withheld set. The first is named as withheld-unavailable, honestly.
  let reference: ServedRecord | undefined;
  for (const assetId of assets) {
    const began = Date.now();
    try {
      const record = await longestRecord(options.base, assetId, options.maxTicks);
      await yieldToLoop();
      const verdict = await servedAssurance(record, {
        at: Date.now(),
        ...(reference === undefined ? {} : { reference }),
      });
      reference = record;
      runs.push({
        assetId,
        record,
        range: digestOf(record),
        verdict,
        failure: null,
        seconds: (Date.now() - began) / 1_000,
      });
      process.stderr.write(
        `${assetId}: ${String(record.ticks.length)} ticks, ${verdict.outcome}, ` +
          `${String(verdict.hypothesesTested)} hypotheses, ${((Date.now() - began) / 1_000).toFixed(0)}s\n`,
      );
    } catch (error) {
      runs.push({
        assetId,
        record: null,
        range: null,
        verdict: null,
        failure: error instanceof Error ? error.message : String(error),
        seconds: (Date.now() - began) / 1_000,
      });
      process.stderr.write(
        `${assetId}: FAILED — ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  const text = report(
    {
      label: options.label,
      base: options.base,
      at: new Date(startedAt).toISOString(),
      maxTicks: options.maxTicks,
      venue,
      jobCommit: jobCommit(),
    },
    runs,
  );
  if (options.out === null) process.stdout.write(text);
  else writeFileSync(options.out, text);
  const exploitable = runs.filter((run) => run.verdict?.outcome === 'exploitable').length;
  const failed = runs.filter((run) => run.verdict === null).length;
  return exploitable > 0 ? 2 : failed > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
