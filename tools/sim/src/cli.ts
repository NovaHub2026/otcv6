#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import {
  epochMillis,
  formatDisplayPrice,
  MasterKeyring,
  type InstrumentSpec,
  type TimeframeId,
} from '@otc/core';
import { FIXTURES, fixtureByName } from '@otc/fixtures';
import { estimateDirectionalEdge, formatEdgeReport } from './edge.js';
import { ALL_TIMEFRAME_IDS, runSimulationAsync } from './runner.js';

/**
 * Offline simulation runner.
 *
 * Drives a fixture over a horizon and reports on it. Deliberately small: the
 * real attack battery is PH-2, and this exists so a human can look at a stream
 * and so the corpus can be exercised by hand.
 */

const DEFAULT_HORIZONS = [1, 5, 30, 60, 300, 900];

interface Options {
  fixture: string;
  ticks: number;
  strength: number;
  intervalMs: number;
  timeframes: TimeframeId[];
  out: string | null;
  edge: boolean;
  keyEpoch: number;
}

function usage(): string {
  return [
    'otc-sim — offline synthetic market simulation',
    '',
    'Usage: otc-sim [options]',
    '',
    'Options:',
    '  --fixture <name>      fixture to run (default: symmetricControl)',
    '  --ticks <n>           number of ticks (default: 1000000)',
    '  --strength <0..1>     planted-defect strength (default: 0)',
    '  --interval <ms>       mean inter-tick interval (default: 1000)',
    '  --timeframes <a,b>    timeframes to fold, or "all" (default: 1m)',
    '  --out <file>          write ticks as NDJSON',
    '  --edge                report directional edge at the binary horizons',
    '  --key-epoch <n>       vary the run without changing anything else',
    '  --list                list the available fixtures',
    '  --help                show this message',
    '',
    'Fixtures:',
    ...FIXTURES.map((f) => `  ${f.name.padEnd(24)} ${f.defect}`),
  ].join('\n');
}

function parse(argv: readonly string[]): Options | null {
  const options: Options = {
    fixture: 'symmetricControl',
    ticks: 1_000_000,
    strength: 0,
    intervalMs: 1_000,
    timeframes: ['1m'],
    out: null,
    edge: false,
    keyEpoch: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return next;
    };
    switch (arg) {
      case '--help':
      case '-h':
        console.log(usage());
        return null;
      case '--list':
        for (const f of FIXTURES)
          console.log(`${f.name}\n    ${f.description}\n    defect: ${f.defect}`);
        return null;
      case '--fixture':
        options.fixture = value();
        break;
      case '--ticks':
        options.ticks = Number(value());
        break;
      case '--strength':
        options.strength = Number(value());
        break;
      case '--interval':
        options.intervalMs = Number(value());
        break;
      case '--key-epoch':
        options.keyEpoch = Number(value());
        break;
      case '--timeframes': {
        const raw = value();
        options.timeframes =
          raw === 'all' ? [...ALL_TIMEFRAME_IDS] : (raw.split(',') as TimeframeId[]);
        break;
      }
      case '--out':
        options.out = value();
        break;
      case '--edge':
        options.edge = true;
        break;
      default:
        throw new Error(`Unknown option ${arg}. Try --help.`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  if (options === null) return;

  const fixture = fixtureByName(options.fixture);
  const instrument: InstrumentSpec = {
    id: 'sim-otc',
    family: 'forex',
    logQuantum: 1e-6,
    displayPrecision: 5,
    referencePrice: 1.1,
  };

  // A test keyring: it is structurally unable to derive a production stream.
  const keyring = MasterKeyring.forTesting('otc-sim-cli');
  const source = fixture.create({
    instrument,
    keyring,
    env: 'simulation',
    ticks: options.ticks,
    startInstant: epochMillis(1_776_000_000_000),
    meanIntervalMs: options.intervalMs,
    strength: options.strength,
    keyEpoch: options.keyEpoch,
  });

  console.log(
    `${fixture.name} — strength ${options.strength}, ${options.ticks.toLocaleString()} ticks\n` +
      `  defect: ${fixture.defect}`,
  );

  const result = await runSimulationAsync({
    source,
    timeframes: options.timeframes,
    retainTicks: options.out !== null,
    initialCapacity: Math.min(options.ticks, 1 << 20),
  });

  const days = (result.lastInstant - result.firstInstant) / 86_400_000;
  console.log(
    `  generated ${result.tickCount.toLocaleString()} ticks spanning ${days.toFixed(1)} days ` +
      `in ${result.elapsedSeconds.toFixed(2)}s ` +
      `(${(result.tickCount / result.elapsedSeconds / 1e6).toFixed(2)}M ticks/s)`,
  );
  for (const id of options.timeframes) {
    console.log(`  ${id}: ${(result.candles.get(id)?.length ?? 0).toLocaleString()} candles`);
  }
  const first = result.prices[0];
  const last = result.prices[result.tickCount - 1];
  if (first !== undefined && last !== undefined) {
    console.log(
      `  price ${formatDisplayPrice(instrument, first as never)} -> ` +
        `${formatDisplayPrice(instrument, last as never)}`,
    );
  }

  if (options.edge) {
    console.log();
    console.log(
      formatEdgeReport(
        estimateDirectionalEdge(result.prices, DEFAULT_HORIZONS, 'directional edge'),
      ),
    );
  }

  if (options.out !== null) {
    const stream = createWriteStream(options.out);
    for (const tick of result.ticks) {
      if (!stream.write(`${JSON.stringify(tick)}\n`)) await once(stream, 'drain');
    }
    stream.end();
    await once(stream, 'finish');
    console.log(`\n  wrote ${result.ticks.length.toLocaleString()} ticks to ${options.out}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
