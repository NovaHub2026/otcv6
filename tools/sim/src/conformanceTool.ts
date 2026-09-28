import { createPublicKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { conformance, renderConformance } from '@otc/client';

/**
 * `npm run conformance -- --base http://host:port [--key HEX] [--out report.md] [--ticks N]`
 *
 * The integration checklist, run against a live venue (PH-29.3): exit 0 when
 * every check passes, 1 when one does not, 2 on a usage error. The report is
 * written to `--out` or printed.
 *
 * **`--key` is the publisher key you were told out of band** (Cycle Audit 10,
 * a4-03) — the one in the operator's `publisher.json`, handed over the way an
 * identity is handed over, never read back from the venue being checked.
 * Without it the suite can only check a served proof's signature against the
 * key the venue shipped beside it, which any venue can choose; the report
 * says so above its table, and the proof row is named for what it did check.
 *
 * **The key is the one the engine publishes, in the shape it publishes it**
 * (2026-09-28). This demanded 64 hex characters — the length of the *seed* in
 * `OTC_PUBLISHING_KEY` — while an engine publishes its identity as the DER SPKI
 * form, 88 hex characters for Ed25519, in `publisher.json` and in every proof's
 * `publisherPublicKey`. So the documented command could not be run with the only
 * value that works, and a broker who truncated the key to fit got a report
 * saying the engine's proofs do not verify: measured against a live venue,
 * `signature false … names the key it was signed with false`, exit 1, under a
 * header claiming the proof had been checked against a key told out of band.
 * Both the fixture and this check had agreed on the wrong length, so nothing
 * caught it until a real engine's key was handed to the real tool.
 */
/**
 * The publisher key as the engine publishes it, or a refusal that says where to
 * find the right value.
 *
 * Validated by constructing the key rather than by counting characters: the
 * shape that matters is "something `verifyCommitment` can verify against", and
 * that is exactly what this asks.
 */
export function publisherKeyArg(value: string): string {
  const hex = value.trim().toLowerCase();
  const wrong = (why: string): RangeError =>
    new RangeError(
      `--key ${why}. It is the publisher identity as the engine publishes it: the ` +
        "`publicKey` field of `publisher.json` in the engine's OTC_PUBLICATION_DIR, which " +
        'is the DER SPKI form — 88 hex characters for Ed25519 — and is the same string a ' +
        'proof returns as `publisherPublicKey`. A 64-character value is the 32-byte seed ' +
        'from OTC_PUBLISHING_KEY or a raw key, and no proof verifies against it.',
    );
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) throw wrong('must be hex, in whole bytes');
  try {
    createPublicKey({ key: Buffer.from(hex, 'hex'), format: 'der', type: 'spki' });
  } catch {
    throw wrong(
      hex.length === 64
        ? 'is 64 hex characters, which is not a published key'
        : 'is not a public key in DER SPKI form',
    );
  }
  return hex;
}

export function parseConformanceArgs(argv: readonly string[]): {
  base: string;
  out: string | null;
  ticks: number;
  key: string | null;
} {
  let base: string | null = null;
  let out: string | null = null;
  let ticks = 200;
  let key: string | null = null;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new RangeError(`${String(flag)} needs a value.`);
    if (flag === '--base') base = value;
    else if (flag === '--out') out = value;
    else if (flag === '--key') {
      key = publisherKeyArg(value);
    } else if (flag === '--ticks') {
      if (!/^\d+$/.test(value) || Number(value) < 2)
        throw new RangeError('--ticks must be an integer of at least 2.');
      ticks = Number(value);
    } else throw new RangeError(`Unknown option ${String(flag)}.`);
  }
  if (base === null || !/^https?:\/\/[^/]+$/.test(base)) {
    throw new RangeError(
      '--base http://host:port is required, without a path or a trailing slash.',
    );
  }
  return { base, out, ticks, key };
}

export async function runConformanceTool(
  argv: readonly string[],
): Promise<{ code: number; output: string }> {
  let options: ReturnType<typeof parseConformanceArgs>;
  try {
    options = parseConformanceArgs(argv);
  } catch (error) {
    return { code: 2, output: (error as Error).message };
  }
  const report = await conformance({
    baseUrl: options.base,
    ticks: options.ticks,
    ...(options.key === null ? {} : { publisherPublicKey: options.key }),
  });
  const text = renderConformance(report);
  if (options.out !== null) writeFileSync(options.out, text);
  return { code: report.ok ? 0 : 1, output: text };
}

const invokedDirectly =
  process.argv[1] !== undefined && /conformanceTool\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  void runConformanceTool(process.argv.slice(2)).then(({ code, output }) => {
    process.stdout.write(`${output}\n`);
    process.exit(code);
  });
}
