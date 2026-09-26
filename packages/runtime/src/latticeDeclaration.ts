import { exp } from '@otc/core';
import { frameOfSpan, sameFrame, type LatticeEpoch, type PriceFrame } from './priceFrame.js';
import { type TickRecord } from './tickRecord.js';

/**
 * Declaring what an already-written range of the record counted in (PH-38.2).
 *
 * PH-38.1 made a frame recordable and stopped the bleeding for everything
 * written from then on. It deliberately left the past alone, because a
 * migration runs at open with no catalogue, no operator and no way to check
 * itself, and a guess written durably is worse than today's mistake being
 * recomputed on every read.
 *
 * This module is the other half: a deliberate act, run once, that declares the
 * past **only where the record can corroborate the declaration**.
 *
 * ## The evidence
 *
 * At a relattice boundary the resuming market re-expressed its last published
 * price onto the new lattice, so the price is continuous across the seam even
 * though the integer is not. That gives a test with no free parameters:
 *
 * ```
 * render(last tick before R, candidate old frame) ≈ render(first tick at R, current frame)
 * ```
 *
 * Measured on the live venue at 2026-09-24, across the catalogue of thirty:
 * **median gap 0.0066%, within 0.1% on 30 of 30 assets.** At an ordinary
 * restart seam — where the lattice did not move and both sides are already on
 * the current frame — the same comparison is off by about **30%**. Four orders
 * of magnitude separate the boundary from any other seam, which is what makes
 * this evidence rather than a plausible story, and it is why the band below can
 * be tight without being fragile.
 *
 * The test was found by getting it wrong first. A first pass took the seam ten
 * minutes earlier for the boundary; at that one the integer does not move
 * (`8753 → 8753`) while at the real one it drops by the coarsening factor. A
 * boundary picked by its position in a time window is a guess wearing a
 * measurement's clothes, and the guard for this module is that exact seam.
 */

/**
 * How far apart the two renderings may be and still be called the same price.
 *
 * 0.1% against a ~30% alternative. The gap is not zero because the
 * re-expression rounds to an integer on a coarser lattice — `eurusd-otc`'s
 * measured 0.0024% is one step of rounding, not an error.
 */
export const CONTINUITY_BAND_PERCENT = 0.1;

/**
 * How far the integer's rescale may sit from the quantum ratio.
 *
 * **Continuity alone is not enough, and the live record proved it.** Near the
 * reference price the stored integer is small, `exp(q × price)` is close to 1
 * for *any* quantum, and the continuity test loses all its power: on
 * `usdjpy-otc` three ordinary restart seams passed it at gaps of 0.08–0.09%
 * because their integers were around −190. One of this phase's designs
 * predicted exactly that — "near the reference price the ratios are
 * indistinguishable" — and it happened on the first real run.
 *
 * So a boundary must satisfy a second leg. It is not independent of the first —
 * both compare the same two renderings — but it expresses the comparison as a
 * **ratio** rather than as a difference of exponents, and that changes where it
 * has power. Continuity says the **price** was preserved; this says the
 * **lattice actually moved**:
 *
 * ```
 * price(before) / price(after)  ≈  quantum(after) / quantum(before)
 * ```
 *
 * A restart seam passes the first leg and fails this one at a ratio of ~1.0.
 * Measured: `eurusd-otc` 13.03 against a quantum ratio of 12.92, `usdjpy-otc`
 * 11.644 against 11.427 — under 2% off — while the three false positives sat
 * at 0.964, 0.978 and 1.005. The band is 25% because rounding onto a coarse
 * lattice moves the observed ratio by about `1/|price(after)|`, and because the
 * alternative it must exclude is ratio 1.0 against a smallest real coarsening
 * of 9.10 — 89% away, three and a half times the band.
 *
 * **Each leg covers the other's blind spot, and both are watched failing.**
 * The continuity leg's resolution is `band / (quantum × price)`, so it sharpens
 * as the price moves away from the reference and goes blind at it; the rescale
 * leg's resolution is flat. Near the reference only the rescale leg discriminates
 * (`usdjpy-otc`, four candidate boundaries without it). Far from it — at
 * `dogeusdt-otc` scale, where `quantum × price` is about 2.76 — only the
 * continuity leg does: a frame 10% wrong moves the rendered price by 31.7% and
 * leaves the integer ratio 10% off, which `RESCALE_TOLERANCE` accepts.
 *
 * Together they pin the frame to tens of percent — enough to separate the right
 * one from a wrong-by-a-factor one and from no-change-at-all, and **not** enough
 * to catch one wrong in its last bits. What pins the value exactly is a
 * different guard entirely: `packages/engine/src/lattices.test.ts` compares
 * `LATTICE_BEFORE_PH37` against the previous tag's own catalogue. The two
 * compose; neither alone is a declaration worth writing down.
 */
export const RESCALE_TOLERANCE = 0.25;

/**
 * What a frame renders a stored integer as.
 *
 * The portable `exp`, not the platform one, and for the same reason
 * `toDisplayPrice` uses it: this function decides whether a declaration is
 * written, so a result that differs between machines would make the record's
 * own history depend on which host ran the tool.
 */
export function renderOn(frame: PriceFrame, price: number): number {
  return frame.referencePrice * exp(frame.logQuantum * price);
}

/** A declaration the record corroborates, ready to be written or printed. */
export interface FrameProposal {
  readonly assetId: string;
  /** The first sequence on the current frame. */
  readonly boundarySequence: number;
  readonly boundaryInstant: number;
  /** The frame in force below the boundary. */
  readonly before: PriceFrame;
  /** The frame in force from the boundary on. */
  readonly after: PriceFrame;
  /** The oldest sequence the record still holds, where `before` starts. */
  readonly oldestSequence: number;
  readonly oldestInstant: number;
  /** How far the two renderings differ, as a percentage. */
  readonly gapPercent: number;
  /** The integer's observed rescale across the boundary. */
  readonly rescale: number;
  /** What the rescale must be: the ratio of the two quanta. */
  readonly quantumRatio: number;
  /** The last pre-boundary tick, as it was published. */
  readonly published: number;
  /** The same tick as the venue renders it today — the defect, in one number. */
  readonly renderedToday: number;
  /** How many ticks the declaration explains. */
  readonly ticksCovered: number;
}

export type FrameVerdict =
  | { readonly assetId: string; readonly ok: true; readonly proposal: FrameProposal }
  | { readonly assetId: string; readonly ok: false; readonly refusal: string };

/**
 * What the record can be made to say about `assetId`, or why it cannot.
 *
 * `before` is null for an asset with no entry in the release's frame table —
 * every operator-registered asset outside the compiled catalogue. It is refused
 * by name rather than defaulted, because a default here is exactly the guess
 * this whole phase exists to refuse.
 *
 * Nothing is written. The caller decides.
 */
export async function proposeDeclaration(
  record: TickRecord,
  assetId: string,
  before: PriceFrame | null,
  after: PriceFrame,
): Promise<FrameVerdict> {
  const refuse = (refusal: string): FrameVerdict => ({ assetId, ok: false, refusal });
  if (before === null) {
    return refuse(
      `no frame is recorded for ${assetId} in that release, so what its stored integers ` +
        `counted in is not known. An asset registered after the release has no entry and is ` +
        `refused rather than given the catalogue's current frame.`,
    );
  }
  const oldest = await record.oldest(assetId);
  const head = await record.head(assetId);
  if (oldest === null || head === null) return refuse(`${assetId} has no recorded ticks.`);

  const candidates: FrameProposal[] = [];
  for (const seam of await record.seams(assetId)) {
    if (seam.resumesAtSequence <= oldest) continue;
    const [last] = await record.since(assetId, seam.lastSequence, 1);
    const [first] = await record.since(assetId, seam.resumesAtSequence, 1);
    if (last === undefined || first === undefined) continue;
    if (last.sequence !== seam.lastSequence || first.sequence !== seam.resumesAtSequence) continue;
    const asOld = renderOn(before, last.price);
    const asNew = renderOn(after, first.price);
    const gapPercent = Math.abs(asOld / asNew - 1) * 100;
    if (gapPercent > CONTINUITY_BAND_PERCENT) continue;
    // The second leg. Without it an ordinary restart seam whose prices sit near
    // the reference passes, because there the two quanta render the same.
    const quantumRatio = after.logQuantum / before.logQuantum;
    if (first.price === 0) continue;
    const rescale = last.price / first.price;
    if (Math.abs(rescale / quantumRatio - 1) > RESCALE_TOLERANCE) continue;
    const [oldestTick] = await record.since(assetId, oldest, 1);
    candidates.push({
      assetId,
      boundarySequence: seam.resumesAtSequence,
      boundaryInstant: seam.resumesAtInstant,
      before,
      after,
      oldestSequence: oldest,
      oldestInstant: oldestTick?.instant ?? seam.lastInstant,
      gapPercent,
      rescale,
      quantumRatio,
      published: asOld,
      renderedToday: renderOn(after, last.price),
      ticksCovered: seam.resumesAtSequence - oldest,
    });
  }

  if (candidates.length === 0) {
    return refuse(
      `no seam in ${assetId}'s record both reads continuously across that release's frame ` +
        `change and rescales its integer by the ratio of the two quanta. The usual reason is the ` +
        `expected one: the retained window has advanced past the boundary and the range is gone. ` +
        `Nothing is declared for it.`,
    );
  }
  if (candidates.length > 1) {
    return refuse(
      `${String(candidates.length)} seams in ${assetId}'s record read continuously across that ` +
        `frame change (at ${candidates.map((c) => String(c.boundarySequence)).join(', ')}), so ` +
        `which one is the boundary is ambiguous and nothing is declared for it.`,
    );
  }
  return { assetId, ok: true, proposal: candidates[0]! };
}

/**
 * Extend an asset's earliest frame back over the range below it (PH-38.2).
 *
 * **The case the boundary criterion cannot see, and it is the steady state.**
 * An asset whose retained window has already advanced past a release's frame
 * change holds no tick from before it, so there is no boundary seam to find and
 * `proposeDeclaration` refuses — correctly. But refusing leaves the whole range
 * undeclared, and an undeclared range renders as `null`. For an asset whose
 * record is entirely on the current frame that is **worse than before the
 * phase**: it used to answer a number that happened to be right.
 *
 * The evidence is the venue's own, not a default. `changeInstant` is the
 * newest boundary any *other* asset could be dated at — the instant the release
 * moved the lattices, read off the record rather than assumed — and the asset's
 * oldest retained tick is strictly after it. Nothing in the retained range
 * predates the change, so the frame already declared at the top of the range
 * holds all the way down.
 *
 * Refuses when the asset has no declared frame to extend, when its oldest tick
 * is at or before the change (there is a boundary in range and this is the
 * wrong tool), or when the range is already covered.
 */
export async function proposeBackfill(
  record: TickRecord,
  assetId: string,
  changeInstant: number,
): Promise<FrameVerdict> {
  const refuse = (refusal: string): FrameVerdict => ({ assetId, ok: false, refusal });
  const declared = await record.frames(assetId);
  if (declared.length === 0) {
    return refuse(`${assetId} has no declared frame to extend backwards.`);
  }
  const earliest = declared[0]!;
  const oldest = await record.oldest(assetId);
  if (oldest === null) return refuse(`${assetId} has no recorded ticks.`);
  if (oldest >= earliest.fromSequence) {
    return refuse(`${assetId} is already declared from its oldest retained sequence.`);
  }
  const [oldestTick] = await record.since(assetId, oldest, 1);
  if (oldestTick === undefined) return refuse(`${assetId} has no tick at its oldest sequence.`);
  if (oldestTick.instant <= changeInstant) {
    return refuse(
      `${assetId}'s oldest retained tick is from ${String(oldestTick.instant)}, at or before the ` +
        `frame change at ${String(changeInstant)}, so part of its range predates the change and ` +
        `extending one frame over all of it would be a guess. Nothing is declared for it.`,
    );
  }
  return {
    assetId,
    ok: true,
    proposal: {
      assetId,
      boundarySequence: earliest.fromSequence,
      boundaryInstant: earliest.fromInstant,
      before: earliest,
      after: earliest,
      oldestSequence: oldest,
      oldestInstant: oldestTick.instant,
      gapPercent: 0,
      rescale: 1,
      quantumRatio: 1,
      published: renderOn(earliest, oldestTick.price),
      renderedToday: renderOn(earliest, oldestTick.price),
      ticksCovered: earliest.fromSequence - oldest,
    },
  };
}

/**
 * Date an existing candle store's bars against the record they were folded from
 * (PH-38.4).
 *
 * A bar's four integers came from the record's ticks, so the record can say what
 * they counted in — unless the bar was re-expressed afterwards, which is exactly
 * what happened on the live venue when the candle history was converted by hand
 * after v2.4.0 and the record was not. That leaves a store whose rows are on two
 * different lattices with nothing saying which is which, and a reader that
 * guesses draws prices nobody published.
 *
 * So each bar is compared against the record's own tick at its last sequence,
 * and there are exactly three answers:
 *
 * - the bar's close **equals** that tick's price — the bar is on the record's
 *   frame for that sequence, untouched;
 * - it equals that price **re-expressed** onto another declared frame — the bar
 *   was converted onto that one;
 * - neither — the bar cannot be dated, and nothing is declared over it.
 *
 * A bar whose sequence the record no longer holds cannot be dated either. Both
 * refusals leave the range undeclared, which a read route answers as null rather
 * than as a guess.
 */
export async function dateCandlesAgainstRecord(
  record: TickRecord,
  assetId: string,
  bars: readonly {
    readonly firstSequence: number;
    readonly lastSequence: number;
    readonly close: number;
  }[],
  candidates: readonly PriceFrame[],
): Promise<{
  readonly epochs: readonly LatticeEpoch[];
  readonly dated: number;
  readonly undatable: number;
}> {
  const epochs: LatticeEpoch[] = [];
  let dated = 0;
  let undatable = 0;
  let inForce: PriceFrame | null = null;
  // Read once. It was read per bar, which is a point query per row of a window
  // that can hold twenty thousand of them.
  const recordEpochs = await record.frames(assetId);
  for (const bar of bars) {
    const [tick] = await record.since(assetId, bar.lastSequence, 1);
    const recorded = tick !== undefined && tick.sequence === bar.lastSequence ? tick : null;
    // **`frameOfSpan`, not `frameAtOrBefore` (Cycle Audit 13, a8-01).** This
    // asked for the frame at the bar's *last* sequence, and a bar whose minutes
    // straddle a frame change has its open on one lattice and its close on the
    // other. Dating it by the close declared the whole bar — open, high and low
    // included — on the close's frame, and the epoch was then anchored at the
    // bar's *first* sequence, below the true boundary, so the reader's own
    // crossing test could never see a crossing either: the span sat inside one
    // declared epoch.
    //
    // Measured on the live venue before this fix: **17 of 30 assets** served a
    // 1m bar with a wick no tick ever printed, from 2.3% to **73.0%**
    // (`aix-idx-otc` 1060.30 rendered as 1834.71). It is the shape the PH-38
    // refuters caught in the reader, recurring in the writer.
    //
    // `frameOfSpan` answers null exactly when a boundary falls inside the span,
    // which makes such a bar undatable — four integers in two frames are not
    // prices in either, and that is what PH-38.4 already says to a client.
    const recordFrame =
      recorded === null
        ? null
        : frameOfSpan(recordEpochs, bar.firstSequence, bar.lastSequence, null);
    let frame: PriceFrame | null = null;
    if (recorded !== null && recordFrame !== null) {
      if (bar.close === recorded.price) {
        frame = recordFrame;
      } else {
        for (const candidate of candidates) {
          // What the record's integer becomes on the candidate frame. This is
          // `onLattice`'s arithmetic, and a converted bar matches it exactly
          // because that is how it was converted.
          const ratio = recordFrame.logQuantum / candidate.logQuantum;
          if (bar.close === Math.round(recorded.price * ratio)) {
            frame = candidate;
            break;
          }
        }
      }
    }
    if (frame === null) {
      undatable += 1;
      // A gap in the dating ends the run: the next dated bar starts a new epoch
      // rather than extending one across rows nobody could read.
      inForce = null;
      continue;
    }
    dated += 1;
    if (inForce === null || !sameFrame(inForce, frame)) {
      const [first] = await record.since(assetId, bar.firstSequence, 1);
      // **Only the three frame fields, never a spread.** `frameAtOrBefore`
      // returns a `LatticeEpoch`, which extends `PriceFrame`, so `...frame` put
      // the RECORD epoch's own fromSequence back over this bar's — the new epoch
      // was created at the record's boundary instead of the bar's, collided with
      // an existing row, and `INSERT OR IGNORE` dropped it. The types could not
      // see it because the wider shape is assignable to the narrower one, and
      // the tool's own report looked right: three epochs, plausible sequences.
      // Reading the live chart back through the API is what caught it.
      epochs.push({
        assetId,
        fromSequence: bar.firstSequence,
        fromInstant: first?.instant ?? recorded!.instant,
        logQuantum: frame.logQuantum,
        referencePrice: frame.referencePrice,
        displayPrecision: frame.displayPrecision,
      });
      inForce = frame;
    }
  }
  return { epochs, dated, undatable };
}

/** The two epochs a proposal becomes: the old frame below the boundary, the current one from it. */
export function epochsOf(proposal: FrameProposal): readonly [
  {
    assetId: string;
    fromSequence: number;
    fromInstant: number;
    logQuantum: number;
    referencePrice: number;
    displayPrecision: number;
  },
  {
    assetId: string;
    fromSequence: number;
    fromInstant: number;
    logQuantum: number;
    referencePrice: number;
    displayPrecision: number;
  },
] {
  return [
    {
      assetId: proposal.assetId,
      fromSequence: proposal.oldestSequence,
      fromInstant: proposal.oldestInstant,
      ...proposal.before,
    },
    {
      assetId: proposal.assetId,
      fromSequence: proposal.boundarySequence,
      fromInstant: proposal.boundaryInstant,
      ...proposal.after,
    },
  ];
}
