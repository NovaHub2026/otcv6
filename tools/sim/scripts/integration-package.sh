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
rm -rf "$out"/docs/phases "$out"/docs/audits "$out"/docs/reports "$out"/.github
# **`docs/evidence` is not deleted wholesale any more** (the readiness audit of
# 2026-09-28, finding 21). It was, and the two documents a broker actually reads
# cite it — the refund table behind the payout advice, the seam rate, the tempo
# record — so the delivered package carried seventeen dead links under sentences
# claiming a measurement was reproducible. What a delivered document cites, the
# package ships; the rest of the evidence tree, which records how this repository
# verified itself, does not. Computed transitively, so a kept record's own
# citations are kept too, and checked at the end of this script.
python3 - "$out" <<'PYEOF'
import pathlib, shutil, sys
sys.path.insert(0, str(pathlib.Path(sys.argv[1]) / 'tools' / 'sim'))
out = pathlib.Path(sys.argv[1])
evidence = out / 'docs' / 'evidence'
if evidence.is_dir():
    import re
    LINK = re.compile(r'\[[^\]]*\]\(([^)\s]+)\)')
    def cited_from(files):
        seen, frontier = set(), list(files)
        while frontier:
            nxt = []
            for rel in frontier:
                f = out / rel
                if not f.is_file():
                    continue
                for target in LINK.findall(f.read_text(errors='replace')):
                    if re.match(r'^(?:[a-z][a-z0-9+.-]*:|//)', target, re.I):
                        continue
                    resolved = (f.parent / target.split('#')[0]).resolve()
                    try:
                        rel_target = resolved.relative_to(out.resolve())
                    except ValueError:
                        continue
                    if rel_target.parts[:2] != ('docs', 'evidence'):
                        continue
                    key = str(rel_target)
                    if key not in seen:
                        seen.add(key)
                        nxt.append(key)
            frontier = nxt
        return seen
    delivered = [
        str(f.relative_to(out))
        for f in out.rglob('*.md')
        if 'evidence' not in f.parts and 'node_modules' not in f.parts
    ]
    keep = cited_from(delivered)
    removed = 0
    for f in sorted(evidence.rglob('*')):
        if f.is_file() and str(f.relative_to(out)) not in keep:
            f.unlink()
            removed += 1
    for d in sorted(evidence.rglob('*'), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    if not any(evidence.iterdir()):
        shutil.rmtree(evidence)
    print(f'evidence: {len(keep)} record(s) a delivered document cites kept, {removed} dropped')
PYEOF
# The guards that hold those documents; every other test ships and passes.
rm -f "$out"/packages/core/src/guardrails/{documentation,stateConsistency,traceability}.test.ts
# **And the script that runs two of them** (the readiness audit of 2026-09-28,
# finding 21): `state:check` named those test files, so the delivered package
# offered an operator a command that could only fail — in a tree where "check my
# state" is exactly what they would reach for. It guards this repository's process
# documents, which do not ship either.
python3 - "$out" <<'PYEOF'
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
manifest = out / 'package.json'
data = json.loads(manifest.read_text())
dropped = [name for name in ('state:check',) if name in data.get('scripts', {})]
for name in dropped:
    del data['scripts'][name]
manifest.write_text(json.dumps(data, indent=2) + '\n')
print(f'scripts: dropped {", ".join(dropped) if dropped else "none"} (repository guards)')
PYEOF
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
# **The copy at the root needs its links rewritten, not just copied** (the
# readiness audit of 2026-09-28, finding 21): every relative link in the guide is
# written from `docs/integration/`, so at the root `../architecture/API_CONTRACT.md`
# — the file `README.md` tells the broker to read — resolves *outside the package*.
python3 - "$out" <<'PYEOF'
import pathlib, re, sys
out = pathlib.Path(sys.argv[1])
text = (out / 'docs' / 'integration' / 'INTEGRATION.md').read_text()
def rewrite(match):
    label, target = match.group(1), match.group(2)
    if re.match(r'^(?:[a-z][a-z0-9+.-]*:|//|#)', target, re.I):
        return match.group(0)
    path, _, anchor = target.partition('#')
    resolved = (pathlib.Path('docs/integration') / path).as_posix()
    resolved = pathlib.posixpath.normpath(resolved)
    if resolved.startswith('..'):
        return match.group(0)
    return f'[{label}]({resolved}{"#" + anchor if anchor else ""})'
(out / 'INTEGRATION.md').write_text(re.sub(r'\[([^\]]*)\]\(([^)\s]+)\)', rewrite, text))
PYEOF
mkdir -p "$out/examples" && cp "$out"/docs/integration/examples/* "$out/examples/"
printf '# OTC Engine — integration package\n\nBuilt from commit `%s` of the engine repository on %s.\nStart with INTEGRATION.md; the API contract is docs/architecture/API_CONTRACT.md; the deployment files are under deploy/.\n' "$commit" "$(date -u +%F)" > "$out/README.md"
# **The process trees are dropped by design, so a link into one becomes prose.**
# This is the *only* class of broken link this script repairs, and it repairs it
# narrowly on purpose: a rewriter that silenced every unresolvable link would make
# the check below vacuous. A phase, audit or report document is named in the text
# and not linked; anything else that fails to resolve is a defect and stops the
# release.
python3 - "$out" <<'PYEOF'
import pathlib, re, sys
out = pathlib.Path(sys.argv[1]).resolve()
DROPPED = (('docs', 'phases'), ('docs', 'audits'), ('docs', 'reports'))
LINK = re.compile(r'\[([^\]]*)\]\(([^)\s]+)\)')
delinked = 0
for f in sorted(out.rglob('*.md')):
    if any(part in {'node_modules', 'dist', '.git'} for part in f.parts):
        continue
    def prose(match):
        global delinked
        label, target = match.group(1), match.group(2)
        if re.match(r'^(?:[a-z][a-z0-9+.-]*:|//|#)', target, re.I):
            return match.group(0)
        resolved = (f.parent / target.split('#')[0]).resolve()
        try:
            parts = resolved.relative_to(out).parts
        except ValueError:
            return match.group(0)
        if parts[:2] in DROPPED:
            delinked += 1
            return label
        return match.group(0)
    text = f.read_text(errors='replace')
    new = LINK.sub(prose, text)
    if new != text:
        f.write_text(new)
print(f'documents: {delinked} link(s) into the process trees named in prose instead')
PYEOF

# **A package whose documents cite what it does not ship does not build.** The
# checker is the repository's own build, because the package's is not compiled
# unless `--verify` ran.
checker="$repo/tools/sim/dist/packageLinksTool.js"
if [ ! -f "$checker" ]; then
  echo "cannot check the package's links: $checker is missing — run npm run build" >&2
  exit 1
fi
node "$checker" "$out"

# The zip is the source tree, never what building or verifying it leaves behind.
# `--verify` installs dependencies *inside* the package so the header can say it
# ran, which took the v2.0.0 archive from 1.7 MB to 141 MB before this filter.
python3 - "$out" <<'PYEOF'
import os, pathlib, sys, zipfile
out = pathlib.Path(sys.argv[1]).resolve()
skip = {'node_modules', 'dist', 'coverage', '.next', '.next-stat', '.git', '.otc-state'}
# `out.name + '.zip'`, never `with_suffix`: a version is full of dots, so
# `with_suffix` replaces the patch number instead of appending — every package
# since v1.0.0 was written to `otc-engine-v2.4.zip` while the line this script
# ends with announced `otc-engine-v2.4.0.zip`, a file that does not exist.
archive = out.parent / (out.name + '.zip')
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
