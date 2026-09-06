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
