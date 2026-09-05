// Invariant evidence: INV-002 (shared market), INV-010 (private generator state).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FileStateStore } from './fileStore.js';
import { CorruptRecordError } from './state.js';

/**
 * The shipped store's refusal of a corrupt state file (Cycle Audit 9, a6-02).
 *
 * `load` throws `CorruptRecordError` on a file that does not parse, and the
 * docstring says why: reporting it as absent would restart the market at
 * genesis and re-consume keystream from block zero — a second market under
 * the same id (INV-002), from the same private state (INV-010). The refusal
 * was in the code and in no test: a `load` that returned `null` on a parse
 * error passed every unit test in the repository.
 */
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function storeWith(files: Record<string, string>): Promise<FileStateStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'otc-filestore-'));
  directories.push(directory);
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(directory, name), text);
  }
  return new FileStateStore(directory);
}

describe('FileStateStore.load', () => {
  it('reports a missing file as no record', async () => {
    const store = await storeWith({});
    await expect(store.load('eurusd-otc')).resolves.toBeNull();
  });

  it('refuses a file that does not parse, by name, rather than reading it as no record', async () => {
    const store = await storeWith({ 'eurusd-otc.json': '{"snapshot": {"sequence": 41' });
    await expect(store.load('eurusd-otc')).rejects.toBeInstanceOf(CorruptRecordError);
    await expect(store.load('eurusd-otc')).rejects.toThrow(/eurusd-otc/);
  });

  it('refuses a file that parses to something other than a record', async () => {
    const store = await storeWith({ 'eurusd-otc.json': '"a string"' });
    await expect(store.load('eurusd-otc')).rejects.toBeInstanceOf(CorruptRecordError);
    const empty = await storeWith({ 'eurusd-otc.json': '' });
    await expect(empty.load('eurusd-otc')).rejects.toBeInstanceOf(CorruptRecordError);
  });
});
