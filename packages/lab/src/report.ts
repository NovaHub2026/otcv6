import { runBatteryAsync, type BatteryOptions, type Verdict } from './attacks/battery.js';
import { formatVerdict } from './attacks/battery.js';
import type { ObserverDataset } from './observer.js';
import {
  assessRealism,
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
  const realism = assessRealism(dataset, options.realism);
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
