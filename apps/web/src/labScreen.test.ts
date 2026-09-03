import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Lab screen cannot be mistaken for the market.
 *
 * §3 of the specification requires `OTC LAB` and `SIMULATION ENVIRONMENT` to be
 * permanently displayed, and that is not decoration. The screen shows the
 * engine's latent state and its **keystream cursors**, which INV-010 forbids
 * publishing, and it can select among futures. A screenshot of it must not be
 * mistakable for a screenshot of a market carrying positions.
 *
 * These are source assertions rather than browser ones on purpose: the browser
 * suite runs only where Chromium launches, and a labelling rule that is only
 * checked where a browser exists is a rule that is off on most machines.
 */
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app');
const read = (file: string): string => readFileSync(path.join(app, file), 'utf8');

/**
 * Source with its comments removed.
 *
 * Every "this file must not contain X" assertion runs on this, because the
 * place X is most likely to appear is the comment explaining why it must not.
 * That has now cost this project three guards — `lab` in `app.module.ts`,
 * `merged` in `session.ts`, and `apiBase` in `lab/page.tsx`, which fired on the
 * docstring saying the screen is not given one.
 */
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the Lab is marked wherever it appears', () => {
  it('carries the banner in the frame, not in the content', () => {
    const source = read('lab/Lab.tsx');
    expect(source).toMatch(/OTC LAB/);
    expect(source).toMatch(/SIMULATION ENVIRONMENT/);
    // In the frame: rendered before the scrolling area, not inside it. A banner
    // that scrolls away is a banner that is absent in every screenshot that
    // matters.
    const bannerAt = source.indexOf('<Banner />');
    const scrollAt = source.indexOf('overflowY');
    expect(bannerAt).toBeGreaterThan(0);
    expect(bannerAt, 'the banner scrolls away with the content').toBeLessThan(scrollAt);
  });

  it('marks the menu entry too', () => {
    // The menu is where an operator decides to go there, and a row that looked
    // like the others is the first place the distinction would be lost.
    const nav = read('Nav.tsx');
    expect(nav).toMatch(/href: '\/lab'/);
    expect(nav).toMatch(/nav-lab-marker/);
  });

  it('shows the direction as one half, with its reason and no breakdown', () => {
    // §10 corrected. "UP 51.8% / DOWN 48.2%" describes a probabilistic
    // directional engine and this is not one.
    const source = read('lab/Lab.tsx');
    expect(source).toMatch(/state\.direction\.up/);
    expect(source).toMatch(/state\.direction\.why/);
    expect(source).not.toMatch(/trendInfluence|momentumInfluence|meanReversion/);
  });

  it('never shows a quality verdict without what it was measured on', () => {
    // The same rule the API enforces, on the screen that renders it: "clean"
    // and "clean at a stated resolution" are different claims, and Cycle Audit
    // 7 caught PH-21 collapsing exactly that distinction (CA7-05).
    // Comment-stripped, for the same reason as everywhere else here: the
    // sentence explaining why `IMPLAUSIBLE` must not be printed contains the
    // word `IMPLAUSIBLE`.
    const source = code('lab/Lab.tsx');
    // To the end of the file: the first `\n}` in this component is the closing
    // brace of its destructured parameters, and a regex that stopped there
    // matched nothing and passed. Watched failing is how that surfaced.
    const at = source.indexOf('function QualityPanel(');
    expect(at, 'QualityPanel not found').toBeGreaterThan(0);
    const panel = source.slice(at);
    expect(panel).toMatch(/predictability/);
    expect(panel, 'the verdict is shown without its sample').toMatch(/sampledTicks/);
    expect(panel, 'the caveat is not rendered').toMatch(/lab-quality-caveat/);
    // The bare word is the defect. The first version of this panel printed a
    // green `clean` off two hypotheses out of eight hundred, and it read
    // exactly like one off 378.
    expect(panel, 'the verdict is printed without its resolution').toMatch(/resolutionPoints/);
    expect(panel, "the battery's notes are computed and dropped").toMatch(/lab-quality-notes/);
    expect(panel, 'a bare clean/EDGE ternary is back').not.toMatch(/clean \? '[^']*' : '[^']*'/);
    // The same rule for realism, which has the same problem: three consecutive
    // forks of one market at the default sample measured 14/15, 15/15, 15/15.
    expect(panel, 'the realism reading is printed without its caveat').toMatch(/lab-realism-note/);
    expect(panel, 'a bare plausible/IMPLAUSIBLE ternary is back').not.toMatch(/IMPLAUSIBLE/);
  });

  it("lists the Lab's own markets, so it cannot name a production asset", () => {
    // §3: Lab controls must never be available for manipulating a live market
    // carrying positions. The screen asks the Lab which markets it hosts, so a
    // production asset id never reaches it — a stronger property than a check
    // on the way out, which would be a flag (ADR-0015 §3).
    const source = code('lab/Lab.tsx');
    expect(source).toMatch(/labGet<\{ markets: LabMarket\[\] \}>\('markets'\)/);
    expect(source, 'the screen reads the production catalogue').not.toMatch(
      /fetchCatalogue|apiBase/,
    );
    expect(code('lab/page.tsx'), 'the page hands the screen an engine URL').not.toMatch(/apiBase/);
  });

  it('gives the close control its acts and their consequences (PH-24.2)', () => {
    const source = code('lab/Lab.tsx');
    // Preview, apply and release — and release is disabled while nothing is
    // armed, because an operator releasing a keystream releases nothing.
    for (const handle of ['lab-close-preview', 'lab-close-apply', 'lab-close-release']) {
      expect(source, `${handle} missing`).toMatch(new RegExp(`data-testid="${handle}"`));
    }
    expect(source, 'release is not gated on armed').toMatch(
      /disabled=\{busy !== null \|\| !armed\}/,
    );
    // A price between two lattice levels is answered with both, as buttons
    // that set the field — never a silent rounding.
    expect(source).toMatch(/lab-close-notice/);
    expect(source).toMatch(/\[notice\.below, notice\.above\]\.map/);
    // Choosing an offered neighbour is the act, and it lands where the plan
    // belongs: at a position's expiry after a preset, not at whatever candle the
    // selectors show. The first version set the field and left the operator to
    // click Apply on the wrong instant.
    expect(source).toMatch(/void onNeighbour\(level\)/);
    expect(source, 'a neighbour only fills the field').not.toMatch(
      /onClick=\{\(\) => \{\s*onPrice\(level\);/,
    );
    expect(source).toMatch(/&expiry=\$\{String\(planExpiry\)\}/);
    // The outcome of the last applied close is shown, and says EXACT or MISSED:
    // "applied" is a claim about the future, and this is the line that checks it.
    expect(source).toMatch(/lastApplied/);
    expect(source).toMatch(/EXACT/);
    expect(source).toMatch(/MISSED/);
    // In prices, not lattice levels (PH-23.5 §6): the first version printed
    // `target -12518 · closed at -12518` under a control whose operator had
    // typed 1.0812698.
    expect(source).toMatch(/lastApplied\.targetPrice/);
    expect(source).toMatch(/lastApplied\.closedPrice/);
    expect(source, 'the outcome line prints a lattice level').not.toMatch(
      /String\(control\.lastApplied\.(target|closed)\)/,
    );
    // The two timelines are rendered apart and named for what they are (§72–§73).
    expect(source).toMatch(/lab-session-engine/);
    expect(source).toMatch(/lab-session-lab/);
    // The proxy forwards the acts.
    expect(code('lab/[...path]/route.ts')).toMatch(/export async function POST/);
  });

  it('shows simulated positions with expected and actual side by side (PH-24.3)', () => {
    const source = code('lab/Lab.tsx');
    for (const handle of ['lab-position-call', 'lab-position-put', 'lab-positions']) {
      expect(source, `${handle} missing`).toMatch(new RegExp(`data-testid="${handle}"`));
    }
    // Both columns, and the disagreement named as what it is: a finding.
    expect(source).toMatch(/p\.expected\.outcome/);
    expect(source).toMatch(/p\.actual\.outcome/);
    expect(source).toMatch(/DISAGREES WITH EXPECTED/);
    // Expected says what it rests on — an armed target or merely the current price.
    expect(source).toMatch(/p\.expected\.basis/);
    // Every preset the specification names, and presets only on open positions.
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
    const source = code('lab/Lab.tsx');
    expect(source).toMatch(/data-testid="lab-scenarios"/);
    expect(source).toMatch(/data-testid=\{`lab-scenario-\$\{s\.name\}`\}/);
    // Not selectable means no button that works — disabled, with the reason
    // beside it — never a button that would report an acceptance rate of one.
    expect(source).toMatch(/disabled=\{!s\.selectable \|\| busy !== null\}/);
    expect(source).toMatch(/lab-scenario-why-/);
    // Preview before apply, and the shape and the rate shown, not only "armed".
    expect(source).toMatch(/lab-scenario-preview/);
    expect(source).toMatch(/lab-scenario-apply/);
    expect(source).toMatch(/plan\.acceptanceRate/);
    expect(source).toMatch(/plan\.shape\.net/);
  });

  it("shows the session's closes with the count a verdict rests on (PH-24.5)", () => {
    const source = code('lab/Lab.tsx');
    expect(source).toMatch(/data-testid="lab-closes"/);
    expect(source).toMatch(/lab-closes-verdict/);
    // Never a verdict without its count — and the floor printed beside it.
    expect(source).toMatch(/closes\.minimumForVerdict/);
    expect(source).toMatch(/closes\.controlled/);
    expect(source).toMatch(/closes\.note/);
  });

  it('says the Lab is absent rather than hiding that it can be', () => {
    // The Lab is a separate process by design (ADR-0015 §3). A screen that hid
    // the entry until one existed would make the boundary look like a bug.
    const source = read('lab/Lab.tsx');
    expect(source).toMatch(/lab-not-running/);
    expect(code('lab/[...path]/route.ts')).toMatch(/OTC_LAB_BASE/);
    expect(
      code('lab/[...path]/route.ts'),
      'the panel proxies the Lab to the engine, dissolving the boundary',
    ).not.toMatch(/OTC_API_BASE/);
  });
});
