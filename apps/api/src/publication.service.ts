import { Logger } from '@nestjs/common';
import type { Tick } from '@otc/core';
import { PublicationWriter, publishingKeyFromEnvironment } from '@otc/distribution';
import { ASSET_CATALOGUE, type RegisteredAsset } from '@otc/engine';

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

  /** Begin publishing an asset registered while the service was running. */
  register(asset: RegisteredAsset): void {
    this.writer?.register({
      assetId: asset.definition.id,
      instrumentId: asset.instrument.id,
      logQuantum: asset.instrument.logQuantum,
    });
  }
}
