#!/usr/bin/env python3
"""Render Cycle Audit 10's findings table from the auditors' JSON and the refuters' verdicts.

The table is generated rather than typed because 98 findings across eight
auditors is more than a person transcribes correctly, and because the verdict
column must come from the refutations file rather than from the report that
made the claim.
"""
import json, glob, collections, sys

SEV_ORDER = {'critical': 0, 'material': 1, 'minor': 2, 'clean': 3}

def load(pattern):
    out = {}
    for f in sorted(glob.glob(pattern)):
        a = f.split('/')[-1][:-5]
        try:
            out[a] = json.load(open(f))
        except Exception as e:
            print(f'WARN unreadable {f}: {e}', file=sys.stderr)
    return out

F = load('/home/alejo/.otc-audit10/findings/a*.json')
R = load('/home/alejo/.otc-audit10/refutations/a*.json')

rows = []
for a in sorted(F):
    verdicts = {x['id']: x for x in R.get(a, [])}
    for x in F[a]:
        v = verdicts.get(x['id'], {})
        rows.append({
            'id': x['id'],
            'severity': (v.get('severityIfConfirmed') or x.get('severity', '?')).lower(),
            'claimed': x.get('severity', '?'),
            'verdict': v.get('verdict', 'no verdict'),
            'title': ' '.join(str(x.get('title', '')).split()),
            'file': x.get('file', ''),
        })

rows.sort(key=lambda r: (SEV_ORDER.get(r['severity'], 9), r['id']))

sev = collections.Counter(r['severity'] for r in rows)
verd = collections.Counter(r['verdict'] for r in rows)
print(f"# {len(rows)} findings — " + ', '.join(f'{n} {k}' for k, n in sev.most_common()))
print('# verdicts: ' + ', '.join(f'{n} {k}' for k, n in verd.most_common()))
print()
print('| ID | Severity | Verdict | Finding |')
print('| --- | --- | --- | --- |')
for r in rows:
    note = '' if r['severity'] == r['claimed'].lower() else f" _(claimed {r['claimed']})_"
    title = r['title'][:300]
    print(f"| {r['id']} | {r['severity']} | {r['verdict']} | {title}{note} |")
