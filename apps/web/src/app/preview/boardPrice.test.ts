import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What the board's cards put on screen, read as text.
 *
 * **Cycle Audit 10 (a8-04).** `Board.tsx` is a client component with no unit
 * coverage at all — the unit project has no DOM, so nothing here can render it
 * — and the one test that did look at it, in `panel.stat.test.ts`, asserted
 * `/^-?\d+$/` over every price cell. That regex is satisfied by the canonical
 * lattice index and failed by a display price, so the browser guard enforced
 * the defect it should have caught: BTC/USDT read `-65` beside a chart reading
 * `69992.0`. It is the PH-23.5 class of defect, back one screen over.
 *
 * The conversion itself is `displayPriceText`, tested by value in
 * `lib/priceFormat.test.ts`; the browser suite now compares each card against
 * `/markets`'s own `displayPrice` for that asset. This is the cheap layer
 * between them: the wiring, in the fast suite, where a refactor that reaches
 * for `card.price` again is caught in a second rather than in a browser.
 */
const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'Board.tsx'),
  'utf8',
);

describe('the board renders a price, not a lattice index (a8-04)', () => {
  it('converts every card through displayPriceText', () => {
    expect(source, 'Board.tsx no longer imports the conversion').toContain('displayPriceText');
    const cell = /data-testid=\{`board-price-\$\{entry\.id\}`\}>([\s\S]*?)<\/span>/.exec(source);
    expect(cell, 'the price cell is not where this test can read it').not.toBeNull();
    expect(cell![1], 'the price cell does not convert anything').toContain('displayPriceText(');
    // The conversion and the "no tick yet" test are the only two places the
    // canonical integer may appear in this cell. Anything else is the integer
    // on its way to the screen — which is what `{card.price ?? '—'}` was.
    const rendered = cell![1]!
      .replace(/displayPriceText\([^)]*\)/g, 'THE PRICE')
      .replace(/card\.price\s*===\s*null/g, 'NO TICK YET');
    expect(
      rendered,
      'the canonical integer reaches the screen unconverted: that is a lattice offset, not a price',
    ).not.toContain('card.price');
  });

  it("converts with the card's own instrument, not a borrowed one", () => {
    // `displayPrice` is `reference * exp(price * quantum)`; converting with
    // another asset's reference is a price for the wrong market, which reads
    // as plausible and is wrong by orders of magnitude.
    expect(source).toMatch(/displayPriceText\(card\.price,\s*entry\)/);
  });
});
