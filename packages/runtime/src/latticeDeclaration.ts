import { exp } from '@otc/core';
import { type PriceFrame } from './priceFrame.js';
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
