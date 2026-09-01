// Invariant evidence: INV-009 (reproducible settlement), INV-010 (private generator state).
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { epochMillis, logPrice, MasterKeyring, type Tick } from '@otc/core';
import { ASSET_CATALOGUE, configFor, createMarketEngine } from '@otc/engine';
import {
  proveInclusion,
  publicKeyHex,
  publishingKeyFromSeed,
  PublicationWriter,
  readCommitments,
  verifyInclusion,
  verifySignedChain,
} from '@otc/distribution';
import { journalPriceAt, readJournal } from '@otc/lab';

/**
 * A counterparty checks a settlement using only what the operator published.
 *
 * This is the test PH-9.3 could not write. It built a verdict recomputable from
 * a journal and recorded that **nothing produced one** — every check it ran was
 * against journals written by tests. A commitment scheme over a record nothing
 * publishes is a scheme over nothing.
 *
 * So the run below produces real artefacts on disk from a real engine, and then
 * puts on the counterparty's hat: read the directory, hold the public key, and
 * establish that a specific tick was in the operator's committed record. No
 * engine, no private key, no cooperation from the operator at verification time.
 */

const SEED = '5a'.repeat(32);
const WINDOW = 200;

function publish(assetIndex: number, batches: number, batchSize: number) {
  const asset = ASSET_CATALOGUE[assetIndex]!;
  const directory = mkdtempSync(path.join(tmpdir(), 'otc-publication-'));
  const key = publishingKeyFromSeed(SEED);
  const writer = new PublicationWriter({
    directory,
    windowTicks: WINDOW,
    privateKey: key,
    assets: [
      {
        assetId: asset.definition.id,
        instrumentId: asset.instrument.id,
        logQuantum: asset.instrument.logQuantum,
      },
    ],
  });

  const engine = createMarketEngine({
    config: configFor(asset),
    keyring: MasterKeyring.forTesting(`publication-${asset.definition.id}`),
    environment: 'simulation',
    start: { instant: epochMillis(1_776_000_000_000), price: logPrice(0) },
  });

  const produced: Tick[] = [];
  for (let batch = 0; batch < batches; batch += 1) {
    const ticks: Tick[] = [];
    for (let i = 0; i < batchSize; i += 1) {
      const tick = engine.next();
      if (tick === null) break;
      ticks.push(tick);
    }
    produced.push(...ticks);
    writer.observe(asset.definition.id, ticks);
  }
  return { asset, directory, produced, identity: publicKeyHex(key), writer };
}

describe('a counterparty verifies from the published directory alone', () => {
  const { asset, directory, produced, identity, writer } = publish(0, 40, 37);
  const assetDir = path.join(directory, asset.definition.id);

  it('publishes the identity to verify against, beside the record', () => {
    const published = JSON.parse(readFileSync(path.join(directory, 'publisher.json'), 'utf8')) as {
      kind: string;
      publicKey: string;
      windowTicks: number;
    };
    expect(published.kind).toBe('otc-publisher-identity');
    expect(published.publicKey).toBe(identity);
    expect(published.windowTicks).toBe(WINDOW);
  });

  it('publishes a signed chain that verifies end to end', () => {
    const chain = readCommitments(readFileSync(path.join(assetDir, 'commitments.ndjson'), 'utf8'));
    expect(chain.length).toBeGreaterThan(5);
    expect(verifySignedChain(chain, identity)).toBeNull();
  });

  it('writes one journal per commitment, and lab reads them', () => {
    // The API cannot depend on lab, so format compatibility cannot be enforced
    // by a shared import. It is enforced here instead, by the real reader —
    // which refuses gaps, reordering and truncation.
    const chain = readCommitments(readFileSync(path.join(assetDir, 'commitments.ndjson'), 'utf8'));
    const journals = readdirSync(assetDir).filter((name) => name.endsWith('.journal'));
    expect(journals).toHaveLength(chain.length);

    for (const link of chain) {
      const { commitment } = link;
      const text = readFileSync(
        path.join(assetDir, `${commitment.fromSequence}-${commitment.toSequence}.journal`),
        'utf8',
      );
      const journal = readJournal(text);
      expect(journal.ticks).toHaveLength(commitment.count);
      expect(journal.instrumentId).toBe(asset.instrument.id);
      expect(journal.ticks[0]!.sequence).toBe(commitment.fromSequence);
    }
  });

  it('proves a specific tick was in the committed record', () => {
    // The whole point. A trader disputing one contract holds a tick, a proof and
    // a public key, and establishes that the operator committed to it.
    const chain = readCommitments(readFileSync(path.join(assetDir, 'commitments.ndjson'), 'utf8'));
    const link = chain[3]!;
    const journal = readJournal(
      readFileSync(
        path.join(
          assetDir,
          `${link.commitment.fromSequence}-${link.commitment.toSequence}.journal`,
        ),
        'utf8',
      ),
    );
    const failures: number[] = [];
    for (const tick of journal.ticks) {
      const proof = proveInclusion(journal.ticks, tick.sequence);
      if (!verifyInclusion(link.commitment, proof)) failures.push(tick.sequence);
    }
    expect(failures).toEqual([]);
    expect(verifySignedChain([link], identity)).toBeNull();
  });

  it('answers the settlement question from the journal, with no engine', () => {
    const chain = readCommitments(readFileSync(path.join(assetDir, 'commitments.ndjson'), 'utf8'));
    const link = chain[2]!;
    const journal = readJournal(
      readFileSync(
        path.join(
          assetDir,
          `${link.commitment.fromSequence}-${link.commitment.toSequence}.journal`,
        ),
        'utf8',
      ),
    );
    const middle = journal.ticks[Math.floor(journal.ticks.length / 2)]!;
    const answer = journalPriceAt(journal, middle.instant);
    expect(answer?.price).toBe(middle.price);
  });

  it('archives every committed tick and no uncommitted one', () => {
    const chain = readCommitments(readFileSync(path.join(assetDir, 'commitments.ndjson'), 'utf8'));
    const archived = chain.reduce((sum, link) => sum + link.commitment.count, 0);
    const pending = writer.pendingTicks(asset.definition.id);
    expect(archived + pending).toBe(produced.length);
    expect(pending).toBeLessThan(WINDOW);
    // Windows tile the record from its first tick with no gap.
    expect(chain[0]!.commitment.fromSequence).toBe(produced[0]!.sequence);
    expect(chain[chain.length - 1]!.commitment.toSequence).toBe(produced[archived - 1]!.sequence);
  });

  it('detects a tampered journal, which is the reason any of this exists', () => {
    const chain = readCommitments(readFileSync(path.join(assetDir, 'commitments.ndjson'), 'utf8'));
    const link = chain[1]!;
    const journal = readJournal(
      readFileSync(
        path.join(
          assetDir,
          `${link.commitment.fromSequence}-${link.commitment.toSequence}.journal`,
        ),
        'utf8',
      ),
    );
    // An operator rewrites one price after the fact — the move that decides a
    // disputed settlement in their favour.
    const tampered = journal.ticks.map((tick, i) =>
      i === 5 ? { ...tick, price: logPrice(tick.price + 40) } : tick,
    );
    const proof = proveInclusion(tampered, tampered[5]!.sequence);
    expect(verifyInclusion(link.commitment, proof)).toBe(false);
  });
});
