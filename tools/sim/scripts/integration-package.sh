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
commit="$(git -C "$repo" rev-parse --short "$ref")"
# Process documents: how this repository is run, not how the engine is.
rm -f "$out"/{CLAUDE.md,CURRENT_STATE.md,DOCS_INDEX.md,GOVERNANCE.md,PROJECT_CONTEXT.md,PROJECT_INTRODUCTION.md,SESSION_HANDOFF.md}
rm -rf "$out"/docs/phases "$out"/docs/audits "$out"/docs/reports "$out"/docs/evidence "$out"/.github
# The guards that hold those documents; every other test ships and passes.
rm -f "$out"/packages/core/src/guardrails/{documentation,stateConsistency,traceability}.test.ts
# The broker's guide at the top, the examples beside it.
cp "$out/docs/integration/INTEGRATION.md" "$out/INTEGRATION.md"
mkdir -p "$out/examples" && cp "$out"/docs/integration/examples/* "$out/examples/"
printf '# OTC Engine — integration package\n\nBuilt from commit `%s` of the engine repository on %s.\nStart with INTEGRATION.md; the API contract is docs/architecture/API_CONTRACT.md; the deployment files are under deploy/.\n' "$commit" "$(date -u +%F)" > "$out/README.md"
( cd "$(dirname "$out")" && rm -f "$(basename "$out").zip" && python3 -c "
import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', root_dir=sys.argv[1])" "$(basename "$out")" )
echo "package at $out and $out.zip, from $commit"
