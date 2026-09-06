import { runObserverLoad } from './observerLoad.js';

/**
 * One worker of the observer fleet (PH-30.3): holds its share of the
 * observers over the multiplexed stream and prints its report as one JSON
 * line, so the driver can add the fleet up without sharing a process with it.
 *
 *   node tools/sim/dist/observerFleetWorker.js <baseUrl> <assets,comma> <observers> <holdMs> <assetsPerConnection>
 */
async function main(): Promise<void> {
  const [baseUrl, assets, observers, holdMs, perConnection] = process.argv.slice(2);
  if (
    baseUrl === undefined ||
    assets === undefined ||
    observers === undefined ||
    holdMs === undefined
  ) {
    throw new Error(
      'usage: observerFleetWorker <baseUrl> <assets> <observers> <holdMs> [assetsPerConnection]',
    );
  }
  const report = await runObserverLoad({
    baseUrl,
    assetIds: assets.split(','),
    observers: Number(observers),
    holdMs: Number(holdMs),
    assetsPerConnection: perConnection === undefined ? 1 : Number(perConnection),
    arrivalMs: 2,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  },
);
