import { existsSync } from 'node:fs';
import path from 'node:path';
import { epochMillis } from '@otc/core';

/** The largest instant the kernel accepts, as an upper read bound. */
const MAX_INSTANT = epochMillis(8_640_000_000_000_000);
import { ASSET_CATALOGUE, LATTICE_BEFORE_PH37 } from '@otc/engine';
import {
  dateCandlesAgainstRecord,
  epochsOf,
  HISTORY_DB,
  proposeBackfill,
  proposeDeclaration,
  RECORD_DB,
  SqliteCandleHistory,
  SqliteTickRecord,
  type FrameProposal,
  type FrameVerdict,
  type PriceFrame,
} from '@otc/runtime';

/**
 * The operator's tool for the record's frame log (PH-38.2).
 *
 *   npm run state:lattice -- list    --dir ./.otc-state
 *   npm run state:lattice -- check   --dir ./.otc-state --from-release v2.4.0
 *   npm run state:lattice -- declare --dir ./.otc-state --from-release v2.4.0
 *
 * PH-38.1 made a frame recordable and left the past alone on purpose, because
 * a migration at open time has no catalogue, no operator and no way to check
 * itself. This is the deliberate act that reaches backwards, on the Human
 * Owner's instruction of 2026-09-24 (`DECISION-LOG.md`).
 *
 * **`check` is not a dry run bolted on afterwards; it is the point.** It finds
 * each boundary, prints the continuity gap and what the last pre-boundary tick
 * renders as before and after, and writes nothing. `declare` writes what
 * `check` printed and nothing else, so no operator's first sight of these
 * numbers is after they are durable.
 *
 * Everything is per asset. A refusal for one never stops the others, and
 * nothing is written for a refused one.
 */

/** The frame table a release published on. Only v2.4.0's predecessor exists. */
const RELEASES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'v2.4.0': LATTICE_BEFORE_PH37,
};

export interface LatticeToolOptions {
  readonly command: 'list' | 'check' | 'declare';
  readonly dir: string;
  readonly fromRelease?: string;
  readonly asset?: string;
  readonly replace: boolean;
  /** Which store to act on: the tick record (default) or the candle history. */
  readonly store: 'tick' | 'candle';
}

export function parseLatticeToolArgs(argv: readonly string[]): LatticeToolOptions {
  const [command, ...rest] = argv;
  if (command !== 'list' && command !== 'check' && command !== 'declare') {
    throw new RangeError(
      'Usage: lattice-tool (list|check|declare) --dir <state dir> ' +
        '[--from-release <tag>] [--asset <id>] [--replace]',
    );
  }
  let dir: string | undefined;
  let fromRelease: string | undefined;
  let asset: string | undefined;
  let replace = false;
  let store: 'tick' | 'candle' = 'tick';
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--replace') {
      replace = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined) throw new RangeError(`${String(flag)} needs a value.`);
    i += 1;
    if (flag === '--dir') dir = value;
    else if (flag === '--from-release') fromRelease = value;
    else if (flag === '--asset') asset = value;
    else if (flag === '--store') {
      if (value !== 'tick' && value !== 'candle') {
        throw new RangeError(`--store is tick or candle, received ${value}.`);
      }
      store = value;
    } else throw new RangeError(`Unknown option ${String(flag)}.`);
  }
  if (dir === undefined) throw new RangeError('--dir is required.');
  if (command !== 'list' && fromRelease === undefined) {
    throw new RangeError(
      `${command} needs --from-release (one of: ${Object.keys(RELEASES).join(', ')}).`,
    );
  }
  if (fromRelease !== undefined && RELEASES[fromRelease] === undefined) {
    throw new RangeError(
      `No frame table is recorded for release ${fromRelease}. Known: ${Object.keys(RELEASES).join(', ')}.`,
    );
  }
  return {
    command,
    dir,
    ...(fromRelease === undefined ? {} : { fromRelease }),
    ...(asset === undefined ? {} : { asset }),
    replace,
    store,
  };
}

/** The frame an asset is on now, from the compiled catalogue. */
function currentFrame(assetId: string): PriceFrame | null {
  const asset = ASSET_CATALOGUE.find((one) => one.definition.id === assetId);
  if (asset === undefined) return null;
  const { logQuantum, referencePrice, displayPrecision } = asset.instrument;
  return { logQuantum, referencePrice, displayPrecision };
}

function describeProposal(p: FrameProposal): string {
  return (
    `  ${p.assetId.padEnd(15)} boundary ${String(p.boundarySequence).padStart(9)}  ` +
    `gap ${p.gapPercent.toFixed(4).padStart(8)}%  ` +
    `covers ${String(p.ticksCovered).padStart(7)} ticks  ` +
    `${p.renderedToday.toFixed(p.after.displayPrecision)} → ` +
    `${p.published.toFixed(p.before.displayPrecision)}`
  );
}

function describeVerdicts(verdicts: readonly FrameVerdict[], wrote: boolean): string {
  const ok = verdicts.filter((v) => v.ok);
  const refused = verdicts.filter((v) => !v.ok);
  const lines: string[] = [];
  if (ok.length > 0) {
    lines.push(
      wrote
        ? `Declared ${String(ok.length)} asset(s) — rendered today → as published:`
        : `${String(ok.length)} asset(s) can be declared — rendered today → as published:`,
    );
    for (const v of ok) if (v.ok) lines.push(describeProposal(v.proposal));
  }
  if (refused.length > 0) {
    lines.push(`Refused ${String(refused.length)} asset(s), and nothing was written for them:`);
    for (const v of refused) if (!v.ok) lines.push(`  ${v.assetId}: ${v.refusal}`);
  }
  if (lines.length === 0) lines.push('No assets in the record.');
  return lines.join('\n');
}

/** Run the tool; returns the exit code and what it printed. */
export async function runLatticeTool(
  argv: readonly string[],
): Promise<{ code: number; output: string }> {
  let options: LatticeToolOptions;
  try {
    options = parseLatticeToolArgs(argv);
  } catch (error) {
    return { code: 2, output: (error as Error).message };
  }
  if (!existsSync(options.dir)) return { code: 1, output: `No state directory at ${options.dir}.` };
  const file = path.join(options.dir, RECORD_DB);
  if (!existsSync(file)) return { code: 1, output: `No record at ${file}.` };

  // `list` and `check` never write, and that includes never upgrading the file:
  // a v2.4.0 service holding this record would refuse a version-3 file on its
  // next restart, so an inspection that stamps the version bricks the next boot.
  const record = new SqliteTickRecord(file, { readOnly: options.command !== 'declare' });
  try {
    // ---- the candle store, dated against the record it was folded from -----
    if (options.store === 'candle') {
      const historyFile = path.join(options.dir, HISTORY_DB);
      if (!existsSync(historyFile))
        return { code: 1, output: `No candle history at ${historyFile}.` };
      const history = new SqliteCandleHistory(historyFile, {
        readOnly: options.command !== 'declare',
      });
      try {
        const lines: string[] = [`Candle history: ${historyFile}`];
        if (options.command !== 'declare') lines.push('Nothing is written by check.');
        let any = false;
        for (const id of (await record.assets()).filter(
          (a) => options.asset === undefined || a === options.asset,
        )) {
          const current = currentFrame(id);
          if (current === null) {
            lines.push(`  ${id.padEnd(15)} not in this build's catalogue; skipped`);
            continue;
          }
          const table =
            options.fromRelease === undefined ? undefined : RELEASES[options.fromRelease];
          const older = table?.[id];
          const candidates = [
            current,
            ...(older === undefined ? [] : [{ ...current, logQuantum: older }]),
          ];
          // The whole stored series, bounded by the largest instant the kernel
          // accepts rather than by a clock: this file is scanned for ambient
          // time, and an operator tool has no business reading one.
          const bars = await history.read(id, '1m', epochMillis(0), MAX_INSTANT);
          if (bars.length === 0) {
            lines.push(`  ${id.padEnd(15)} no stored bars`);
            continue;
          }
          const { epochs, dated, undatable } = await dateCandlesAgainstRecord(
            record,
            id,
            bars,
            candidates,
          );
          const held = await history.frames(id);
          lines.push(
            `  ${id.padEnd(15)} ${String(bars.length).padStart(7)} bars  dated ${String(dated).padStart(7)}  ` +
              `undatable ${String(undatable).padStart(7)}  epochs ${String(epochs.length)}` +
              (held.length > 0 ? `  (holds ${String(held.length)})` : ''),
          );
          if (options.command === 'declare' && epochs.length > 0) {
            await history.declareFrames(id, epochs, true);
            any = true;
          }
        }
        if (options.command === 'declare') {
          lines.push(any ? 'Declared.' : 'Nothing was declared.');
        }
        return { code: 0, output: lines.join('\n') };
      } finally {
        history.close();
      }
    }
    const assets = (await record.assets()).filter(
      (id) => options.asset === undefined || id === options.asset,
    );
    if (options.asset !== undefined && assets.length === 0) {
      return { code: 1, output: `${options.asset} has no ticks in this record.` };
    }

    if (options.command === 'list') {
      const lines: string[] = [`Record: ${file}`];
      for (const id of assets) {
        const frames = await record.frames(id);
        const oldest = await record.oldest(id);
        if (frames.length === 0) {
          lines.push(`  ${id.padEnd(15)} UNDECLARED from ${String(oldest ?? 0)}`);
          continue;
        }
        // An undeclared head is the range below the first epoch: ticks the
        // record holds and still cannot explain.
        const undeclared =
          oldest !== null && oldest < frames[0]!.fromSequence
            ? `  (+ UNDECLARED ${String(oldest)}..${String(frames[0]!.fromSequence - 1)})`
            : '';
        lines.push(
          `  ${id.padEnd(15)} ${frames
            .map((f) => `${String(f.fromSequence)}@${f.logQuantum.toExponential(6)}`)
            .join('  ')}${undeclared}`,
        );
      }
      return { code: 0, output: lines.join('\n') };
    }

    const table = RELEASES[options.fromRelease!]!;
    const verdicts: FrameVerdict[] = [];
    for (const id of assets) {
      const after = currentFrame(id);
      if (after === null) {
        verdicts.push({
          assetId: id,
          ok: false,
          refusal:
            `${id} is not in this build's catalogue, so the frame it is on now is not known ` +
            `either. Nothing is declared for it.`,
        });
        continue;
      }
      const quantum = table[id];
      const before: PriceFrame | null =
        quantum === undefined ? null : { ...after, logQuantum: quantum };
      const verdict = await proposeDeclaration(record, id, before, after);
      if (verdict.ok && options.command === 'declare') {
        const existing = await record.frames(id);
        if (existing.length > 0 && !options.replace) {
          verdicts.push({
            assetId: id,
            ok: false,
            refusal: `${id} already has ${String(existing.length)} declared frame(s); pass --replace to mean it.`,
          });
          continue;
        }
        await record.declareLattice(id, epochsOf(verdict.proposal), options.replace);
      }
      verdicts.push(verdict);
    }
    // **Second pass: the assets whose window has already moved past the
    // change.** They have no boundary to find, so the first pass refuses them
    // and their whole range would render as `null` — worse than before the
    // phase, because it used to answer a number that happened to be right. The
    // instant the release moved the lattices is read off the assets that
    // *could* be dated, so this is the venue's own evidence rather than a
    // default, and an asset holding anything from before that instant is still
    // refused.
    //
    // Read from **the record** as well as from this run, and that distinction
    // is not cosmetic: on a second run the assets that could be dated are
    // already declared, so nothing succeeds in the first pass and a change
    // instant taken only from this run's proposals would be zero. `check` and
    // `declare` then disagreed — check saw thirty declarable and declare saw
    // none — which is the shape of a tool that is not idempotent.
    // Over **every** asset in the record, not the filtered set: the instant a
    // release moved the lattices is a fact about the venue, so `--asset X`
    // narrowing the scan to X left it unknowable and silently skipped the
    // second pass for the one asset the operator asked about.
    const fromRecord: number[] = [];
    for (const id of await record.assets()) {
      const held = await record.frames(id);
      // An asset with two frames carries the change itself: the second one
      // begins at it.
      if (held.length >= 2) fromRecord.push(held[1]!.fromInstant);
    }
    const changeInstant = Math.max(
      ...verdicts.filter((v) => v.ok).map((v) => (v.ok ? v.proposal.boundaryInstant : 0)),
      ...fromRecord,
      0,
    );
    if (changeInstant > 0) {
      for (let i = 0; i < verdicts.length; i += 1) {
        const verdict = verdicts[i]!;
        if (verdict.ok) continue;
        const backfill = await proposeBackfill(record, verdict.assetId, changeInstant);
        if (!backfill.ok) continue;
        if (options.command === 'declare') {
          const held = await record.frames(verdict.assetId);
          const extended = [
            {
              ...held[0]!,
              fromSequence: backfill.proposal.oldestSequence,
              fromInstant: backfill.proposal.oldestInstant,
            },
            ...held,
          ];
          await record.declareLattice(verdict.assetId, extended, true);
        }
        verdicts[i] = backfill;
      }
    }

    const wrote = options.command === 'declare';
    const anyRefused = verdicts.some((v) => !v.ok);
    const header =
      `Record: ${file}\nRelease: ${options.fromRelease!}` +
      (wrote ? '' : '\nNothing is written by check.');
    return {
      // A refusal is information, not a crash: the expected steady state once
      // the window advances past every boundary is that every asset is refused
      // because there is nothing left to declare. Exit 1 only when the operator
      // asked for one asset and that asset was refused.
      code: options.asset !== undefined && anyRefused ? 1 : 0,
      output: `${header}\n${describeVerdicts(verdicts, wrote)}`,
    };
  } finally {
    record.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined && /latticeTool\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  void runLatticeTool(process.argv.slice(2)).then(({ code, output }) => {
    process.stdout.write(`${output}\n`);
    process.exit(code);
  });
}
