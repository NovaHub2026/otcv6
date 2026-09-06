import { Logger } from '@nestjs/common';
import type { Tick } from '@otc/core';
import {
  PublicationWriter,
  publishingKeyFromEnvironment,
  type ChainResumption,
} from '@otc/distribution';
import { ASSET_CATALOGUE, type RegisteredAsset } from '@otc/engine';
import type { TickRecord } from '@otc/runtime';

/** How a chain stood at boot and what priming from the record did about it (PH-28.3). */
export type ChainPriming =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'continued'; readonly from: number; readonly folded: number }
  | { readonly kind: 'broken'; readonly from: number; readonly recordStartsAt: number | null };

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

  constructor(
    assets: readonly RegisteredAsset[] = ASSET_CATALOGUE,
    windowTicks = 500,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const directory = env.OTC_PUBLICATION_DIR;
    if (directory === undefined || directory.length === 0) {
      this.writer = null;
      return;
    }
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
   * the writer is told to start a new chain at an empty root so the live
   * ticks are still committed to. A break a verifier can see beats a hole
   * that looks like tampering.
   */
  async prime(assetId: string, record: TickRecord): Promise<ChainPriming> {
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
          ` — the chain cannot be continued and is restarted at an empty root; a verifier ` +
          `will see two chains for this market, which is the truth (PH-28.3).`,
      );
      this.writer.restartChain(assetId);
      return { kind: 'broken', from, recordStartsAt };
    }
    let folded = 0;
    for (;;) {
      const page = await record.since(assetId, from, PRIME_PAGE);
      if (page.length === 0) break;
      this.writer.observe(assetId, page);
      folded += page.length;
      from = page[page.length - 1]!.sequence + 1;
      if (page.length < PRIME_PAGE) break;
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
