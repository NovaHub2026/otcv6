#!/usr/bin/env bash
# Cycle Audit worktrees (B-020, ADR-0011): eight auditors, one detached git worktree each at the
# audited commit, dependencies installed and built per worktree, so no auditor can see another's
# plants. Written for Cycle Audit 9; the auditor subjects and prompts live with the audit record.
set -u
COMMIT="${1:?usage: cycle-audit-worktrees.sh <commit> (root: $OTC_AUDIT_ROOT or ~/.otc-audit9)}"
ROOT="${OTC_AUDIT_ROOT:-$HOME/.otc-audit9}"
mkdir -p "$ROOT/findings" "$ROOT/refutations"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO" || exit 99
for a in a1 a2 a3 a4 a5 a6 a7 a8; do
  if [ ! -d "$ROOT/$a" ]; then git worktree add --detach "$ROOT/$a" "$COMMIT" > "$ROOT/$a.setup.log" 2>&1 || { echo "$a worktree FAILED"; continue; }; fi
  ( cd "$ROOT/$a" && npm ci --no-audit --no-fund >> "$ROOT/$a.setup.log" 2>&1 && npm run build >> "$ROOT/$a.setup.log" 2>&1 && echo "$a READY $(git rev-parse --short HEAD)" || echo "$a SETUP FAILED (see $ROOT/$a.setup.log)" ) &
done
wait
echo "setup done"
