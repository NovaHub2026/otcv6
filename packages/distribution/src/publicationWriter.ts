import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { KeyObject } from 'node:crypto';
import type { Tick } from '@otc/core';
import { CommitmentPublisher, type ClosedWindow } from './publisher.js';
import { assertAssetId } from './commitment.js';
import { publicKeyHex, type SignedCommitment } from './signing.js';

/**
 * Writes the published record to disk: journals, and the signed commitment chain.
 *
 * ## One journal file per commitment window
 *
 * The journal format carries its tick count in a header, so it cannot be
 * appended to incrementally without rewriting that header — and a record whose
 * header is rewritten as it grows is one an operator can quietly reshape.
 *
 * A window is complete when it is committed, so its count is known then. Journal
 * and commitment are written together, one pair per window, which makes the
 * archival unit and the verification unit the same thing.
 *
 * Ticks in the open window are published but not yet archived — the same honest
 * state the commitment chain reports.
 *
 * ## Why this is not in the API service
 *
 * None of it is NestJS-specific, and putting it here means `tools/sim` can test
 * the artefacts end to end with `@otc/lab`'s real journal reader. `@otc/api`
 * cannot depend on lab (the allowlist forbids it, correctly — lab carries the
 * planted-defect corpus), so a writer living there could only ever be checked
 * against a reimplementation of the reader, which checks nothing.
 */
export interface AssetPublicationSpec {
  readonly assetId: string;
  /** Written into the journal header, so a reader knows the lattice. */
  readonly instrumentId: string;
  readonly logQuantum: number;
}

export interface PublicationWriterOptions {
  readonly directory: string;
  readonly assets: readonly AssetPublicationSpec[];
  readonly windowTicks: number;
  readonly privateKey: KeyObject;
}

export class PublicationWriter {
  readonly #directory: string;
  readonly #identity: string;
  readonly #publishers = new Map<string, CommitmentPublisher>();
  readonly #specs = new Map<string, AssetPublicationSpec>();
  readonly #windowTicks: number;
  readonly #privateKey: PublicationWriterOptions['privateKey'];

  constructor(options: PublicationWriterOptions) {
    this.#directory = options.directory;
    this.#identity = publicKeyHex(options.privateKey);
    this.#windowTicks = options.windowTicks;
    this.#privateKey = options.privateKey;
    for (const spec of options.assets) this.register(spec);
    // The identity a counterparty verifies against, published beside the record
    // rather than assumed to be known out of band.
    writeFileSync(
      path.join(options.directory, 'publisher.json'),
      `${JSON.stringify({
        kind: 'otc-publisher-identity',
        version: 1,
        publicKey: this.#identity,
        windowTicks: options.windowTicks,
      })}\n`,
    );
  }

  get publicKey(): string {
    return this.#identity;
  }

  /**
   * Begin publishing an asset registered after this writer was built.
   *
   * An operator creating an asset from the panel must not have to restart the
   * service to get a verifiable record of it — a market that trades for an hour
   * before anyone commits to its ticks is an hour of prices nobody can check
   * afterwards, and PH-12 exists so that never happens.
   *
   * A window is per asset, so a new publisher starts at sequence zero of its own
   * journal and disturbs nothing already open.
   */
  register(spec: AssetPublicationSpec): void {
    // Cycle Audit 4, M-5: an unsanitised asset id is a path component. An id of
    // `../../escaped` wrote journals outside the publication directory
    // entirely. `packages/runtime/src/fileStore.ts` already required this shape
    // of a persisted asset; the guard existed and had not been applied here.
    assertAssetId(spec.assetId);
    if (this.#publishers.has(spec.assetId)) {
      throw new RangeError(`Asset ${spec.assetId} is already published by this writer.`);
    }
    mkdirSync(path.join(this.#directory, spec.assetId), { recursive: true });
    this.#specs.set(spec.assetId, spec);
    this.#publishers.set(
      spec.assetId,
      new CommitmentPublisher({
        assetId: spec.assetId,
        windowTicks: this.#windowTicks,
        privateKey: this.#privateKey,
      }),
    );
  }

  /** Consume a published batch; write any windows it closes. */
  observe(assetId: string, ticks: readonly Tick[]): ClosedWindow[] {
    const publisher = this.#publishers.get(assetId);
    const spec = this.#specs.get(assetId);
    if (publisher === undefined || spec === undefined || ticks.length === 0) return [];
    const closed = publisher.observe(ticks);
    for (const window of closed) this.#write(spec, window);
    return closed;
  }

  /** Ticks published but not yet inside a committed window. */
  pendingTicks(assetId: string): number {
    return this.#publishers.get(assetId)?.pendingTicks ?? 0;
  }

  #write(spec: AssetPublicationSpec, window: ClosedWindow): void {
    const { commitment } = window.signed;
    const header = JSON.stringify({
      kind: 'otc-tick-journal',
      version: 1,
      instrumentId: spec.instrumentId,
      logQuantum: spec.logQuantum,
      ticks: window.ticks.length,
    });
    const lines = window.ticks.map((tick) =>
      JSON.stringify([tick.sequence, tick.instant, tick.price]),
    );
    writeFileSync(
      path.join(
        this.#directory,
        spec.assetId,
        `${commitment.fromSequence}-${commitment.toSequence}.journal`,
      ),
      [header, ...lines].join('\n'),
    );
    appendFileSync(
      path.join(this.#directory, spec.assetId, 'commitments.ndjson'),
      `${JSON.stringify(window.signed)}\n`,
    );
  }
}

/** Parse a commitments file. Exported so a verifier needs no private knowledge. */
export function readCommitments(text: string): SignedCommitment[] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SignedCommitment);
}
