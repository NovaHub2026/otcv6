import { Logger } from '@nestjs/common';
import type { Tick } from '@otc/core';
import {
  proveFromPublication,
  PublicationWriter,
  publishingKeyFromEnvironment,
  type ChainResumption,
  type PublicationProof,
} from '@otc/distribution';
import { ASSET_CATALOGUE, type RegisteredAsset } from '@otc/engine';
import type { TickRecord } from '@otc/runtime';

/** How a chain stood at boot and what priming from the record did about it (PH-28.3). */
export type ChainPriming =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'continued'; readonly from: number; readonly folded: number }
  | { readonly kind: 'broken'; readonly from: number; readonly recordStartsAt: number | null }
  /**
   * The chain was continued and then seamed (PH-30.4): a jump in the record's
   * sequences, or a market that seamed at this boot. `folded` is what was read
   * back on both sides; `restartedAt` names the sequence the record resumes
   * at, or null when the seam is at the live boundary and its first tick is
   * not yet known. `sealed` counts the windows closed short so the record's
   * own tail is committed rather than abandoned (Cycle Audit 10, a6-03).
   */
  | {
      readonly kind: 'seamed';
      readonly from: number;
      readonly folded: number;
      readonly restartedAt: number | null;
      readonly sealed: number;
    };

/** Ticks read from the record per page while priming; a page is one await. */
const PRIME_PAGE = 100_000;

/**
 * Wiring only. The record-writing lives in `@otc/distribution`'s
 * `PublicationWriter`, because none of it is NestJS-specific and because
 * `tools/sim` can test artefacts written there against `@otc/lab`'s real journal
 * reader — which it could not do for a writer that lived in this app.
 *
 * Publication is **opt-in**: off unless `OTC_PUBLICATION_DIR` is set. When it is
 * set, `OTC_PUBLISHING_KEY` becomes required and the service refuses to start
 * without it. Publishing under an ephemeral identity produces signatures nobody
 * can check against a published one, which is worse than not publishing.
 */
export class PublicationService {
  private readonly logger = new Logger(PublicationService.name);
  private readonly writer: PublicationWriter | null;
  private readonly directory: string | null;

  constructor(
    assets: readonly RegisteredAsset[] = ASSET_CATALOGUE,
    windowTicks = 500,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const directory = env.OTC_PUBLICATION_DIR;
    if (directory === undefined || directory.length === 0) {
      this.writer = null;
      this.directory = null;
      return;
    }
    this.directory = directory;
    this.writer = new PublicationWriter({
      directory,
      windowTicks,
      privateKey: publishingKeyFromEnvironment(env),
      assets: assets.map((asset) => ({
        assetId: asset.definition.id,
        instrumentId: asset.instrument.id,
        logQuantum: asset.instrument.logQuantum,
      })),
    });
    this.logger.log(`Publishing to ${directory}, window ${windowTicks} ticks`);
  }

  get enabled(): boolean {
    return this.writer !== null;
  }

  get publicKey(): string | null {
    return this.writer?.publicKey ?? null;
  }

  observe(assetId: string, ticks: readonly Tick[]): void {
    this.writer?.observe(assetId, ticks);
  }

  /**
   * Commit what is open, because nothing more is coming (Cycle Audit 10, a6-03).
   *
   * A window is committed when it fills, and that is right while the market is
   * running. Where it stops — a clean stop, a retirement — the open window is
   * never extended, so leaving it open serves nobody and costs the record its
   * own tail: the release run abandoned 5,749 served ticks this way, one deploy
   * at a time, and `/proof` answered 409 for them permanently.
   */
  seal(assetId: string): boolean {
    try {
      const sealed = this.writer?.sealChain(assetId) ?? null;
      if (sealed === null) return false;
      this.logger.log(
        `${assetId}: commitment chain sealed at sequence ${sealed.signed.commitment.toSequence} ` +
          `(${sealed.ticks.length} tick(s) in a short final window)`,
      );
      return true;
    } catch (error) {
      // A seal that cannot be written must not stop the venue from stopping.
      // This runs inside `onModuleDestroy`, after the final checkpoint and
      // before the history database is closed, so a throw here — an unmounted
      // volume, a full disk, the very conditions that make a chain worth
      // having — would abandon the rest of the shutdown to save one window.
      // The window is lost, which is the state every SIGKILL already leaves,
      // and the loss is named rather than silent.
      this.logger.error(
        `${assetId}: the commitment chain could not be sealed (${(error as Error).message}). ` +
          `The ticks in its open window stay published and uncommitted, as they would after a ` +
          `kill; the next process folds them back from the record if it can reach them.`,
      );
      return false;
    }
  }

  /** Seal every asset's open window. The shutdown path's one call. */
  sealAll(): void {
    let sealed = 0;
    for (const assetId of this.writer?.assetIds ?? []) {
      if (this.seal(assetId)) sealed += 1;
    }
    if (sealed > 0) this.logger.log(`commitment chains sealed for ${sealed} market(s)`);
  }

  /**
   * The inclusion proof for a published sequence, from the archive (PH-29.1).
   *
   * Read from the directory, never from the writer's memory: what a
   * counterparty can verify is what was written, and a proof built from an
   * open window would prove a commitment nobody has signed yet.
   */
  proofFor(assetId: string, sequence: number): Promise<PublicationProof> {
    if (this.directory === null) return Promise.resolve({ kind: 'not-published' });
    return proveFromPublication(this.directory, assetId, sequence);
  }

  /** How the writer took over an asset's chain, or null when not publishing. */
  resumption(assetId: string): ChainResumption | null {
    return this.writer?.resumption(assetId) ?? null;
  }

  /**
   * Continue the chain across the process boundary (PH-28.3).
   *
   * The writer resumes at the tip of the file; the ticks between that tip and
   * the previous process's death were published, recorded, and never
   * committed. They are read back from the record and observed here, before
   * any live tick, so the chain a broker verifies is one chain per market
   * rather than one per boot. Where the record does not reach the tip — a
   * trim, a seam — the chain cannot be continued honestly and is **not**
   * bridged: the asset's chain is reported broken, logged as an error, and
   * the writer seals what is open and resumes the chain after the gap, so
   * the live ticks are still committed to. A break a verifier can see beats a
   * hole that looks like tampering.
   *
   * **What the seam leaves behind is committed, and the resume is bound
   * (Cycle Audit 10).** The ticks folded into the open window used to be
   * dropped when the chain restarted — served, settled against, and in no
   * committed window for ever (a6-03) — and the new chain began at an empty
   * root, which bound it to the old one by nothing at all (a6-04). Now the
   * open window is sealed first, however short, and the resume link binds the
   * sealed head.
   *
   * **A seam is a break of the same kind (PH-30.4).** A market restarted past
   * its catch-up bound seams: its sequences jump by the lease, and the record
   * keeps both sides. The release run found two things at that jump. Folding
   * the record across it made the publisher refuse the jump and the boot
   * die; and a market that seamed at *this* boot continued its chain to the
   * pre-seam tip and would have refused its first live tick. So the record
   * is folded contiguous run by contiguous run, the chain restarted at each
   * jump, and a market told to be `seamed` has its chain restarted after the
   * fold — the first live tick then opens a new chain, wherever the seam
   * lands it.
   */
  async prime(assetId: string, record: TickRecord, seamed = false): Promise<ChainPriming> {
    if (this.writer === null) return { kind: 'fresh' };
    const resumed = this.writer.resumption(assetId);
    if (resumed === null || resumed.kind !== 'continued') return { kind: 'fresh' };
    let from = resumed.nextSequence;
    const first = await record.since(assetId, from, 1);
    if (first.length === 0 || first[0]!.sequence !== from) {
      const recordStartsAt = first[0]?.sequence ?? null;
      this.logger.error(
        `${assetId}: the commitment chain ends at sequence ${from - 1} and the record ` +
          (recordStartsAt === null ? 'holds nothing after it' : `resumes at ${recordStartsAt}`) +
          ` — the chain cannot be continued, so it is sealed there and resumed after the gap ` +
          `by a link that binds the sealed head. Where the market resumes at a sequence this ` +
          `chain already covers, one chain cannot hold two roots over one range and it ` +
          `restarts at an empty root instead; either way a verifier sees the interval where ` +
          `it is, and whether its near edge is attested (PH-28.3, Cycle Audit 10).`,
      );
      this.writer.seamChain(assetId);
      return { kind: 'broken', from, recordStartsAt };
    }
    let folded = 0;
    let sealed = 0;
    let restartedAt: number | null = null;
    for (;;) {
      const page = await record.since(assetId, from, PRIME_PAGE);
      if (page.length === 0) break;
      let runStart = 0;
      for (let i = 0; i < page.length; i += 1) {
        const expected = i === 0 ? from : page[i - 1]!.sequence + 1;
        const sequence = page[i]!.sequence;
        if (sequence === expected) continue;
        this.writer.observe(assetId, page.slice(runStart, i));
        this.logger.error(
          `${assetId}: the record jumps from sequence ${expected - 1} to ${sequence} — a seam ` +
            `left by a restart past the catch-up bound. The commitment chain is sealed at ` +
            `${expected - 1} and resumed at ${sequence} by a link that binds the sealed head, ` +
            `not bridged; a verifier sees the interval where it is (PH-30.4, Cycle Audit 10).`,
        );
        if (this.seal(assetId)) sealed += 1;
        this.writer.seamChain(assetId);
        restartedAt = sequence;
        runStart = i;
      }
      this.writer.observe(assetId, page.slice(runStart));
      folded += page.length;
      from = page[page.length - 1]!.sequence + 1;
      if (page.length < PRIME_PAGE) break;
    }
    if (seamed) {
      // The jump is ahead, at the first live tick. The chain the record was
      // folded into ends at the record's head; whatever the seam publishes
      // begins a new one.
      this.logger.error(
        `${assetId}: resumed with a seam; the commitment chain is sealed at sequence ` +
          `${from - 1} and the ticks the seam publishes resume it after that, in a link that ` +
          `binds the sealed head (PH-30.4, Cycle Audit 10).`,
      );
      if (this.seal(assetId)) sealed += 1;
      this.writer.seamChain(assetId);
      return { kind: 'seamed', from: resumed.nextSequence, folded, restartedAt, sealed };
    }
    if (restartedAt !== null) {
      return { kind: 'seamed', from: resumed.nextSequence, folded, restartedAt, sealed };
    }
    this.logger.log(
      `${assetId}: commitment chain continued from sequence ${resumed.nextSequence}, ` +
        `${folded} recorded tick(s) folded`,
    );
    return { kind: 'continued', from: resumed.nextSequence, folded };
  }

  /** Begin publishing an asset registered while the service was running. */
  register(asset: RegisteredAsset): void {
    this.writer?.register({
      assetId: asset.definition.id,
      instrumentId: asset.instrument.id,
      logQuantum: asset.instrument.logQuantum,
    });
  }
}
