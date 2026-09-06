import { SystemClock } from '@otc/core';
import {
  backupStateDirectory,
  stateRefusal,
  verifyStateDirectory,
  type StateDirectoryReport,
} from '@otc/runtime';

/**
 * The operator's tool for the state directory (PH-28.3).
 *
 *   npm run state:verify -- --dir ./.otc-state
 *   npm run state:backup -- --dir ./.otc-state --out /backups/otc-2026-09-05
 *
 * `verify` is the check the service runs before any market resumes, as a
 * command: exit 0 when the directory describes one market per asset, 1 when
 * it does not, with every problem named. `backup` copies the directory
 * consistently per file — the venue may be running — verifies the copy and
 * writes its manifest; exit 1 when the copy does not verify, because a backup
 * that would refuse to boot is not one.
 *
 * Restore is a directory swap with the service stopped: move the live
 * directory aside, put the backup in its place, start; the boot check says
 * whether it agrees with itself, and the manifest says what it holds.
 */
export interface StateToolOptions {
  readonly command: 'verify' | 'backup';
  readonly dir: string;
  readonly out?: string;
}

export function parseStateToolArgs(argv: readonly string[]): StateToolOptions {
  const [command, ...rest] = argv;
  if (command !== 'verify' && command !== 'backup') {
    throw new RangeError(`Usage: state-tool (verify|backup) --dir <state dir> [--out <target>]`);
  }
  let dir: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined) throw new RangeError(`${String(flag)} needs a value.`);
    if (flag === '--dir') dir = value;
    else if (flag === '--out') out = value;
    else throw new RangeError(`Unknown option ${String(flag)}.`);
  }
  if (dir === undefined) throw new RangeError('--dir is required.');
  if (command === 'backup' && out === undefined) throw new RangeError('backup needs --out.');
  return { command, dir, ...(out === undefined ? {} : { out }) };
}

export function describeReport(report: StateDirectoryReport): string {
  const lines = [`State directory: ${report.directory}`];
  lines.push(
    report.assets.length === 0
      ? 'Assets: none (nothing to resume)'
      : `Assets: ${report.assets.length} — ${report.assets.join(', ')}`,
  );
  for (const id of report.assets) {
    const h = report.heads[id]!;
    lines.push(
      `  ${id}: checkpoint through ${String(h.checkpoint)}, record through ${String(h.record)}, ` +
        `history through ${String(h.history)}`,
    );
  }
  if (report.labComposed)
    lines.push('Composed by the Lab: yes (production refuses this directory)');
  for (const w of report.warnings) {
    lines.push(`Warning: ${w.file}${w.assetId === null ? '' : ` (${w.assetId})`}: ${w.detail}`);
  }
  const refusal = stateRefusal(report);
  lines.push(refusal ?? 'Consistent: every file agrees.');
  return lines.join('\n');
}

/** Run the tool; returns the exit code and what it printed. */
export async function runStateTool(
  argv: readonly string[],
  clock = new SystemClock(),
): Promise<{ code: number; output: string }> {
  let options: StateToolOptions;
  try {
    options = parseStateToolArgs(argv);
  } catch (error) {
    return { code: 2, output: (error as Error).message };
  }
  if (options.command === 'verify') {
    const report = await verifyStateDirectory(options.dir);
    return { code: report.problems.length === 0 ? 0 : 1, output: describeReport(report) };
  }
  try {
    const { manifest, report } = await backupStateDirectory(options.dir, options.out!, clock.now());
    const output =
      `Backup written to ${options.out!} (taken at ${manifest.takenAt})\n` + describeReport(report);
    return { code: report.problems.length === 0 ? 0 : 1, output };
  } catch (error) {
    return { code: 1, output: (error as Error).message };
  }
}

const invokedDirectly = process.argv[1] !== undefined && /stateTool\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  void runStateTool(process.argv.slice(2)).then(({ code, output }) => {
    process.stdout.write(`${output}\n`);
    process.exit(code);
  });
}
