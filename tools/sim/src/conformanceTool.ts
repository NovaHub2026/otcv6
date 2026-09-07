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
 */
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
      if (!/^[0-9a-f]{64}$/i.test(value))
        throw new RangeError('--key must be the publisher key as 64 hex characters.');
      key = value.toLowerCase();
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
