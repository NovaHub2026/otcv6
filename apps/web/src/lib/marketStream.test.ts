// Invariant evidence: INV-002 (shared market) — a client that cannot know what it missed must not pretend to.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TickWindow } from '@otc/chart';
import {
  streamMarket,
  streamMarkets,
  type FetchLike,
  type MarketNotice,
  type StreamNotice,
} from './marketStream.js';

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

describe('several markets on one stream (PH-30.2, Issue #16)', () => {
  class MuxSource extends FakeSource {
    readonly listeners = new Map<string, (event: Event) => void>();
    addEventListener(name: string, handler: (event: Event) => void): void {
      this.listeners.set(name, handler);
    }
    frame(name: string, data: unknown): void {
      this.listeners.get(name)?.({ data: JSON.stringify(data) } as unknown as Event);
    }
    muxTick(asset: string, sequence: number): void {
      const data = JSON.stringify({
        asset,
        sequence,
        instant: 1_776_000_000_000 + sequence,
        price: 100 + sequence,
      });
      this.onmessage?.({ data } as MessageEvent<string>);
    }
  }
  const muxLatest = (): MuxSource =>
    FakeSource.instances[FakeSource.instances.length - 1] as MuxSource;

  it('opens one connection for every asset, demultiplexes by asset and resumes each from its own sequence', () => {
    vi.useFakeTimers();
    const before = FakeSource.instances.length;
    const updates: string[] = [];
    const notices: string[] = [];
    const handle = streamMarkets(
      '/engine',
      ['eurusd', 'gbpusd', 'btcusdt'],
      () => new TickWindow({ capacity: 1_000 }),
      (id, window) => updates.push(`${id}:${String(window.latest?.sequence)}`),
      (id, notice) => notices.push(`${String(id)}:${notice.kind}`),
      { eventSource: MuxSource as unknown as typeof EventSource, backoffMs: 10 },
    );
    expect(FakeSource.instances.length - before).toBe(1);
    const first = muxLatest();
    expect(query(first)).toBe('?assets=eurusd%2Cgbpusd%2Cbtcusdt&onGap=live');
    first.open();
    expect(handle.connected).toBe(true);
    first.muxTick('eurusd', 1);
    first.muxTick('gbpusd', 7);
    first.muxTick('eurusd', 2);
    expect(updates).toEqual(['eurusd:1', 'gbpusd:7', 'eurusd:2']);
    // The connection drops: one reconnect, naming every asset's next sequence.
    first.fail();
    vi.advanceTimersByTime(10);
    const second = muxLatest();
    expect(second).not.toBe(first);
    expect(decodeURIComponent(query(second))).toBe(
      '?assets=eurusd,gbpusd,btcusdt&onGap=live&from=eurusd:3,gbpusd:8',
    );
    expect(notices.filter((n) => n.endsWith('reconnecting'))).toHaveLength(3);
    handle.close();
    vi.useRealTimers();
  });

  /**
   * **Cycle Audit 10 (a5-03).** A market retired while the page is
   * disconnected is learned from nothing: the `close` frame that teaches it
   * needs an open connection, and the venue refuses the *whole* set with a 404
   * for the one asset it no longer hosts. Measured on the shipped code: 21
   * reconnects, the same URL every time, eight charts stuck on
   * `reconnecting` for ever. An `EventSource` cannot see the 404, so the
   * client asks the engine what it still hosts and carries on with that.
   */
  it('asks which markets remain when the whole set is refused, and carries the survivors (a5-03)', async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const notices: { id: string | null; notice: MarketNotice }[] = [];
    const handle = streamMarkets(
      '/engine',
      ['eurusd', 'gbpusd'],
      () => new TickWindow({ capacity: 1_000 }),
      () => undefined,
      (id, notice) => notices.push({ id, notice }),
      {
        eventSource: MuxSource as unknown as typeof EventSource,
        backoffMs: 10,
        fetch: (url: string) => {
          asked.push(url);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ id: 'eurusd', displayName: 'EUR/USD' }]),
          });
        },
      },
    );
    const first = muxLatest();
    first.open();
    first.muxTick('eurusd', 1);
    first.muxTick('gbpusd', 7);
    first.fail(); // a drop, after it opened: resume each from its own sequence
    await vi.advanceTimersByTimeAsync(10);
    expect(decodeURIComponent(query(muxLatest()))).toBe(
      '?assets=eurusd,gbpusd&onGap=live&from=eurusd:2,gbpusd:8',
    );
    muxLatest().fail(); // refused before opening: 404, because gbpusd is gone
    await vi.advanceTimersByTimeAsync(20);
    // The resume point is dropped first — it is the other thing a refusal can
    // mean (a6-11) — and the whole set is asked for again.
    expect(decodeURIComponent(query(muxLatest()))).toBe('?assets=eurusd,gbpusd&onGap=live');
    expect(asked).toEqual([]);
    muxLatest().fail(); // refused again, with nothing to blame but the set
    await vi.advanceTimersByTimeAsync(40);
    expect(asked).toEqual(['/engine/markets']);
    expect(notices.find((n) => n.id === 'gbpusd' && n.notice.kind === 'retired')).toBeDefined();
    // The market the venue still serves is still carried, and is live again.
    expect(decodeURIComponent(query(muxLatest()))).toBe('?assets=eurusd&onGap=live');
    muxLatest().open();
    expect(handle.connected).toBe(true);
    handle.close();
    vi.useRealTimers();
  });

  it('drops nothing while the engine still lists the markets, or cannot be asked', async () => {
    vi.useFakeTimers();
    const answers: FetchLike[] = [
      // Both still hosted: the refusal was something else, and nothing goes.
      () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'eurusd' }, { id: 'gbpusd' }]),
        }),
      // A venue that is still booting lists no market at all: dropping every
      // chart on that answer would be this defect pointing the other way.
      () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
      // Refused, and unreachable: an engine that is down takes nothing off the
      // page — the backoff is the answer to that.
      () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
      () => Promise.reject(new Error('the engine is not answering')),
    ];
    for (const answer of answers) {
      FakeSource.instances = [];
      const notices: { id: string | null; notice: MarketNotice }[] = [];
      const handle = streamMarkets(
        '/engine',
        ['eurusd', 'gbpusd'],
        () => new TickWindow({ capacity: 1_000 }),
        () => undefined,
        (id, notice) => notices.push({ id, notice }),
        {
          eventSource: MuxSource as unknown as typeof EventSource,
          backoffMs: 10,
          fetch: answer,
        },
      );
      muxLatest().fail();
      await vi.advanceTimersByTimeAsync(10);
      expect(decodeURIComponent(query(muxLatest()))).toBe('?assets=eurusd,gbpusd&onGap=live');
      expect(notices.filter((n) => n.notice.kind === 'retired')).toEqual([]);
      handle.close();
    }
    vi.useRealTimers();
  });

  it('tells each market its own hole, its own gap, and its retirement — and stops carrying a retired market', () => {
    vi.useFakeTimers();
    const notices: { id: string | null; notice: MarketNotice }[] = [];
    const handle = streamMarkets(
      '/engine',
      ['eurusd', 'gbpusd'],
      () => new TickWindow({ capacity: 1_000 }),
      () => undefined,
      (id, notice) => notices.push({ id, notice }),
      { eventSource: MuxSource as unknown as typeof EventSource, backoffMs: 10 },
    );
    const source = muxLatest();
    source.open();
    source.frame('gap', { asset: 'eurusd', requested: 100, reason: 'evicted', resumesAt: 140 });
    source.frame('gap', {
      asset: 'gbpusd',
      requested: 5,
      reason: 'never published',
      resumesAt: null,
    });
    source.frame('close', { asset: 'gbpusd', reason: 'asset retired' });
    expect(notices.find((n) => n.id === 'eurusd' && n.notice.kind === 'hole')?.notice).toEqual({
      kind: 'hole',
      from: 100,
      to: 139,
    });
    expect(notices.find((n) => n.id === 'gbpusd' && n.notice.kind === 'gap')?.notice).toEqual({
      kind: 'gap',
      reason: 'never published',
    });
    expect(notices.find((n) => n.id === 'gbpusd' && n.notice.kind === 'retired')).toBeDefined();
    source.fail();
    vi.advanceTimersByTime(10);
    expect(decodeURIComponent(query(muxLatest()))).toBe('?assets=eurusd&onGap=live');
    handle.close();
    vi.useRealTimers();
  });
});
