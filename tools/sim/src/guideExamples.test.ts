import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOGUE, dispersionLogSigma, dispersionPercent } from '@otc/engine';
import { API_VERSION } from '@otc/client';

/**
 * **Every number in a broker's guide that the engine also computes is re-derived
 * here** (the readiness audit of 2026-09-28, findings 2, 5, 7 and 8).
 *
 * The guide is hand-maintained and its examples were typed from runs of older
 * builds, so they drifted where nothing checked them:
 *
 * - the `/catalogue` example gave `meanIntervalMs: 348` against the served
 *   972.31 (2.8x), `tieRate: 0.0095` against 0.1288 (13.6x — and the guide's own
 *   prose warns that sizing a payout off `tieRate` is wrong by that factor),
 *   `quarterlyPercent: 3.8` against 0.038 (100x, a percent written where the route
 *   serves a fraction), and no `realisedRefundRate` at all; a *second* copy 500
 *   lines earlier had the right interval and the wrong kurtosis.
 * - `/health` advertised `apiVersion: 3.0.0` and omitted `composition`, the key
 *   that says whether a venue is the Lab.
 * - `/price` — the settlement response — omitted `logQuantum`, `referencePrice`,
 *   `displayPrecision` and `seam`, and printed a `displayPrice` the engine cannot
 *   print, while §5 of the same document tells a broker to settle on exactly those
 *   fields.
 *
 * A guide that is wrong about the engine is worse than no guide: the reader
 * believes it and builds to it.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GUIDE = path.join(repoRoot, 'docs', 'integration', 'INTEGRATION.md');
const guide = (): string => readFileSync(GUIDE, 'utf8');

/** The fenced blocks of a document, with their language tag. */
function blocks(text: string): { language: string; body: string }[] {
  return [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map(([, language, body]) => ({
    language: language ?? '',
    body: body ?? '',
  }));
}

/** A JSON-ish example's `"key": value` pairs, tolerating comments and ellipses. */
function pairs(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, key, value] of body.matchAll(/"([A-Za-z]+)":\s*([^,\n}]+)/g)) {
    if (!out.has(key!)) out.set(key!, value!.trim());
  }
  return out;
}

const eurusd = ASSET_CATALOGUE.find((asset) => asset.instrument.id === 'eurusd-otc');

describe("the guide's examples against what the engine serves", () => {
  it('has the asset every example is written about', () => {
    expect(eurusd, 'eurusd-otc is no longer in the catalogue: rewrite the examples').toBeDefined();
  });

  it('gives the catalogue entry the values the catalogue holds', () => {
    const asset = eurusd!;
    const sigma = dispersionLogSigma(asset.evidence);
    const expected: Record<string, number> = {
      referencePrice: asset.instrument.referencePrice,
      displayPrecision: asset.instrument.displayPrecision,
      logQuantum: asset.instrument.logQuantum,
      meanIntervalMs: asset.evidence.meanIntervalMs,
      tieRate: asset.evidence.tieRate,
      realisedRefundRate: asset.evidence.realisedRefundRate,
      excessKurtosis: asset.evidence.predictedExcessKurtosis,
      quarterlyLogSigma: sigma,
      quarterlyPercent: dispersionPercent(sigma),
    };
    // Every catalogue example in the document, not just the first: there were two
    // and they disagreed with each other as well as with the engine.
    const examples = blocks(guide()).filter(
      ({ body }) => body.includes('"meanIntervalMs"') && body.includes('"tieRate"'),
    );
    expect(examples.length, 'no /catalogue example left in the guide').toBeGreaterThan(0);
    for (const { body } of examples) {
      const shown = pairs(body);
      expect(
        shown.has('realisedRefundRate'),
        'a catalogue example omits realisedRefundRate — the rate a payout is sized with',
      ).toBe(true);
      for (const [key, value] of Object.entries(expected)) {
        if (!shown.has(key)) continue;
        expect(
          Number(shown.get(key)),
          `the guide shows ${key} = ${String(shown.get(key))}; the catalogue holds ${String(value)}`,
        ).toBeCloseTo(value, 9);
      }
    }
  });

  it('gives /health the version the client actually asserts, and names the composition', () => {
    const example = blocks(guide()).find(
      ({ body }) => body.includes('GET /health') && body.includes('"assets"'),
    );
    expect(example, 'no /health example left in the guide').toBeDefined();
    const shown = pairs(example!.body);
    expect(shown.get('apiVersion')?.replaceAll('"', '')).toBe(API_VERSION);
    expect(
      shown.has('composition'),
      'the /health example omits `composition`: a broker cannot tell production from the Lab',
    ).toBe(true);
    expect(shown.get('composition')?.replaceAll('"', '')).toBe('production');
  });

  it('names the contract version the engine serves, in both broker guides', () => {
    // ORBIT.md's header said 3.3.0 while its own checklist said 3.7.0 — and the
    // header is the line an integrator pins in their README. A client built for
    // 3.3.0 is refused outright by the conformance suite, which asserts equality.
    for (const name of ['INTEGRATION.md', 'ORBIT.md']) {
      const text = readFileSync(path.join(repoRoot, 'docs', 'integration', name), 'utf8');
      for (const [whole, version] of text.matchAll(
        /(?:Contrato del motor|contrato del motor \(hoy)[^\n]*?\b(\d+\.\d+\.\d+)/g,
      )) {
        expect(
          version,
          `${name} states ${whole.trim()}, but the engine serves ${API_VERSION}`,
        ).toBe(API_VERSION);
      }
    }
  });

  it('shows a displayPrice the engine could print, from the integer beside it', () => {
    const asset = eurusd!;
    const { logQuantum, referencePrice, displayPrecision } = asset.instrument;
    const rendered = (price: number): string =>
      (referencePrice * Math.exp(price * logQuantum)).toFixed(displayPrecision);
    // Every example that shows an integer price and a rendered one together.
    const examples = blocks(guide()).filter(
      ({ body }) => body.includes('"displayPrice"') && body.includes('"price"'),
    );
    expect(examples.length).toBeGreaterThan(1);
    let checked = 0;
    for (const { body } of examples) {
      const shown = pairs(body);
      if (!shown.has('assetId') && !body.includes('eurusd-otc')) continue;
      const price = Number(shown.get('price'));
      const displayed = shown.get('displayPrice')?.replaceAll('"', '');
      if (!Number.isInteger(price) || displayed === undefined || displayed === 'null') continue;
      expect(
        displayed.split('.')[1]?.length,
        `displayPrice ${displayed} has decimals the engine never prints (displayPrecision is ` +
          `${String(displayPrecision)})`,
      ).toBe(displayPrecision);
      expect(
        displayed,
        `the guide renders ${String(price)} as ${displayed}; the engine renders ${rendered(price)}`,
      ).toBe(rendered(price));
      checked += 1;
    }
    expect(checked, 'no example paired an integer price with a rendered one').toBeGreaterThan(1);
  });

  it('shows the settlement response with the keys settlement needs', () => {
    // §5 tells a broker to compare `logQuantum` and `referencePrice` before
    // comparing two integers. The example it would copy the DTO from had neither.
    const example = blocks(guide()).find(({ body }) => body.includes('"last-tick-at-or-before"'));
    expect(example, 'no /price example left in the guide').toBeDefined();
    const shown = pairs(example!.body);
    for (const key of [
      'assetId',
      'at',
      'rule',
      'sequence',
      'instant',
      'price',
      'logQuantum',
      'referencePrice',
      'displayPrecision',
      'displayPrice',
      'seam',
    ]) {
      expect(shown.has(key), `the /price example omits \`${key}\``).toBe(true);
    }
  });
});
