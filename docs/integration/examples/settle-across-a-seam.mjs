/**
 * **Settle a real contract across a real seam, against a live venue** — the
 * broker's exact path, with the shipped kernel and nothing mocked.
 *
 * The conformance suite verifies the price *route*; it does not settle anything, and
 * until 2026-09-28 every test of ADR-0021 — the rule this release exists for — ran
 * against a fixture. This closes that: ticks come from the venue's published record
 * by sequence, seams from `GET /markets/:id/seams`, and the contract's window is
 * placed deliberately across the discontinuity.
 *
 *   node examples/settle-across-a-seam.mjs [base url] [asset]
 *
 * It needs a venue that has recorded at least one seam: stop the process for longer
 * than the fifteen-second catch-up bound and start it again on the same state
 * directory, which writes exactly one.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const ID = process.argv[3] ?? 'eurusd-otc';
const { settle, NotSettleableError } = await import('@otc/trading');

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json().catch(() => null) };
};

const seams = (await get(`/markets/${ID}/seams`)).body;
if (!Array.isArray(seams) || seams.length === 0) {
  console.error(`${ID} has recorded no seam, so there is nothing to settle across.`);
  process.exit(2);
}
const seam = seams[0];
console.log(`seam: ${seam.lastSequence}..${seam.resumesAtSequence}  reframes=${seam.reframes}`);

// Ticks either side, by sequence, exactly as a broker archiving the stream would hold them.
const wanted = [];
for (let s = seam.lastSequence - 12; s <= seam.lastSequence; s += 1) wanted.push(s);
for (let s = seam.resumesAtSequence; s <= seam.resumesAtSequence + 12; s += 1) wanted.push(s);
const ticks = [];
for (const s of wanted) {
  const { status, body } = await get(`/markets/${ID}/ticks/${s}`);
  if (status === 200)
    ticks.push({ sequence: body.sequence, instant: body.instant, price: body.price });
}
console.log(`ticks fetched: ${ticks.length} of ${wanted.length} asked (a gap is expected)`);
ticks.sort((a, b) => a.instant - b.instant);

const record = {
  instants: Float64Array.from(ticks.map((t) => t.instant)),
  prices: Int32Array.from(ticks.map((t) => t.price)),
  seams: seams.map((s) => ({
    lastInstant: s.lastInstant,
    resumesAtInstant: s.resumesAtInstant,
    reframes: s.reframes,
  })),
};

// A contract whose window straddles the discontinuity: entry before the last tick,
// expiry after the resume. This is the case the engine refused before ADR-0021.
const entryInstant = seam.lastInstant - 3_000;
const horizonMs = seam.resumesAtInstant - entryInstant + 3_000;
const contract = {
  id: 'live-across-the-seam',
  assetId: ID,
  direction: 'up',
  stake: 10_000,
  entryInstant,
  horizonMs,
  payoutRatio: 0.85,
};
console.log(
  `contract: entry ${entryInstant}, expiry ${entryInstant + horizonMs} — the seam is inside it`,
);

try {
  const s = settle(contract, record);
  console.log('SETTLED:', JSON.stringify(s));
  // And the two prices it used must be what the venue itself answers for those instants.
  for (const [what, at, expected] of [
    ['entry', contract.entryInstant, s.entryPrice],
    ['expiry', contract.entryInstant + contract.horizonMs, s.expiryPrice],
  ]) {
    const { status, body } = await get(`/markets/${ID}/price?at=${at}`);
    const agree = status === 200 && body.price === expected;
    console.log(
      `  ${what}: settle used ${expected}; /price?at= says ${status === 200 ? body.price : status} -> ${agree ? 'AGREE' : 'DISAGREE'}`,
    );
    if (body?.seam)
      console.log(
        `    /price names the seam: ${body.seam.lastSequence}..${body.seam.resumesAtSequence}`,
      );
  }
} catch (error) {
  if (error instanceof NotSettleableError) console.log(`REFUSED: ${error.message}`);
  else throw error;
}
