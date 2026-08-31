import { logPrice, type EpochMillis, type LogPrice, type Tick } from '@otc/core';

/**
 * A published tick journal, and the verdict anyone can recompute from it.
 *
 * INV-009 says a historical outcome must be explainable and reproducible from
 * records. Every verification so far has satisfied that in a weak sense: it ran
 * inside a process that also held the master key, so "reproducible" meant
 * "reproducible by the operator". That is exactly the reproducibility a
 * sceptical counterparty has no reason to accept.
 *
 * The journal is therefore deliberately impoverished. It carries instants,
 * prices and sequence numbers — the three things that were published — and
 * nothing else. No key, no cursor, no latent state, no configuration. A verdict
 * derived from it is derived from what a trader could have recorded themselves,
 * which is the only kind of assurance that survives a dispute.
 */
export interface TickJournal {
  readonly instrumentId: string;
  readonly logQuantum: number;
  readonly ticks: readonly Tick[];
}

/** Serialise a journal to newline-delimited JSON. */
export function writeJournal(journal: TickJournal): string {
  const header = JSON.stringify({
    kind: 'otc-tick-journal',
    version: 1,
    instrumentId: journal.instrumentId,
    logQuantum: journal.logQuantum,
    ticks: journal.ticks.length,
  });
  const lines = journal.ticks.map((tick) =>
    JSON.stringify([tick.sequence, tick.instant, tick.price]),
  );
  return [header, ...lines].join('\n');
}

export class JournalError extends Error {
  constructor(detail: string) {
    super(`Tick journal is unusable: ${detail}`);
    this.name = 'JournalError';
  }
}

/**
 * Read a journal back, refusing anything that is not a coherent record.
 *
 * Refusing matters more here than anywhere else in the project. A journal is the
 * artefact a counterparty checks a settlement against; one that silently tolerated
 * a gap, a reordering or a truncated line would let a dispute be resolved against
 * a record that never happened.
 */
export function readJournal(text: string): TickJournal {
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) throw new JournalError('empty');

  let header: {
    kind?: string;
    version?: number;
    instrumentId?: string;
    logQuantum?: number;
    ticks?: number;
  };
  try {
    header = JSON.parse(lines[0]!) as typeof header;
  } catch {
    throw new JournalError('header is not JSON');
  }
  if (header.kind !== 'otc-tick-journal') throw new JournalError('not a tick journal');
  if (header.version !== 1) throw new JournalError(`unsupported version ${String(header.version)}`);
  if (typeof header.instrumentId !== 'string' || typeof header.logQuantum !== 'number') {
    throw new JournalError('header is missing the instrument');
  }

  const ticks: Tick[] = [];
  let previous: number | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    let row: unknown;
    try {
      row = JSON.parse(lines[i]!);
    } catch {
      throw new JournalError(`line ${i + 1} is not JSON — the record may be truncated`);
    }
    if (!Array.isArray(row) || row.length !== 3) {
      throw new JournalError(`line ${i + 1} is not [sequence, instant, price]`);
    }
    const [sequence, instant, price] = row as [number, number, number];
    if (previous !== null && sequence !== previous + 1) {
      throw new JournalError(
        `sequence ${sequence} follows ${previous} at line ${i + 1}: a journal with a gap cannot ` +
          `settle a dispute, and filling it would invent prices`,
      );
    }
    previous = sequence;
    ticks.push({ sequence, instant: instant as EpochMillis, price: logPrice(price) });
  }
  if (header.ticks !== undefined && header.ticks !== ticks.length) {
    throw new JournalError(`header claims ${header.ticks} ticks, found ${ticks.length}`);
  }
  return { instrumentId: header.instrumentId, logQuantum: header.logQuantum, ticks };
}

/** The series a battery or a settlement consumes, from a journal alone. */
export function journalSeries(journal: TickJournal): {
  instants: Float64Array;
  prices: Int32Array;
} {
  const instants = new Float64Array(journal.ticks.length);
  const prices = new Int32Array(journal.ticks.length);
  for (let i = 0; i < journal.ticks.length; i += 1) {
    instants[i] = journal.ticks[i]!.instant;
    prices[i] = journal.ticks[i]!.price;
  }
  return { instants, prices };
}

/**
 * A fingerprint of the record, so two parties can agree they hold the same one.
 *
 * Deliberately not a cryptographic commitment: it proves agreement, not
 * authenticity. A signed commitment is a genuine product question — it needs a
 * publishing key and a policy for when roots are published — and inventing one
 * here would be worse than naming the gap.
 */
export function journalFingerprint(journal: TickJournal): string {
  // FNV-1a over the published triples. Portable, dependency-free, and its only
  // job is to make an accidental mismatch loud.
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const tick of journal.ticks) {
    mix(tick.sequence);
    mix(tick.instant % 4_294_967_296);
    mix(tick.price);
  }
  return hash.toString(16).padStart(8, '0');
}

/** Price in force at an instant, computed from a journal with no engine. */
export function journalPriceAt(
  journal: TickJournal,
  instant: EpochMillis,
): { price: LogPrice; index: number } | null {
  const ticks = journal.ticks;
  if (ticks.length === 0 || instant < ticks[0]!.instant) return null;
  let low = 0;
  let high = ticks.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (ticks[middle]!.instant <= instant) low = middle;
    else high = middle - 1;
  }
  return { price: ticks[low]!.price, index: low };
}
