import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { KeyObject } from 'node:crypto';
import type { Tick } from '@otc/core';
import { CommitmentPublisher, type ClosedWindow } from './publisher.js';
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

  constructor(options: PublicationWriterOptions) {
    this.#directory = options.directory;
    this.#identity = publicKeyHex(options.privateKey);
    for (const spec of options.assets) {
      mkdirSync(path.join(options.directory, spec.assetId), { recursive: true });
      this.#specs.set(spec.assetId, spec);
      this.#publishers.set(
        spec.assetId,
        new CommitmentPublisher({
          assetId: spec.assetId,
          windowTicks: options.windowTicks,
          privateKey: options.privateKey,
        }),
      );
    }
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
