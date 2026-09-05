import type { ServedRecord, StandingVerdict } from '@otc/lab';

/**
 * PH-25.3 — the pure half of the served-assurance job.
 *
 * Everything here is a function of its arguments: the options a run is given,
 * the retained window read off a venue's refusal, and the Markdown the run
 * writes. The half that touches a socket and a clock is `servedAssurance.ts`.
 */

export interface Options {
  readonly base: string;
  readonly assets: readonly string[] | null;
  readonly out: string | null;
  /** The most ticks to read per asset; the venue's window may be smaller. */
  readonly maxTicks: number;
  readonly label: string;
}

export function parse(argv: readonly string[]): Options {
  let base: string | null = null;
  let assets: string[] | null = null;
  let out: string | null = null;
  let maxTicks = 50_000;
  let label = 'served-assurance';
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--base':
        base = value ?? null;
        i += 1;
        break;
      case '--assets':
        assets = (value ?? '').split(',').filter((a) => a.length > 0);
        i += 1;
        break;
      case '--out':
        out = value ?? null;
        i += 1;
        break;
      case '--max-ticks':
        maxTicks = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--label':
        label = value ?? label;
        i += 1;
        break;
      default:
        throw new Error(`Unknown option ${String(flag)}`);
    }
  }
  if (base === null || !/^https?:\/\/[^/]+$/.test(base)) {
    throw new Error('--base http://host:port is required, without a path or a trailing slash.');
  }
  if (!Number.isInteger(maxTicks) || maxTicks < 2) {
    throw new Error(`--max-ticks must be an integer of at least 2, received ${String(maxTicks)}.`);
  }
  return { base, assets, out, maxTicks, label };
}

/**
 * The oldest sequence a venue still serves, read off its own refusal.
 *
 * `EvictedError`'s message names the window start; nothing else on the public
 * surface does, and guessing would be reading a record the venue did not serve.
 */
export function retainedWindowStart(refusalBody: string): number | null {
  const match = /starts at (\d+)/.exec(refusalBody);
  return match === null ? null : Number(match[1]);
}

/** Where to start reading so that at most `maxTicks` are asked for. */
export function startFor(newest: number, maxTicks: number): number {
  return Math.max(1, newest - maxTicks + 1);
}

export interface AssetRun {
  readonly assetId: string;
  readonly record: Pick<ServedRecord, 'ticks' | 'gaps' | 'discontinuities' | 'bytes'> | null;
  readonly verdict: StandingVerdict | null;
  readonly failure: string | null;
  readonly seconds: number;
}

function pct(value: number): string {
  return `${value.toFixed(3)}pp`;
}

export function verdictRow(run: AssetRun): string {
  if (run.verdict === null || run.record === null) {
    return `| ${run.assetId} | — | — | **failed** | ${run.failure ?? 'unknown'} | — | — | ${run.seconds.toFixed(0)}s |`;
  }
  const v = run.verdict;
  const floors = v.horizons
    .map((h) => `${h.horizon} ${pct(h.detectionFloorPp)} (${String(h.samples)})`)
    .join(', ');
  const outcome = v.outcome === 'exploitable' ? `**${v.outcome}**` : v.outcome;
  const covered = (v.coveredMs / 3_600_000).toFixed(2);
  return `| ${run.assetId} | ${String(v.ticks)} | ${covered} h | ${outcome} | ${String(v.hypothesesTested)} / ${String(v.families.length)} / ${String(v.withheldUnavailable.length)} | ${floors} | ${v.worstZ === null ? '—' : v.worstZ.toFixed(2)} | ${run.seconds.toFixed(0)}s |`;
}

export interface ReportMeta {
  readonly label: string;
  readonly base: string;
  readonly at: string;
  readonly maxTicks: number;
}

export function report(meta: ReportMeta, runs: readonly AssetRun[]): string {
  const exploitable = runs.filter((r) => r.verdict?.outcome === 'exploitable').length;
  const failed = runs.filter((r) => r.verdict === null).length;
  const lines = [
    `# Served-record assurance — ${meta.label}`,
    '',
    'Type: EVIDENCE (generated; do not edit by hand)',
    `Venue: \`${meta.base}\``,
    `Run at: ${meta.at}`,
    `Read per asset: up to ${String(meta.maxTicks)} ticks, the venue’s retained window if smaller`,
    `Assets: ${String(runs.length)} — ${String(exploitable)} exploitable, ${String(failed)} failed`,
    '',
    'Every number below came over `GET /markets/:id/stream` from the venue named',
    'above; nothing was generated in this process. `undecided` means the battery',
    'could not see a product-margin edge at this size, and the floors say how',
    'far from seeing one it was (samples in parentheses).',
    '',
    '| Asset | Ticks | Covered | Outcome | Hypotheses / families / withheld-unavailable | Detection floor per horizon | Worst z | Time |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...runs.map(verdictRow),
    '',
  ];
  const notes = runs.flatMap((r) => (r.verdict?.notes ?? []).map((n) => `- ${r.assetId}: ${n}`));
  if (notes.length > 0) lines.push('## Notes from the battery', '', ...notes, '');
  const holes = runs.filter(
    (r) => r.record !== null && (r.record.gaps.length > 0 || r.record.discontinuities.length > 0),
  );
  if (holes.length > 0) {
    lines.push('## Holes in what was served', '');
    for (const r of holes) {
      lines.push(
        `- ${r.assetId}: ${String(r.record!.gaps.length)} told gap(s), ${String(r.record!.discontinuities.length)} discontinuit(ies) — handed to the battery as seams`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
