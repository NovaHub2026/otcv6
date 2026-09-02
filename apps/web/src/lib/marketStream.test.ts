// Invariant evidence: INV-002 (shared market) — a client that cannot know what it missed must not pretend to.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TickWindow } from '@otc/chart';
import { streamMarket, type StreamNotice } from './marketStream.js';

/**
 * The reconnect policy, driven in Node with a fake `EventSource` (a6-11).
 *
 * A browser's `EventSource` cannot see a status code. What it can see is
 * whether the connection ever opened: a refusal fails before `onopen`, a drop
 * fails after it. The policy under test is built on that one bit, and the
 * defect it replaces — asking for the same evicted sequence every second for
 * ever — is the first thing planted against it.
 */
class FakeSource {
  static instances: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  tick(sequence: number): void {
    const data = JSON.stringify({ sequence, instant: 1_776_000_000_000 + sequence, price: 100 });
    this.onmessage?.({ data } as MessageEvent<string>);
  }
  fail(): void {
    this.onerror?.();
  }
}

const latest = (): FakeSource => FakeSource.instances[FakeSource.instances.length - 1]!;
const query = (source: FakeSource): string => new URL(source.url, 'http://panel.test').search;

function open(notices: StreamNotice[], windows: TickWindow[]): ReturnType<typeof streamMarket> {
  return streamMarket(
    '/engine',
    'eurusd',
    () => new TickWindow({ capacity: 1_000 }),
    (window) => {
      windows.push(window);
    },
    (notice) => {
      notices.push(notice);
    },
    { eventSource: FakeSource as unknown as typeof EventSource },
  );
}

beforeEach(() => {
  FakeSource.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reconnecting a tick stream', () => {
  it('resumes exactly after a drop that happened once the stream was open', () => {
    const notices: StreamNotice[] = [];
    const windows: TickWindow[] = [];
    const handle = open(notices, windows);
    expect(query(latest())).toBe('');
    latest().open();
    latest().tick(1);
    latest().tick(2);
    latest().fail();

    expect(notices.at(-1)).toEqual({
      kind: 'reconnecting',
      attempt: 1,
      inMs: 1_000,
      resuming: true,
    });
    expect(FakeSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSource.instances).toHaveLength(2);
    // Exactly what is missing, never "from now".
    expect(query(latest())).toBe('?from=3');
    latest().open();
    expect(notices.at(-1)).toEqual({ kind: 'live', afterGap: false });
    latest().tick(3);
    expect(windows.at(-1)!.range).toEqual({ oldest: 1, newest: 3 });
    handle.close();
  });

  it('starts over when a resume is refused before opening, and says so (a6-11)', () => {
    // The plant is the previous code: reconnect with the same evicted sequence
    // every second for ever. A refusal arrives as an error before `onopen`.
    const notices: StreamNotice[] = [];
    const windows: TickWindow[] = [];
    const handle = open(notices, windows);
    latest().open();
    latest().tick(10);
    latest().tick(11);
    latest().fail();
    vi.advanceTimersByTime(1_000);
    expect(query(latest())).toBe('?from=12');
    latest().fail(); // refused: never opened

    expect(notices.at(-2)).toEqual({
      kind: 'gap',
      reason: 'the engine refused to resume from sequence 12',
    });
    expect(notices.at(-1)).toEqual({
      kind: 'reconnecting',
      attempt: 2,
      inMs: 2_000,
      resuming: false,
    });
    vi.advanceTimersByTime(2_000);
    expect(FakeSource.instances).toHaveLength(3);
    expect(query(latest()), 'no resume point after a refusal').toBe('');
    latest().open();
    expect(notices.at(-1)).toEqual({ kind: 'live', afterGap: true });
    // A fresh window: the ticks before the gap are gone rather than joined
    // across a hole the client cannot see into.
    latest().tick(900);
    expect(windows.at(-1)!.range).toEqual({ oldest: 900, newest: 900 });
    handle.close();
  });

  it('backs off exponentially up to the cap, and resets once it opens', () => {
    const notices: StreamNotice[] = [];
    const handle = streamMarket(
      '/engine',
      'eurusd',
      () => new TickWindow(),
      () => undefined,
      (notice) => {
        notices.push(notice);
      },
      {
        eventSource: FakeSource as unknown as typeof EventSource,
        backoffMs: 100,
        maxBackoffMs: 350,
      },
    );
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      latest().fail();
      const notice = notices.at(-1)!;
      expect(notice.kind).toBe('reconnecting');
      if (notice.kind === 'reconnecting') delays.push(notice.inMs);
      vi.advanceTimersByTime(notice.kind === 'reconnecting' ? notice.inMs : 0);
    }
    expect(delays).toEqual([100, 200, 350, 350, 350]);
    latest().open();
    latest().fail();
    expect(notices.at(-1)).toMatchObject({ kind: 'reconnecting', attempt: 1, inMs: 100 });
    handle.close();
  });

  it('stops reconnecting once closed', () => {
    const handle = open([], []);
    latest().fail();
    handle.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSource.instances).toHaveLength(1);
    expect(latest().closed).toBe(true);
  });

  it('refuses a batch that does not continue the window rather than drawing across it', () => {
    const handle = open([], []);
    latest().open();
    latest().tick(5);
    expect(() => latest().tick(7)).toThrow(/Expected sequence 6/);
    handle.close();
  });
});
