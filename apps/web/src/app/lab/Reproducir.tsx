'use client';

import { useState, type ReactElement } from 'react';
import { es } from '../../lib/es.js';
import { Button, Field, FIELD, Notice, Row, Section, T } from '../ui/kit.js';
import { when, type KeptSnapshotView, type MirrorView, type ReplayView } from './labApi.js';

/**
 * Reproducir (§74–§75) and the mirror (§76–§77), on forks (PH-24.10).
 *
 * The kept states as a list, a replay from any of them checked tick by tick
 * against what was published, and two futures from the current state with the
 * signs flipped — the product's proof, on this market, now.
 */
export function Reproducir({
  snapshots,
  replay,
  mirror,
  busy,
  onReplay,
  onMirror,
}: {
  snapshots: readonly KeptSnapshotView[];
  replay: ReplayView | null;
  mirror: MirrorView | null;
  busy: string | null;
  onReplay: (sequence: number) => Promise<void>;
  onMirror: (ticks: number) => Promise<void>;
}): ReactElement {
  const [ticks, setTicks] = useState('120');
  const r = es.lab.replay;
  return (
    <>
      <Section title={r.title} info={r.info}>
        <div data-testid="lab-snapshots">
          {snapshots.length === 0 ? (
            <div style={{ color: T.faint, fontSize: 11 }}>—</div>
          ) : (
            [...snapshots].reverse().map((k) => (
              <div
                key={k.sequence}
                data-testid={`lab-snapshot-${String(k.sequence)}`}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 12,
                  padding: '3px 0',
                  borderTop: `1px solid ${T.line}`,
                }}
              >
                <span style={{ color: T.text, minWidth: 90 }}>#{String(k.sequence)}</span>
                <span style={{ color: T.muted, minWidth: 110 }}>{when(k.instant)}</span>
                <span style={{ color: T.faint, minWidth: 80 }}>{r.why[k.why] ?? k.why}</span>
                <span style={{ color: T.faint, minWidth: 120 }}>
                  {k.script > 0 ? r.scriptPlayed(k.script) : ''}
                </span>
                <Button
                  small
                  testId={`lab-replay-${String(k.sequence)}`}
                  disabled={busy !== null}
                  onClick={() => void onReplay(k.sequence)}
                >
                  {r.replayFrom}
                </Button>
              </div>
            ))
          )}
        </div>
        {replay !== null && (
          <div data-testid="lab-replay-verdict" style={{ marginTop: 10 }}>
            <Row
              label={r.verdict}
              tone={replay.identical ? 'ok' : 'bad'}
              value={
                replay.replayed === 0
                  ? r.nothing
                  : replay.identical
                    ? r.identical(replay.replayed)
                    : r.divergent(replay.replayed, replay.firstDivergence?.sequence ?? -1)
              }
            />
            <Row
              label="desde → hasta"
              value={`#${String(replay.fromSequence)} → #${String(replay.toSequence)}`}
            />
            {replay.scriptPlayed > 0 && (
              <Row label="vector armado" value={r.scriptPlayed(replay.scriptPlayed)} />
            )}
          </div>
        )}
      </Section>
      <Section title={r.mirror.title} info={r.mirror.info}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
          <Field label={r.mirror.ticks} width={90}>
            <input
              data-testid="lab-mirror-ticks"
              value={ticks}
              onChange={(e) => setTicks(e.target.value)}
              style={FIELD}
            />
          </Field>
          <span style={{ marginBottom: 10 }}>
            <Button
              testId="lab-mirror-run"
              disabled={busy !== null}
              onClick={() => void onMirror(Number(ticks))}
            >
              {r.mirror.run}
            </Button>
          </span>
        </div>
        {mirror !== null && (
          <div data-testid="lab-mirror-verdict">
            <Row
              label={r.mirror.plain}
              value={r.mirror.summary(mirror.plain.net, mirror.plain.high, mirror.plain.low)}
            />
            <Row
              label={r.mirror.flipped}
              value={r.mirror.summary(mirror.mirror.net, mirror.mirror.high, mirror.mirror.low)}
            />
            {mirror.onlySignsDiffer ? (
              <Notice tone="ok" testId="lab-mirror-same">
                {r.mirror.same}
              </Notice>
            ) : (
              <Notice tone="bad" testId="lab-mirror-differ">
                {r.mirror.differ}
              </Notice>
            )}
          </div>
        )}
      </Section>
    </>
  );
}
