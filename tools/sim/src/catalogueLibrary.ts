import { ASSET_CATALOGUE, seatById, type RegisteredAsset } from '@otc/engine';

/**
 * The catalogue as a broker reads it: one table, generated, never typed.
 *
 * **PH-26.4.** `otc-integration/CATALOGUE.md` is this function's output for
 * the compiled catalogue, and `catalogueLibrary.test.ts` re-derives it so an
 * edit to either the catalogue or the seats without regenerating the table
 * fails by name. It is a pure function of the compiled entries so the guard can
 * call it; the runner in `tools/sim` only writes the file.
 */
export function catalogueLibrary(catalogue: readonly RegisteredAsset[] = ASSET_CATALOGUE): string {
  const rows = catalogue.map((asset) => {
    const seat = seatById(asset.definition.id);
    const price = asset.instrument.referencePrice.toLocaleString('en-US', {
      maximumFractionDigits: asset.instrument.displayPrecision,
    });
    return (
      `| \`${asset.definition.id}\` | ${asset.definition.displayName} | ${asset.definition.family} | ` +
      `${seat.archetype} | ${price} | ${String(asset.instrument.displayPrecision)} | ` +
      `${(asset.evidence.meanIntervalMs / 1000).toFixed(2)} s | ${seat.character.replace(/\|/g, '/')} |`
    );
  });
  return (
    `# The catalogue of thirty\n\n` +
    `Generated from \`packages/engine/src/catalogue.ts\` and \`packages/engine/src/seats.ts\` by ` +
    `\`npm run catalogue:library\`. Do not edit by hand: \`catalogueLibrary.test.ts\` re-derives this ` +
    `file and fails when it is stale.\n\n` +
    `Every asset is served by \`GET /catalogue\` with these fields and more (quantum, tie rate, live/retired). ` +
    `Ids are stable for the life of the deployment: an id is a key-derivation label and a state filename, ` +
    `and the engine refuses to resume a checkpoint another personality wrote under it. Display names may be ` +
    `renamed by an operator; nothing else here may.\n\n` +
    `| id | name | family | archetype | reference price | precision | mean tick | character |\n` +
    `| --- | --- | --- | --- | --- | --- | --- | --- |\n` +
    rows.join('\n') +
    '\n'
  );
}
