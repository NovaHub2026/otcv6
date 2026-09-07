import { existsSync } from 'node:fs';
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
 *
 * **A restore rolls the published record back, and `verify` now says so
 * (Cycle Audit 10, a6-07).** A directory whose heads are still exactly what its
 * manifest recorded is a backup nothing has run in yet, which is the moment
 * before the damage: everything the venue served after the backup was taken is
 * absent from that record, so those sequences answer 404 and
 * `GET /markets/:id/price?at=` answers instants observers already held with the
 * price the record ends at. Markets reopen past what the restored record holds
 * and on a new key epoch, so no keystream position is spent twice and no
 * sequence is republished — but the rollback itself is not undone by starting.
 * Restore the newest backup, and read the line before starting the service.
 *
 * **The manifest stays in the restored directory.** `backup.json` is left where
 * the copy put it and is not a checkpoint: the store skips it by its `kind`, so
 * the boot check and this tool's `verify` read the copy the same way. Until
 * Cycle Audit 10 (a7-01) they did not — the manifest was read as a
 * thirty-first asset, `backup`, and every directory this tool produced was
 * refused at boot with `record belongs to asset undefined` until the operator
 * deleted it. `backup` now also verifies the copy *after* writing the manifest,
 * so this tool's exit code is a statement about the directory an operator will
 * later swap in, not about one file less.
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
  // **Cycle Audit 10 (a6-07).** A restore is a directory swap and left no trace
  // of itself; the manifest in the copy is the trace. Said here so an operator
  // running `verify` before starting the service is told what the swap costs
  // while there is still time to reach for a newer backup.
  if (report.backup !== null) {
    lines.push(
      report.backup.untouched
        ? `Backup copy: a backup taken at ${report.backup.takenAt}, and nothing has run in it ` +
            `since. Starting a venue here rolls the published record back to that instant: ` +
            `every tick served after that instant is absent from this record, so those ` +
            `sequences answer 404 and the settlement query answers those instants with the ` +
            `price this record ends at rather than the one observers saw. Restore the newest ` +
            `backup, or accept the rollback deliberately.`
        : `Backup copy: a backup taken at ${report.backup.takenAt}; the venue has run here ` +
            `since, so the manifest is history rather than a warning.`,
    );
  }
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
  // **Cycle Audit 10 (a8-05).** A directory that is not there is not a
  // consistent one. `verifyStateDirectory` answers an empty, problem-free
  // report for a missing path — right for the service's first boot, where
  // nothing to resume is a legal state — and this command turned that into
  // `Assets: none (nothing to resume)`, `Consistent: every file agrees.` and
  // **exit 0**. A mistyped `--dir`, an unmounted volume, or a restore that
  // never landed all read as a healthy state directory, and PH-28 records
  // `state:verify — exit 0` as evidence of consistency. `backup` already
  // refuses the same input with the same words — from `backupStateDirectory`,
  // one layer down — so the check is made once here, for both commands, and
  // says the same thing either way. An empty directory that *exists* is still
  // `Assets: none`, exit 0: a first boot is a legal state.
  if (!existsSync(options.dir)) {
    return { code: 1, output: `No state directory at ${options.dir}.` };
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
