#!/usr/bin/env bash
# A verified backup of the state directory on a timer (PH-30.1).
#
#   deploy/backup.sh <state dir> <backups dir> <keep> [<every seconds>]
#
# Each run writes <backups dir>/otc-<UTC stamp> with `npm run state:backup`
# — a consistent, per-file copy the venue may be running over, verified on the
# way out — and keeps the newest <keep>. Without <every seconds> it runs once.
set -euo pipefail
state="${1:?state dir}"; out="${2:?backups dir}"; keep="${3:?keep}"; every="${4:-}"
# Retention is `head -n -"$keep"`, and `head -n -0` prints *every* line: keep=0
# deleted every backup in the directory, including the one this run had just
# taken and verified, exit 0, immediately after printing `Consistent: every
# file agrees.` (Cycle Audit 10, a2-09). A non-numeric keep reached `head` too
# and died there with `invalid number of lines`, after the copy was written.
# Both are the same missing question, and the answer costs an operator nothing:
# a backup script whose job is to keep backups may not be told to keep none.
case "$keep" in
  ''|*[!0-9]*) echo "keep must be a whole number of backups; got '$keep'" >&2; exit 2;;
esac
if [ "$keep" -lt 1 ]; then
  echo "keep must be at least 1: keep=0 deletes every backup, including the one just taken" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
run_once() {
  local stamp target
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$out/otc-$stamp"
  node tools/sim/dist/stateTool.js backup --dir "$state" --out "$target"
  ls -1d "$out"/otc-* 2>/dev/null | sort | head -n -"$keep" | xargs -r rm -rf
}
if [ -z "$every" ]; then run_once; exit 0; fi
# The first run is fatal, so a service that can never write a backup crash-loops
# where an operator sees it instead of sleeping six hours at a time and looking
# healthy (Cycle Audit 10, a5-04). Later failures are transient by comparison —
# a full disk, a torn state directory — and are retried on the next tick.
run_once
while true; do sleep "$every"; run_once || echo "backup failed at $(date -u +%FT%TZ)" >&2; done
