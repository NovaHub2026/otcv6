'use client';

import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Tick } from '@otc/core/browser';
import { fetchHistory, type CatalogueEntry } from '../../lib/api.js';
import { priceFormatFor, toDisplayedPrice } from '../../lib/priceFormat.js';
import {
  bucketStart,
  displayPrice,
  LiveBarBuilder,
  panelTimeframe,
  toBars,
  type HistoryCandle,
  type PanelTimeframeId,
} from '@otc/chart';

/**
 * One asset, one timeframe: stored history, then the live edge.
 *
 * The component does as little as a component can. Every decision that could be
 * silently wrong — which bucket a tick belongs to, whether a bar may narrow,
 * whose bar the join belongs to — is in the bar bridge, framework-free and
 * tested. What is left here is mounting a chart, fetching a window, and
 * forwarding ticks.
 *
 * ## The join, and what it costs a viewer
 *
 * A bucket that had already begun when this client connected belongs to the
 * record, not to us: rebuilding it from the fragment that arrived afterwards
 * would draw a different bar, for the same minute, to this viewer only
 * (INV-002, Cycle Audit 6 CA6-30).
 *
 * Held strictly, that leaves a **one-hour chart motionless for up to an hour**,
 * which is what the Human Owner saw and reported. So the candles stay truthful
 * and the movement is shown where it is honest: a **price line at the last
 * published tick**, updated on every one. Nothing there is invented — it is the
 * last integer the record holds, converted once — and no candle is ever drawn
 * from a fragment.
 *
 * ## When the stream breaks (a6-11)
 *
 * The first version handed reconnection to the browser's `EventSource`, which
 * retries with `Last-Event-ID`. After the replay window has moved on the engine
 * answers that with a 400, and the `EventSource` algorithm closes for good on
 * any non-200: the status read "reconnecting" for ever over stale candles. So
 * the component reconnects itself, and it does so the only honest way — it
 * **refetches the history and opens a new stream from now**, with backoff. The
 * bars are the record's again, the builder starts at the new join, and the
 * status says the view was reconnected after a gap.
 *
 * ## When the stream is silent (a6-18)
 *
 * A stalled market keeps its stream open and sends nothing, so `live` was true
 * of the socket and false of the market. Now the status flips when no tick has
 * arrived for {@link STALL_MULTIPLE} times this asset's mean interval, and
 * flips back on the next tick. The shell's health line carries the venue's own
 * reason.
 *
 * ## The `data-testid` attributes
 *
 * There are three, and they exist because the first browser test selected the
 * price by its colour. A panel that can only be tested by matching a hex code
 * is a panel whose tests break when someone changes a theme — and the whole
 * reason this layer is being covered at all is that nothing else could see it.
 */

/** Quiet for this many mean intervals and the status stops saying `live`. */
export const STALL_MULTIPLE = 3;
/** Delay before the first reconnect; doubles per consecutive failure. */
/** One minute, the record's permanent base tier. */
const MINUTE_MS = 60_000;

/** How often the record is re-read for a bucket the stream could not join. */
const RESEED_INTERVAL_MS = 15_000;

const RECONNECT_BACKOFF_MS = 1_000;
const MAX_RECONNECT_BACKOFF_MS = 30_000;

export function PreviewChart({
  apiBase,
  asset,
  timeframeId,
}: {
  apiBase: string;
  asset: CatalogueEntry;
  timeframeId: PanelTimeframeId;
}): ReactElement {
  const container = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [status, setStatus] = useState<string>('loading');
  const [bars, setBars] = useState<number>(0);
  const [last, setLast] = useState<{ price: number; at: number } | null>(null);
  /**
   * The bucket the chart is currently drawing live, if any.
   *
   * This is a test seam before it is an operator's convenience, and it exists
   * because the defect it guards is invisible to every other one. A candle is
   * painted on a canvas: no DOM assertion can read its open, its close, or
   * whether it moved. So "the price line moves and the newest candle stands
   * still" — reported twice by the Human Owner on 2026-09-02 — could be
   * reproduced by hand and by nothing else.
   *
   * What it publishes is the one fact that separates the defect from correct
   * behaviour: **which bucket has a live bar**. When the panel is drawing the
   * bucket now forming, the defect is absent by construction.
   */
  const [forming, setForming] = useState<{ time: number; close: number } | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const created = createChart(element, {
      layout: { background: { color: '#0b0e14' }, textColor: '#8b93a7' },
      grid: { vertLines: { color: '#161b26' }, horzLines: { color: '#161b26' } },
      rightPriceScale: { borderColor: '#242c3d' },
      timeScale: { borderColor: '#242c3d', timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    chart.current = created;
    series.current = created.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderVisible: false,
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
      // Derived, never chosen. A hard-coded `minMove: 1e-8` against a precision
      // of 7 printed `1.91146.5` on the axis — two decimal points, from the
      // library left-padding a non-integer to seven characters and slicing
      // through its own decimal point (`../../lib/priceFormat.ts`).
      priceFormat: priceFormatFor(asset),
      // One price on the axis, and it is the live one.
      //
      // The series drew its own last-value label as well: the close of the last
      // *complete* candle, which stands still while the live line moves, because
      // a bar is only updated for a bucket this client watched from its start.
      // Both were correct and neither was labelled, which reads as a
      // contradiction — reported as one on 2026-09-02.
      lastValueVisible: false,
      priceLineVisible: false,
    });
    return () => {
      created.remove();
      chart.current = null;
      series.current = null;
    };
    // Keyed on the asset, not on its display precision. Four of the five assets
    // in the catalogue share a precision, so keying on that kept the chart
    // across a switch — carrying the previous asset's price format and data
    // until the next fetch returned.
  }, [asset.id, asset.displayPrecision]);

  useEffect(() => {
    const target = series.current;
    if (target === null) return;
    const frame = panelTimeframe(timeframeId);
    const controller = new AbortController();
    let stream: EventSource | null = null;
    let priceLine: IPriceLine | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    /** Consecutive failures since the last open; the backoff exponent. */
    let failures = 0;
    /** Whether this view has been through a reconnect. */
    let afterGap = false;

    /**
     * What this **connection** learned about its own join, and nothing more.
     *
     * It is an object replaced by each attempt rather than a boolean reset by
     * each attempt, and that is the whole point. As a boolean it was a latch:
     * `run()` is re-entered by {@link retryLater} on every stream error, each
     * attempt builds a fresh `LiveBarBuilder` that assumes an exact join, and
     * the gap handler's own `if (!joinExact) return` guard then suppressed the
     * correction on the second gap. The panel went on folding post-hole ticks
     * onto a record seed — the one thing CA6-30 forbids — while the status bar
     * said the candle was coming from the record. Reachable on the path the
     * decision log itself describes: the engine restarts, the stream drops, the
     * feed still cannot replay.
     *
     * A fresh object per attempt cannot inherit a previous attempt's verdict,
     * so there is no state to forget to reset. Found by the PH-21 closure audit
     * before this reached `main`.
     */
    let connection: { joinExact: boolean } = { joinExact: true };
    let reseedTimer: ReturnType<typeof setInterval> | null = null;
    const stopReseeding = (): void => {
      if (reseedTimer !== null) clearInterval(reseedTimer);
      reseedTimer = null;
    };

    const liveStatus = (): string => {
      if (!connection.joinExact) {
        return 'live — the forming candle is the record, re-read each minute';
      }
      return afterGap ? 'live — reconnected after a gap' : 'live';
    };

    const armStall = (): void => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      const quietMs = STALL_MULTIPLE * asset.meanIntervalMs;
      stallTimer = setTimeout(() => {
        if (cancelled) return;
        setStatus(
          `no tick for ${(quietMs / 1000).toFixed(0)}s — ${STALL_MULTIPLE}× this market's ` +
            `mean interval; check the engine's health`,
        );
      }, quietMs);
    };

    const retryLater = (why: string): void => {
      if (cancelled) return;
      failures += 1;
      afterGap = true;
      const inMs = Math.min(RECONNECT_BACKOFF_MS * 2 ** (failures - 1), MAX_RECONNECT_BACKOFF_MS);
      setStatus(`${why} — reconnecting in ${(inMs / 1000).toFixed(0)}s (attempt ${failures})`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void run().catch((error: unknown) => {
          retryLater((error as Error).message);
        });
      }, inMs);
    };

    const run = async (): Promise<void> => {
      // A new attempt, and therefore a new join to establish. The previous
      // attempt's interval belongs to a builder this one is about to replace.
      const self = { joinExact: true };
      connection = self;
      stopReseeding();
      setStatus(afterGap ? 'reloading history after a gap' : 'loading history');
      const to = Date.now();
      const from = to - frame.defaultSpanMs;
      const history = await fetchHistory(
        apiBase,
        asset.id,
        timeframeId,
        from,
        to,
        controller.signal,
      );
      if (cancelled) return;

      setForming(null);
      const drawn = toBars(history.candles, asset);
      target.setData(drawn.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })));
      setBars(drawn.length);
      chart.current?.timeScale().fitContent();

      // Resume the stream exactly where the history stops, so the bucket now
      // forming is one this client holds from its first tick.
      //
      // Without it the newest bar cannot move until the next boundary — up to
      // a full hour on the default one-hour chart — while the live price line
      // drifts away from a candle that never follows it. Reported on
      // 2026-09-02 as "the price moves and the candle stands still", which was
      // two correct rules producing a wrong screen: CA6-30 forbids rebuilding a
      // bucket from a partial view, and a resumed stream is not partial.
      //
      // There is no longer a "refused resume" state to carry between attempts.
      // There used to be: an `EventSource` cannot read a status code, so a 400
      // arrived as an error before `onopen`, and the next attempt dropped the
      // resume point and fell back to the conservative rule — which is what
      // froze the candle for a whole bucket. The client asks the engine to tell
      // it about a gap rather than refuse it (`onGap=live`), so the case is
      // answered on the connection that met it instead of on the one after.
      const newest = history.candles[history.candles.length - 1];

      // What this client can prove it holds of the bucket now forming.
      //
      // Two correct rules used to produce a wrong screen: CA6-30 forbids
      // rebuilding a bucket from a partial view, so the newest bar could not
      // move until the next boundary — up to a full hour on the default
      // one-hour chart, while the live price line drifted away from a candle
      // that never followed it (reported 2026-09-02).
      //
      // Neither rule has to give. The record *has* the bucket: as complete
      // minute bars, its permanent base tier. Folding those in is the record
      // read finer than the chart draws, and resuming the stream at the tick
      // after the last of them supplies the rest exactly — so the feed need
      // only remember one minute rather than one hour, which is what makes
      // this survive an engine restart.
      // One clock read, used for both the bucket being seeded and the instant
      // the builder treats as "when this client connected".
      //
      // They were two reads separated by an awaited network round trip. A
      // bucket boundary landing inside that window put them in different
      // buckets, and then neither could draw: the re-seed loop exited at once
      // because the bucket had rolled, while the builder refused the new
      // bucket because it had begun at or before `openedAt`. One live bar lost
      // to a race — the very defect this code exists to prevent, in its
      // narrowest form. Found by the PH-21 closure audit.
      const openedAt = Date.now();
      const bucketNow = bucketStart(openedAt, frame.durationMs);
      const readSeed = async (): Promise<readonly HistoryCandle[]> => {
        if (frame.durationMs <= MINUTE_MS) return [];
        const minutes = await fetchHistory(
          apiBase,
          asset.id,
          '1m',
          bucketNow,
          Date.now(),
          controller.signal,
        );
        return minutes.candles.filter(
          (bar) => bucketStart(bar.openInstant, frame.durationMs) === bucketNow,
        );
      };

      // Read whether or not the stream can resume. The seed is the record
      // either way, and when the replay window cannot reach back to where the
      // record stops it is the *only* honest account of the bucket now forming.
      let seed = await readSeed();
      if (cancelled) return;

      let resumeFrom: number | null = null;
      const lastMinute = seed[seed.length - 1];
      if (lastMinute !== undefined) resumeFrom = lastMinute.lastSequence + 1;
      // A one-minute chart needs no seed: the bucket after the newest history
      // bar begins at the tick the resume starts from.
      if (resumeFrom === null && newest !== undefined) resumeFrom = newest.lastSequence + 1;

      const historyThrough =
        newest === undefined ? null : bucketStart(newest.openInstant, frame.durationMs);
      const builder = new LiveBarBuilder(
        frame.durationMs,
        asset,
        historyThrough,
        openedAt,
        resumeFrom,
      );
      const draw = (): void => {
        const bar = builder.current();
        if (bar === null) return;
        target.update({ ...bar, time: bar.time as UTCTimestamp });
        setForming({ time: bar.time, close: bar.close });
      };
      const applySeed = (): void => {
        const through = seed[seed.length - 1];
        if (through === undefined) return;
        builder.seedFrom(seed, through.lastSequence);
        draw();
      };
      applySeed();

      if (!asset.live) {
        setStatus('history only — this market is not hosted');
        return;
      }

      // A new stream from now, never a resume: the history was just refetched,
      // so the record is current and the builder's join is this connection's.
      //
      // `onGap=live` is what stops a refused resume from costing a whole
      // bucket. The feed keeps a bounded window of ticks, and a restart empties
      // it while the candle record keeps everything — so the sequence after the
      // newest stored minute is routinely *older* than anything the feed still
      // has. Refused, the client fell back to drawing no live bar at all: the
      // price line moved and the newest candle stood still for up to an hour.
      // Reported on 2026-09-02, and reproduced by hosted CI as five `400`s on
      // `?from=` (run 33689094040). Asking to be told instead yields the live
      // edge plus an explicit `gap` event, which the handler below answers by
      // drawing the bucket from the record rather than from a hole.
      const opened = new EventSource(
        resumeFrom === null
          ? `${apiBase}/markets/${asset.id}/stream`
          : `${apiBase}/markets/${asset.id}/stream?from=${resumeFrom}&onGap=live`,
      );
      stream = opened;
      // The engine could not replay from where the record stops, and said so.
      // The bucket now forming is then the record's alone: this client's ticks
      // begin after a hole, so folding them onto the seed would draw one bar
      // out of two pieces. Instead the seed is re-read while the bucket lasts —
      // every completed minute widens it — and the price line carries the live
      // edge, which is exactly what it carries when the resume succeeds.
      //
      // Note what this does *not* do: it does not decide whether the bar may
      // absorb ticks. `LiveBarBuilder` was given the sequence this connection
      // asked for and checks the answer itself, so a gap nobody noticed is
      // still refused. This handler is the earlier of the two signals — it
      // arrives before any tick — and it drives what the viewer is told and
      // when the record starts being re-read.
      const recordOnly = (): void => {
        if (cancelled || !self.joinExact) return;
        self.joinExact = false;
        setStatus(liveStatus());
        applySeed();
        // One interval per connection. A reconnect that gapped again used to
        // leave the previous attempt's interval running against the previous
        // attempt's builder, redrawing a bar nothing owned any more.
        stopReseeding();
        reseedTimer = setInterval(() => {
          if (cancelled) return;
          // Once the bucket has rolled, this client holds the new one from its
          // first tick and `accept` builds it. Re-seeding then would overwrite
          // a bar it owns with the record's partial view of it.
          if (bucketStart(Date.now(), frame.durationMs) !== bucketNow) {
            stopReseeding();
            return;
          }
          void readSeed()
            .then((fresh) => {
              if (cancelled || fresh.length === 0) return;
              seed = fresh;
              applySeed();
            })
            .catch(() => {
              // A failed refresh leaves the last good bar drawn. The stall
              // watchdog already speaks for a market that has gone quiet.
            });
        }, RESEED_INTERVAL_MS);
      };
      opened.addEventListener('gap', recordOnly);
      opened.onopen = (): void => {
        failures = 0;
        setStatus(liveStatus());
        armStall();
      };
      opened.onmessage = (event: MessageEvent<string>): void => {
        const tick = JSON.parse(event.data) as Tick;
        // Rounded to the digits this asset settles on: the conversion is a
        // full-precision float, and a digit past `displayPrecision` is a
        // movement no contract can settle against.
        const price = toDisplayedPrice(displayPrice(tick.price, asset), asset.displayPrecision);
        setLast({ price, at: tick.instant });
        setStatus(liveStatus());
        armStall();

        // The live price, on every tick, at every timeframe. This is the last
        // integer the record holds, converted once, and nothing else.
        if (priceLine === null) {
          priceLine = target.createPriceLine({
            price,
            color: '#e3b341',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'live',
          });
        } else {
          priceLine.applyOptions({ price });
        }

        // And a candle only for a bucket this client watched from its start.
        const bar = builder.accept(tick);
        if (bar !== null) {
          target.update({ ...bar, time: bar.time as UTCTimestamp });
          setForming({ time: bar.time, close: bar.close });
        }
        // The second signal, and the one that does not depend on being told.
        // The builder compares the sequence it asked to resume at against the
        // first tick it actually received; if they differ the stream did not
        // continue the record, whether or not a `gap` event said so.
        if (builder.joinBroken()) recordOnly();
      };
      opened.onerror = (): void => {
        // Ours to handle, not the browser's: its own retry would carry a
        // `Last-Event-ID` the engine may refuse, and then stop for good.
        opened.close();
        if (stream !== opened) return;
        stream = null;
        if (stallTimer !== null) clearTimeout(stallTimer);
        retryLater('stream interrupted');
      };
    };

    void run().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStatus((error as Error).message);
    });

    return () => {
      cancelled = true;
      controller.abort();
      stream?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (stallTimer !== null) clearTimeout(stallTimer);
      stopReseeding();
      // **Disposed by the time this runs.** React cleans effects up in the
      // order they were declared, so the effect that owns the chart has already
      // called `remove()` when the asset changes — and every method on a
      // removed series throws `Object is disposed`, which surfaced as a console
      // error on every switch. The price line dies with the chart; there is
      // nothing to release.
      if (priceLine !== null && chart.current !== null) target.removePriceLine(priceLine);
    };
  }, [apiBase, asset, timeframeId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/*
        The chart is mounted into an absolutely positioned box inside a
        relatively positioned one. A chart container has no intrinsic height, so
        anything that sizes to its content collapses it to zero — which is
        exactly what happened: the panel drew an asset list beside an empty
        rectangle while the candles arrived over the network. `inset: 0` takes
        the question away from the layout entirely.
      */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div data-testid="chart" ref={container} style={{ position: 'absolute', inset: 0 }} />
      </div>
      <div
        style={{
          padding: '6px 10px',
          fontSize: 12,
          color: '#8b93a7',
          borderTop: '1px solid #242c3d',
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <span
          data-testid="stream-status"
          style={{ color: status.startsWith('live') ? '#3fb950' : '#8b93a7' }}
        >
          {status}
        </span>
        {last !== null && (
          <span style={{ color: '#e3b341' }}>
            {/*
              The price and the clock are separate elements, and that is a test
              interface decision as much as a layout one. When they shared one,
              a browser assertion that "the price changes" passed against a
              **frozen price**, because the second was ticking inside the same
              text node. The plant that proved it is in PH-20.1.
            */}
            <span data-testid="last-price">{last.price.toFixed(asset.displayPrecision)}</span>{' '}
            <span data-testid="last-price-at" style={{ color: '#5b6377' }}>
              {new Date(last.at).toLocaleTimeString(undefined, { hour12: false })}
            </span>
          </span>
        )}
        <span data-testid="bar-count">{bars.toLocaleString()} bars</span>
        <span data-testid="forming-bucket" style={{ color: '#5b6377' }}>
          {forming === null ? 'no live bar' : `live bar ${String(forming.time)}`}
        </span>
        <span>quantum {asset.logQuantum.toExponential(3)}</span>
        <span>tie rate {(100 * asset.tieRate).toFixed(2)}%</span>
        <span>quarterly spread {(100 * asset.dispersion.quarterlyPercent).toFixed(1)}%</span>
      </div>
    </div>
  );
}
