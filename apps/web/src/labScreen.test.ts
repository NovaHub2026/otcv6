import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Lab screen cannot be mistaken for the market, and it never relaxes a rule
 * to look better.
 *
 * §3 of the specification requires `OTC LAB` and `SIMULATION ENVIRONMENT` to be
 * permanently displayed. The screen shows the engine's latent state and its
 * keystream cursors (INV-010) and can select among futures; a screenshot of it
 * must not be mistakable for one of a market carrying positions.
 *
 * Source assertions rather than browser ones, on purpose: the browser suite
 * runs only where Chromium launches. Since PH-24.6 the Lab is several files
 * under `lab/`; every "must contain" runs over all of them and every "must not
 * contain" over comment-stripped source, because the place a forbidden word is
 * likeliest to appear is the comment explaining why it is forbidden.
 */
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app');
const read = (file: string): string => readFileSync(path.join(app, file), 'utf8');
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = (file: string): string => strip(read(file));
/** Every non-test source under `lab/`, concatenated, comment-stripped. */
const lab = (): string =>
  readdirSync(path.join(app, 'lab'))
    .filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))
    .sort()
    .map((n) => strip(read(`lab/${n}`)))
    .join('\n');

describe('the Lab is marked wherever it appears', () => {
  it('carries the banner in the frame, not in the content', () => {
    const shell = read('lab/Lab.tsx');
    expect(shell).toMatch(/OTC LAB/);
    expect(shell).toMatch(/SIMULATION ENVIRONMENT/);
    // Rendered before the scrolling area: a banner that scrolls away is absent
    // in every screenshot that matters.
    const bannerAt = shell.indexOf('<Banner />');
    const scrollAt = shell.indexOf('overflowY');
    expect(bannerAt).toBeGreaterThan(0);
    expect(bannerAt, 'the banner scrolls away with the content').toBeLessThan(scrollAt);
    // And the words are the specification's, not a translation of them.
    const es = read('../lib/es.ts');
    expect(es).toMatch(/title: 'OTC LAB'/);
    expect(es).toMatch(/subtitle: 'SIMULATION ENVIRONMENT'/);
  });

  it('marks the menu entry too', () => {
    const nav = read('Nav.tsx');
    expect(nav).toMatch(/href: '\/lab'/);
    expect(nav).toMatch(/nav-lab-marker/);
  });

  it('shows the direction as one half, with its reason and no breakdown', () => {
    // §10 corrected: "UP 51.8% / DOWN 48.2%" describes a probabilistic
    // directional engine and this is not one.
    const source = lab();
    expect(source).toMatch(/state\.direction\.up/);
    expect(source).toMatch(/state\.direction\.why/);
    expect(source).not.toMatch(/trendInfluence|momentumInfluence|meanReversion/);
  });

  it('never shows a quality verdict without what it was measured on', () => {
    // "Clean" and "clean at a stated resolution" are different claims (CA7-05);
    // the first version printed a green clean off two hypotheses out of eight
    // hundred, and it read exactly like one off 378.
    const source = code('lab/Calidad.tsx');
    const at = source.indexOf('function QualityPanel(');
    expect(at, 'QualityPanel not found').toBeGreaterThan(0);
    const panel = source.slice(at);
    expect(panel).toMatch(/predictability/);
    expect(panel, 'the verdict is shown without its sample').toMatch(/sampledTicks/);
    expect(panel, 'the caveat is not rendered').toMatch(/lab-quality-caveat/);
    expect(panel, 'the verdict is printed without its resolution').toMatch(/resolutionPoints/);
    expect(panel, "the battery's notes are computed and dropped").toMatch(/lab-quality-notes/);
    expect(panel, 'a bare clean/EDGE ternary is back').not.toMatch(/clean \? '[^']*' : '[^']*'/);
    // Realism has the same problem: three consecutive forks of one market at
    // the default sample measured 14/15, 15/15, 15/15.
    expect(panel, 'the realism reading is printed without its caveat').toMatch(/lab-realism-note/);
    expect(panel, 'a bare plausible/IMPLAUSIBLE ternary is back').not.toMatch(
      /IMPLAUSIBLE|IMPLAUSIBL/,
    );
  });

  it("lists the Lab's own markets, so it cannot name a production asset", () => {
    // §3: Lab controls must never be available for manipulating a live market
    // carrying positions. The screen asks the Lab which markets it hosts.
    const source = lab();
    expect(source).toMatch(/labGet<\{ markets: LabMarket\[\] \}>\('markets'\)/);
    expect(source, 'the screen reads the production catalogue').not.toMatch(
      /fetchCatalogue|apiBase/,
    );
    expect(code('lab/page.tsx'), 'the page hands the screen an engine URL').not.toMatch(/apiBase/);
  });

  it('gives the close control its acts and their consequences (PH-24.2)', () => {
    const source = code('lab/Cierre.tsx');
    // Since PH-24.6 the buttons come from the kit, which takes `testId` and
    // renders `data-testid`: either spelling of the handle counts.
    for (const handle of ['lab-close-preview', 'lab-close-apply', 'lab-close-release']) {
      expect(source, `${handle} missing`).toMatch(new RegExp(`(data-testid|testId)="${handle}"`));
    }
    // Release is disabled while nothing is armed.
    expect(source, 'release is not gated on armed').toMatch(
      /disabled=\{busy !== null \|\| !armed\}/,
    );
    // A price between two lattice levels is answered with both, as buttons that
    // are the act — applied where the plan belongs (a position's expiry after a
    // preset), never a silent rounding, never a field left for Apply to fire on
    // the wrong instant.
    expect(source).toMatch(/lab-close-notice/);
    expect(source).toMatch(/\[notice\.below, notice\.above\]\.map/);
    expect(source).toMatch(/void onNeighbour\(level\)/);
    expect(source, 'a neighbour only fills the field').not.toMatch(
      /onClick=\{\(\) => \{\s*onPrice\(level\);/,
    );
    expect(code('lab/Lab.tsx')).toMatch(/&expiry=\$\{String\(planExpiry\)\}/);
    // The outcome of the last applied close, in prices, never lattice levels
    // (PH-23.5 §6), saying EXACTO or FALLÓ.
    expect(source).toMatch(/lastApplied\.targetPrice/);
    expect(source).toMatch(/lastApplied\.closedPrice/);
    expect(source, 'the outcome line prints a lattice level').not.toMatch(
      /String\(control\.lastApplied\.(target|closed)\)/,
    );
    const es = read('../lib/es.ts');
    expect(es).toMatch(/EXACTO/);
    expect(es).toMatch(/FALLÓ/);
    // The relative close the Human Owner asked for: ±1, ±2, ±3 lattice steps.
    expect(source).toMatch(/lab-close-delta-/);
    expect(code('lab/Lab.tsx')).toMatch(/delta=\$\{String\(delta\)\}/);
    expect(code('lab/[...path]/route.ts')).toMatch(/export async function POST/);
  });

  it('puts the three missing controls on the screen, each as what it is (PH-24.7)', () => {
    const cierre = code('lab/Cierre.tsx');
    const escenarios = code('lab/Escenarios.tsx');
    // A close at a typed time is a third addressing mode beside the two candles.
    expect(cierre).toMatch(/<option value="expiry">/);
    expect(cierre).toMatch(/(data-testid|testId)="lab-close-expiry"/);
    expect(code('lab/Lab.tsx')).toMatch(/expiry=\$\{String\(at\)\}/);
    // Target Price is visibly apart from the close and never a close: no
    // terminal condition, strength as the acceptance rate.
    for (const handle of [
      'lab-target',
      'lab-target-price',
      'lab-target-steps',
      'lab-target-preview',
      'lab-target-apply',
      'lab-target-plan',
    ]) {
      expect(cierre, `${handle} missing`).toMatch(new RegExp(`(data-testid|testId)="${handle}"`));
    }
    expect(cierre).toMatch(/es\.lab\.close\.targetPrice/);
    expect(cierre, 'the no-terminal-condition line is gone').toMatch(/\bnoEnd\b/);
    expect(cierre).toMatch(/onTarget\('target-price'/);
    expect(cierre, 'target price must not go through the close route').not.toMatch(/\/close\?/);
    // The level as a price (PH-23.5 §6), the lattice index behind ⓘ.
    expect(cierre).toMatch(/shown\.targetPrice/);
    expect(cierre, 'a lattice index under the word nivel').not.toMatch(
      /value=\{\s*shown\.targetLevel/,
    );
    // The shock: locate, then direct — a size, a direction, and where it comes.
    for (const handle of [
      'lab-shock',
      'lab-shock-size',
      'lab-shock-direction',
      'lab-shock-preview',
      'lab-shock-apply',
      'lab-shock-at',
    ]) {
      expect(escenarios, `${handle} missing`).toMatch(
        new RegExp(`(data-testid|testId)="${handle}"`),
      );
    }
    expect(escenarios).toMatch(/es\.lab\.scenarios\.shock\.none/);
  });

  it('shows simulated positions with expected and actual side by side (PH-24.3)', () => {
    const source = code('lab/Posiciones.tsx');
    for (const handle of ['lab-position-call', 'lab-position-put', 'lab-positions']) {
      expect(source, `${handle} missing`).toMatch(new RegExp(`(data-testid|testId)="${handle}"`));
    }
    expect(source).toMatch(/p\.expected\.outcome/);
    expect(source).toMatch(/p\.actual\.outcome/);
    expect(source).toMatch(/p\.expected\.basis/);
    expect(source).toMatch(/es\.lab\.positions\.disagrees/);
    expect(read('../lib/es.ts')).toMatch(/NO COINCIDE CON LO ESPERADO/);
    for (const preset of [
      'win-minimum',
      'loss-minimum',
      'tie',
      'entry-plus-tick',
      'entry-minus-tick',
      'exact-entry',
    ]) {
      expect(source, `preset ${preset} missing`).toMatch(new RegExp(`name: '${preset}'`));
    }
    expect(source).toMatch(/p\.actual === null && \(/);
  });

  it('offers the scenarios as selection, and the two the signs cannot express as a sentence (PH-24.4)', () => {
    const source = code('lab/Escenarios.tsx');
    expect(source).toMatch(/data-testid="lab-scenarios"/);
    expect(source).toMatch(/data-testid=\{`lab-scenario-\$\{s\.name\}`\}/);
    expect(source).toMatch(/disabled=\{!s\.selectable \|\| busy !== null\}/);
    expect(source).toMatch(/lab-scenario-why-/);
    expect(source).toMatch(/lab-scenario-preview/);
    expect(source).toMatch(/lab-scenario-apply/);
    expect(source).toMatch(/plan\.acceptanceRate/);
    expect(source).toMatch(/plan\.shape\.net/);
  });

  it("shows the session's closes with the count a verdict rests on (PH-24.5)", () => {
    const source = code('lab/Sesion.tsx');
    expect(source).toMatch(/data-testid="lab-closes"/);
    expect(source).toMatch(/lab-closes-verdict/);
    expect(source).toMatch(/closes\.minimumForVerdict/);
    expect(source).toMatch(/closes\.controlled/);
    expect(source).toMatch(/closes\.note/);
    expect(source).toMatch(/lab-session-engine/);
    expect(source).toMatch(/lab-session-lab/);
  });

  it('says the Lab is absent rather than hiding that it can be', () => {
    expect(lab()).toMatch(/lab-not-running/);
    expect(code('lab/[...path]/route.ts')).toMatch(/OTC_LAB_BASE/);
    expect(code('lab/[...path]/route.ts'), 'the panel proxies the Lab to the engine').not.toMatch(
      /OTC_API_BASE/,
    );
  });
});
