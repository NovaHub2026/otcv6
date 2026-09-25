import { runBatteryAsync, type BatteryOptions, type Verdict } from './attacks/battery.js';
import { formatVerdict } from './attacks/battery.js';
import type { ObserverDataset } from './observer.js';
import {
  assessRealismAsync,
  formatRealismReport,
  type RealismOptions,
  type RealismReport,
} from './realism.js';

/**
 * Both halves of the product question, in one artefact.
 *
 * Neither battery means anything alone. A market that never moves passes every
 * attack; a market with rich structure and a tradeable drift passes realism. The
 * engine is acceptable only when it is simultaneously unexploitable and
 * plausible, which is the whole difficulty of the project stated as a
 * conjunction.
 */
export interface ValidationReport {
  readonly instrument: string;
  readonly ticks: number;
  readonly simulatedDays: number;
  readonly predictability: Verdict;
  readonly realism: RealismReport;
  /** Clean under attack AND plausible as a market. Both required. */
  readonly acceptable: boolean;
  readonly elapsedSeconds: number;
}

export interface ValidationOptions {
  readonly battery?: BatteryOptions;
  readonly realism?: RealismOptions;
}

export async function runValidation(
  dataset: ObserverDataset,
  options: ValidationOptions = {},
): Promise<ValidationReport> {
  const started = process.hrtime.bigint();
  const predictability = await runBatteryAsync(dataset, options.battery);
  // **The async realism pass, not the synchronous one (PH-38.3).** The battery
  // yields while it runs and then this call did not, so every validation ended
  // with one unbroken stretch of realism metrics over the whole dataset while
  // the worker's `onTaskUpdate` request sat unanswered.
  //
  // Honest about what this is worth: it was **not** the stretch that failed
  // PH-38.3's gate — that was thirty synchronous mirror tests in a row, and
  // this change was measured to move that file's worst block not at all. It is
  // kept because it is the same defect in a shared helper that every validation
  // runs, it costs nothing, and `assessRealismAsync` drives the same generator
  // to the same result. `assessRealism` remains for callers outside a worker.
  const realism = await assessRealismAsync(dataset, options.realism);
  return {
    instrument: dataset.instrument.id,
    ticks: dataset.tickCount,
    simulatedDays: (dataset.lastInstant - dataset.firstInstant) / 86_400_000,
    predictability,
    realism,
    acceptable: predictability.clean && realism.plausible,
    elapsedSeconds: Number(process.hrtime.bigint() - started) / 1e9,
  };
}

export function formatValidationReport(report: ValidationReport): string {
  return [
    `${report.instrument}: ${report.acceptable ? 'ACCEPTABLE' : 'NOT ACCEPTABLE'}`,
    `  ${report.ticks.toLocaleString()} ticks spanning ${report.simulatedDays.toFixed(1)} simulated days, ` +
      `validated in ${report.elapsedSeconds.toFixed(1)}s`,
    formatVerdict(report.predictability),
    formatRealismReport(report.realism),
  ].join('\n');
}
