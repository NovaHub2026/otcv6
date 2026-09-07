#!/usr/bin/env bash
# The integration package (PH-30.5): the engine as a broker receives it,
# regenerated from a commit of this repository — never edited by hand.
#
#   tools/sim/scripts/integration-package.sh <commit-ish> <out dir>
#
# What it is: `git archive` of the commit, minus the process documents that
# govern this repository (they describe how the engine is built, not how it
# is run), minus the three guards that hold those documents, plus the broker's
# guide at the top and the examples beside it. Everything else ships as it is:
# the packages, the service, the panel, the tools, the deployment files, the
# architecture and the API contract. The zip beside the directory is what is
# handed over.
set -euo pipefail
ref="${1:?commit-ish}"; out="${2:?out dir}"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
rm -rf "$out"; mkdir -p "$out"
git -C "$repo" archive --format=tar "$ref" | tar -x -C "$out"
# `^{commit}`, because an annotated tag's own object hash is not the commit and
# names nothing a reader can check out (Cycle Audit 10, a7-08: the v1.0.0
# package stamped `0c2cad7`, the tag object, as its "commit").
commit="$(git -C "$repo" rev-parse --short "$ref^{commit}")"
# Process documents: how this repository is run, not how the engine is.
rm -f "$out"/{CLAUDE.md,CURRENT_STATE.md,DOCS_INDEX.md,GOVERNANCE.md,PROJECT_CONTEXT.md,PROJECT_INTRODUCTION.md,SESSION_HANDOFF.md}
rm -rf "$out"/docs/phases "$out"/docs/audits "$out"/docs/reports "$out"/docs/evidence "$out"/.github
# The guards that hold those documents; every other test ships and passes.
rm -f "$out"/packages/core/src/guardrails/{documentation,stateConsistency,traceability}.test.ts
# Process material a broker has no use for, and which names this repository's
# own machinery (Cycle Audit 10, a5-07): the audit worktree script and the
# Issue tracker's mirror. The script's comment above said the package was the
# tree "minus the process documents"; these three were process documents that
# happened to live elsewhere.
rm -f "$out"/tools/sim/scripts/cycle-audit-worktrees.sh "$out"/tools/sim/scripts/audit-findings-table.py "$out"/docs/BACKLOG.md

# **The guide's verification header, written from a run rather than by hand
# (Cycle Audit 10, a7-05).** It said "verificado ... desde el commit 4ee4986,
# 142 ficheros, 2.651 pruebas" — a commit two cycles before the release, with
# counts that were wrong by a fifth — because it was typed once and never
# again. A header that claims a verification is either produced by one or it
# is not written: `--verify` runs the package's own suite in the package and
# stamps what it saw; without it the block says plainly that it was not run.
verified_block() {
  if [ "${OTC_PACKAGE_VERIFY:-0}" = "1" ]; then
    ( cd "$out" && npm install --no-audit --no-fund > /tmp/pkg-install.log 2>&1 \
      && npm run build > /tmp/pkg-build.log 2>&1 \
      && npx vitest run --project unit > /tmp/pkg-unit.log 2>&1 ) || {
        echo "package verification FAILED; see /tmp/pkg-*.log" >&2; exit 1; }
    local files tests
    files="$(grep -oE 'Test Files +[0-9]+ passed \([0-9]+\)' /tmp/pkg-unit.log | tail -1 | grep -oE '\([0-9]+\)' | tr -d '()')"
    tests="$(grep -oE 'Tests +[0-9]+ passed \([0-9]+\)' /tmp/pkg-unit.log | tail -1 | grep -oE '\([0-9]+\)' | tr -d '()')"
    printf 'Verificado en este paquete, tal cual se entrega (%s, desde el commit `%s`):\n\n```\nnpm install       → exit 0\nnpm run build     → exit 0\nnpm run test:unit → %s ficheros, %s pruebas, exit 0\n```\n' \
      "$(date -u +%F)" "$commit" "${files:-?}" "${tests:-?}"
  else
    printf 'Este paquete se generó desde el commit `%s` (%s) **sin ejecutar su suite\naquí**. Para comprobarlo tú mismo, que es lo que recomendamos:\n\n```\nnpm install && npm run build && npm run test:unit\n```\n' \
      "$commit" "$(date -u +%F)"
  fi
}

# The broker's guide at the top, the examples beside it, with the stale
# verification block replaced by what this run can actually say.
python3 - "$out" <<'PYEOF'
import re, sys, pathlib
out = pathlib.Path(sys.argv[1])
guide = out / 'docs' / 'integration' / 'INTEGRATION.md'
text = guide.read_text()
# The block runs from the "Verificado" line to the end of the fence after it.
start = text.find('Verificado antes de empaquetar')
if start != -1:
    fence = text.find('```', start)
    end = text.find('```', fence + 3)
    text = text[:start] + '@@VERIFIED@@\n' + text[end + 3:].lstrip('\n')
    guide.write_text(text)
PYEOF
verified_block > /tmp/pkg-verified.md
python3 - "$out" /tmp/pkg-verified.md <<'PYEOF'
import sys, pathlib
out, block = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).read_text()
guide = out / 'docs' / 'integration' / 'INTEGRATION.md'
guide.write_text(guide.read_text().replace('@@VERIFIED@@\n', block))
PYEOF
cp "$out/docs/integration/INTEGRATION.md" "$out/INTEGRATION.md"
mkdir -p "$out/examples" && cp "$out"/docs/integration/examples/* "$out/examples/"
printf '# OTC Engine — integration package\n\nBuilt from commit `%s` of the engine repository on %s.\nStart with INTEGRATION.md; the API contract is docs/architecture/API_CONTRACT.md; the deployment files are under deploy/.\n' "$commit" "$(date -u +%F)" > "$out/README.md"
# The zip is the source tree, never what building or verifying it leaves behind.
# `--verify` installs dependencies *inside* the package so the header can say it
# ran, which took the v2.0.0 archive from 1.7 MB to 141 MB before this filter.
python3 - "$out" <<'PYEOF'
import os, pathlib, sys, zipfile
out = pathlib.Path(sys.argv[1]).resolve()
skip = {'node_modules', 'dist', 'coverage', '.next', '.next-stat', '.git', '.otc-state'}
archive = out.with_suffix('.zip')
archive.unlink(missing_ok=True)
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(out):
        dirs[:] = sorted(d for d in dirs if d not in skip)
        for name in sorted(files):
            path = pathlib.Path(root) / name
            zf.write(path, path.relative_to(out.parent))
print(f"zipped {archive} ({archive.stat().st_size // 1024} KiB)")
PYEOF
echo "package at $out and $out.zip, from $commit"
