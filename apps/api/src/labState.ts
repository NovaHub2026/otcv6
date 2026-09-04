import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Which composition wrote a state directory, and what production does about it.
 *
 * **Cycle Audit 8 (a4, a6).** ADR-0018 puts the Lab-composed process on "the
 * engine's port and state directory", and the local launcher does exactly that:
 * one environment variable switches the same directory between the Lab and
 * production. Nothing noticed. `VenueService.start()` resumed the checkpoints
 * the Lab wrote, `/markets/:id/history` served the Lab's candles as genuine
 * history, `/markets/:id` reported `recovery: {"kind":"resumed"}` — the same
 * word a clean restart produces — and the Lab's own session file sat unread in
 * the same directory. A market whose prices an operator chose among futures
 * became a production market by a redeploy, and settlement against it is
 * neither economically blind (INV-001) nor reproducible from the record as
 * production's (INV-009).
 *
 * So the Lab marks its state directory when it boots, and production refuses to
 * start on a marked one. The mark is written at boot rather than at the first
 * recorded act, because a Lab that ran for an hour and was never touched still
 * published a record only a Lab could have published: the wrapper is in the
 * stream whether or not anyone armed it.
 *
 * There is no environment variable to override this. An override is a thing a
 * deployment template sets once and nobody reads again; moving a named file
 * aside is an act somebody has to mean.
 */
export const LAB_STATE_MARKER = path.join('lab', 'composed-by-lab.json');

/** Where the marker lives for a state directory. */
export function labMarkerPath(stateDir: string): string {
  return path.join(stateDir, LAB_STATE_MARKER);
}

/** Called at Lab boot: this directory now belongs to a simulation. */
export function markLabState(stateDir: string, at: number, engineVersion: string): string {
  const file = labMarkerPath(stateDir);
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(
      file,
      `${JSON.stringify({ composedBy: 'lab', firstBootAt: at, engineVersion }, null, 2)}\n`,
    );
  }
  return file;
}

/** What production must say when it is pointed at a Lab's directory. */
export function labStateRefusal(stateDir: string): string {
  return (
    `Refusing to start: ${stateDir} was written by a Lab-composed engine — ${labMarkerPath(stateDir)} ` +
    `says so. Its checkpoints and its candle history carry prices an operator selected among the ` +
    `engine's futures, and this composition would resume them and serve them as production's ` +
    `(ADR-0018; INV-001, INV-009). Point OTC_STATE_DIR at a directory production owns, or move ` +
    `that marker aside deliberately if you accept the record for what it is.`
  );
}

/**
 * The check production runs before it resumes anything.
 *
 * Returns the refusal when the directory carries the mark, and `null` when it
 * does not. A caller that ignores the string is a caller that starts anyway,
 * which is why `main.ts` exits on it rather than logging it.
 */
export function refuseLabState(stateDir: string): string | null {
  return existsSync(labMarkerPath(stateDir)) ? labStateRefusal(stateDir) : null;
}
