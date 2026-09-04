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
    // PH-24.12: the chart's catalogue comes from the Lab's own engine routes, never from /engine.
    expect(source, 'the screen reads the production catalogue').not.toMatch(
      /fetchCatalogue\('(?!\/labengine')|apiBase=(?!"\/labengine")/,
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
    // Target Price is on Escenarios (PH-24.11), visibly apart from the close and never a close: no
    // terminal condition, strength as the acceptance rate.
    for (const handle of [
      'lab-target',
      'lab-target-price',
      'lab-target-steps',
      'lab-target-preview',
      'lab-target-apply',
      'lab-target-plan',
    ]) {
      expect(escenarios, `${handle} missing`).toMatch(
        new RegExp(`(data-testid|testId)="${handle}"`),
      );
    }
    expect(escenarios).toMatch(/es\.lab\.close\.targetPrice/);
    expect(escenarios, 'the no-terminal-condition line is gone').toMatch(/\bnoEnd\b/);
    expect(escenarios).toMatch(/onTarget\('target-price'/);
    expect(escenarios, 'target price must not go through the close route').not.toMatch(/\/close\?/);
    // PH-24.11: Cierre is only the close of a candle.
    expect(cierre).not.toMatch(/lab-target/);
    // The level as a price (PH-23.5 §6), the lattice index behind ⓘ.
    expect(escenarios).toMatch(/shown\.targetPrice/);
    expect(escenarios, 'a lattice index under the word nivel').not.toMatch(
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

  it('lets a session leave and be read (PH-24.8)', () => {
    const sesion = code('lab/Sesion.tsx');
    expect(sesion).toMatch(/href="\/lab\/session\/export"/);
    expect(sesion).toMatch(/lab-positions-diagnostic/);
    expect(sesion).toMatch(/positions\.minimumForVerdict/);
    expect(sesion).toMatch(/lab-positions-verdict/);
    // The boundary tick named on the outcome line (ADR-0017), and trend strength
    // as net displacement with the sentence that there is no trend mechanism.
    expect(code('lab/Cierre.tsx')).toMatch(/onBoundary/);
    expect(code('lab/Mercado.tsx')).toMatch(/lab-net-displacement/);
    expect(read('../lib/es.ts')).toMatch(/no tiene un mecanismo de tendencia/);
  });

  it('shows every market at once, and batches only release (PH-24.9)', () => {
    const tablero = code('lab/Tablero.tsx');
    expect(tablero).toMatch(/data-testid="lab-board"/);
    expect(tablero).toMatch(/lab-board-state-/);
    expect(tablero).toMatch(/(data-testid|testId)="lab-release-all"/);
    // Release-all is disabled when nothing is armed: releasing keystreams releases nothing.
    expect(tablero).toMatch(/disabled=\{busy !== null \|\| running === 0\}/);
    // The board never arms: the only act on it is release.
    expect(tablero, 'the board arms something').not.toMatch(/\/close|\/scenario|preset/);
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/labGet<ControlAll>\('control'\)/);
    expect(lab).toMatch(/lab-asset-badge-/);
    expect(lab).toMatch(/labPost<\{ released: unknown\[\] \}>\('release-all'\)/);
  });

  it('pushes by buttons — N natural ticks through the push route, visible on every tab (PH-24.10)', () => {
    const strip = code('lab/Empujar.tsx');
    // The four sizes the Human Owner named, in both directions, as buttons.
    expect(strip).toMatch(/PUSH_SIZES = \[1, 3, 5, 10\]/);
    expect(strip).toMatch(/testId=\{`lab-push--\$\{String\(n\)\}`\}/);
    expect(strip).toMatch(/testId=\{`lab-push-\+\$\{String\(n\)\}`\}/);
    expect(strip).toMatch(/(?:data-testid|testId)="lab-push-state"/);
    expect(strip).toMatch(/(?:data-testid|testId)="lab-push-landing"/);
    expect(strip).toMatch(/(?:data-testid|testId)="lab-push-outcome"/);
    expect(strip).toMatch(/lab-push-released/);
    expect(strip).toMatch(/lab-push-error/);
    // PH-24.11: held only by its own request — never by a quality run or an armed close.
    expect(strip).toMatch(/const held = busy === 'push';/);
    expect(strip).not.toMatch(/armedElsewhere|busy !== null/);
    // The strip never posts anything itself; the shell does, to the push route and only there.
    expect(strip).not.toMatch(/labPost|labGet/);
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/markets\/\$\{selected\}\/push\?distance=\$\{String\(ticks\)\}/);
    // Outside every tab: rendered before the Tabs, not inside a hidden div.
    const stripAt = lab.indexOf('<Empujar');
    expect(stripAt).toBeGreaterThan(0);
    expect(stripAt).toBeLessThan(lab.indexOf('<Tabs<Tab>'));
    // Cierre is the first tab and the default.
    expect(lab).toMatch(/tabs=\{\[\s*\{ key: 'close'/);
    expect(lab).toMatch(/useState<Tab>\('close'\)/);
    // A refused close while pushing is said in the operator's words.
    expect(lab).toMatch(/PUSH_RUNNING/);
  });

  it('is never left held by a failed request (PH-24.11)', () => {
    const api = code('lab/labApi.ts');
    // Both verbs go through one catch: a failed fetch or body is an Unavailable answer.
    expect(api).toMatch(/async function asJson</);
    expect(api).toMatch(/catch \(error\) \{\s*return \{\s*running: false,\s*reason:/);
    expect(api).toMatch(/return asJson<T>\(fetch\(`\/lab\/\$\{path\}`\)\);/);
    expect(api).toMatch(/return asJson<T>\(\s*fetch\(`\/lab\/\$\{path\}`, \{\s*method: 'POST'/);
    expect(api).not.toMatch(/return \(await response\.json\(\)\) as T \| Unavailable;\n\}/);
    // The push handler clears busy whatever happened.
    const lab = code('lab/Lab.tsx');
    const handler = /const push = async[\s\S]*?\n {2}\};/.exec(lab)?.[0] ?? '';
    expect(handler).toMatch(/finally \{\s*setBusy\(null\);/);
  });

  it('draws the chart from the Lab engine, never production, and declares Lab mode (PH-24.12)', () => {
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/<PreviewChart[^>]*apiBase="\/labengine"/);
    expect(lab).toMatch(/fetchCatalogue\('\/labengine'\)/);
    expect(lab, 'the Lab must never read /engine').not.toMatch(/['"`]\/engine/);
    expect(lab).toMatch(/data-testid="lab-chart"/);
    const proxy = code('labengine/[...path]/route.ts');
    expect(proxy).toMatch(/process\.env\.OTC_LAB_BASE/);
    expect(proxy, 'the Lab engine proxy must not know production').not.toMatch(
      /OTC_API_BASE|OTC_ADMIN_TOKEN/,
    );
    expect(proxy).toMatch(/export async function GET/);
    expect(proxy).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)/);
    // Environment is a runtime fact: the declaration is a dynamic route the banner asks on mount,
    // never a module-level read that the build would bake as false.
    const layout = code('layout.tsx');
    expect(layout).toMatch(/<LabModeBanner \/>/);
    expect(layout).not.toMatch(/process\.env\.OTC_LAB_BASE/);
    const declaration = code('labmode/route.ts');
    expect(declaration).toMatch(/export const dynamic = 'force-dynamic';/);
    expect(declaration).toMatch(
      /isLabMode\(process\.env\.OTC_LAB_BASE, process\.env\.OTC_API_BASE\)/,
    );
    const banner = code('LabModeBanner.tsx');
    expect(banner).toMatch(/fetch\('\/labmode'/);
  });

  it('recovers by itself after an outage (PH-24.14)', () => {
    // The chart's first load fails into the same backoff the stream uses, never a dead status line.
    const chart = code('preview/PreviewChart.tsx');
    const mountCatch =
      /void run\(\)\.catch\(\(error: unknown\) => \{\s*if \(controller\.signal\.aborted\) return;\s*([^}]*)\}\);/.exec(
        chart,
      );
    expect(mountCatch, 'the mount-time run().catch is gone').not.toBeNull();
    expect(mountCatch![1]).toMatch(/retryLater\(\(error as Error\)\.message\)/);
    expect(mountCatch![1]).not.toMatch(/setStatus\(/);
    // The Lab's notice tells a transport failure from "not configured".
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/es\.lab\.unreachable/);
    expect(lab).toMatch(/\? es\.lab\.notRunning\s*: es\.lab\.unreachable/);
  });

  it('the browser suites never build into the served panel directory (PH-24.14)', () => {
    const config = strip(readFileSync(path.join(app, '..', '..', 'next.config.mjs'), 'utf8'));
    expect(config).toMatch(/distDir: process\.env\.OTC_NEXT_DIST_DIR \?\? '\.next'/);
    for (const suite of ['lab.stat.test.ts', 'panel.stat.test.ts']) {
      const source = strip(readFileSync(path.join(app, '..', suite), 'utf8'));
      expect(source, `${suite} names the suite's own build directory`).toMatch(
        /const STAT_DIST_DIR = '\.next-stat';/,
      );
      // Once for the build, once for the start: both must agree on the directory.
      expect(
        source.match(/OTC_NEXT_DIST_DIR: STAT_DIST_DIR/g) ?? [],
        `${suite} build and start`,
      ).toHaveLength(2);
    }
    // Next rewrites tsconfig's include and next-env.d.ts for the build directory it used:
    // both globs are listed so nothing is rewritten, and the generated file is not tracked.
    const tsconfig = JSON.parse(
      readFileSync(path.join(app, '..', '..', 'tsconfig.json'), 'utf8'),
    ) as {
      include: string[];
    };
    expect(tsconfig.include).toContain('.next/types/**/*.ts');
    expect(tsconfig.include).toContain('.next-stat/types/**/*.ts');
    const gitignore = readFileSync(path.join(app, '..', '..', '..', '..', '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^apps\/web\/next-env\.d\.ts$/m);
    expect(gitignore).toMatch(/^\.next-stat\/$/m);
    // And the linter must not read it: the first isolated gate failed on 536 generated-file errors.
    const eslint = readFileSync(path.join(app, '..', '..', '..', '..', 'eslint.config.js'), 'utf8');
    expect(eslint).toMatch(/'\*\*\/\.next-stat\/\*\*'/);
  });

  it('offers the push its pace — normal, medio, rápido — and sends it with every push (PH-24.15)', () => {
    const strip = code('lab/Empujar.tsx');
    for (const key of ['normal', 'medio', 'rapido']) {
      expect(strip).toMatch(new RegExp(`lab-push-pace-`));
      expect(strip).toMatch(new RegExp(`'${key}'`));
    }
    expect(strip).toMatch(/p\.pace\.label/);
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/useState<Pace>\('rapido'\)/);
    // PH-24.18: the buttons send distances in the market's unit.
    expect(lab).toMatch(/push\?distance=\$\{String\(ticks\)\}&pace=\$\{pace\}/);
    expect(strip).toMatch(/(data-testid|testId)="lab-push-unit"/);
  });

  it('offers sube / baja as toggles that go to the bias route (PH-24.16)', () => {
    const strip = code('lab/Empujar.tsx');
    expect(strip).toMatch(/testId="lab-bias-up"/);
    expect(strip).toMatch(/testId="lab-bias-down"/);
    // A second click on the active direction turns it off.
    expect(strip).toMatch(/onBias\(bias === 1 \? 'off' : 'up'\)/);
    expect(strip).toMatch(/onBias\(bias === -1 \? 'off' : 'down'\)/);
    expect(strip).toMatch(/p\.bias\.active\(/);
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/markets\/\$\{selected\}\/bias\?direction=\$\{direction\}/);
  });

  it('shows tick granularity on Calidad, measured by the Lab package (PH-24.17)', () => {
    const calidad = code('lab/Calidad.tsx');
    for (const handle of [
      'lab-granularity',
      'lab-granularity-ticks',
      'lab-granularity-gap',
      'lab-granularity-step',
      'lab-granularity-interval',
    ]) {
      expect(calidad, `${handle} missing`).toMatch(new RegExp(`(data-testid|testId)="${handle}"`));
    }
    expect(calidad).toMatch(/quality\.granularity\.gapOverRange\.shareAboveQuarter/);
    const api = readFileSync(
      path.join(app, '..', '..', '..', 'api', 'src', 'lab', 'lab.controller.ts'),
      'utf8',
    );
    expect(api).toMatch(/tickGranularity\(ticks\)/);
  });

  it('names an apply adjusted by parity (PH-24.17)', () => {
    const cierre = code('lab/Cierre.tsx');
    expect(cierre).toMatch(/(data-testid|testId)="lab-close-adjusted"/);
    expect(cierre).toMatch(/plan\.adjusted\.requested, plan\.adjusted\.applied/);
  });

  it("states every distance in the market's unit and converts on the screen (PH-24.18)", () => {
    const cierre = code('lab/Cierre.tsx');
    expect(cierre.match(/onDelta\(d \* unitSteps, true\)/g) ?? []).toHaveLength(2);
    const escenarios = code('lab/Escenarios.tsx');
    expect(escenarios).toMatch(
      /DISTANCE_PARAMS = new Set\(\['net', 'range', 'rise', 'fall', 'level', 'hold'\]\)/,
    );
    expect(escenarios).toMatch(/Math\.round\(entered \* unitSteps\)/);
    expect(escenarios).toMatch(
      /size: Math\.max\(1, Math\.round\(Number\(shockSize\) \* unitSteps\)\)/,
    );
    // The level the target route receives is the entered units times the unit (Prettier may wrap it).
    expect(escenarios).toMatch(/level: Math\.round\(\s*Number\([\s\S]*?\) \* unitSteps,?\s*\)/);
    const lab = code('lab/Lab.tsx');
    // Cierre and Escenarios on the instrument; the panel's ▲ ▼ step in price, not in steps (PH-24.20).
    expect(lab.match(/unitSteps=\{state\?\.distance\?\.unitSteps \?\? 1\}/g) ?? []).toHaveLength(2);
  });

  it('is a control panel: the chart at three quarters, four cards at one quarter, the instrument behind a link (PH-24.19)', () => {
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/gridTemplateColumns: '3fr 1fr'/);
    expect(lab).toMatch(/<TopBar/);
    expect(lab).toMatch(/<Controles/);
    expect(lab).toMatch(/data-testid="lab-advanced-link"/);
    expect(lab).toMatch(/href="\/lab\/avanzado"/);
    const controles = code('lab/Controles.tsx');
    // Two cards since PH-24.20 (four in PH-24.19); never a table.
    for (const card of ['lab-card-push', 'lab-card-close']) {
      expect(controles, `${card} missing`).toMatch(new RegExp(`testId="${card}"`));
    }
    expect(controles).not.toMatch(/<table|<Row\b/);
    expect(code('lab/page.tsx')).toMatch(/<Lab mode="control" \/>/);
    expect(code('lab/avanzado/page.tsx')).toMatch(/<Lab mode="avanzado" \/>/);
  });

  it('the panel is two cards of controls and nothing else (PH-24.20)', () => {
    const controles = code('lab/Controles.tsx');
    expect(controles.match(/<Card[\s>]/g) ?? []).toHaveLength(2);
    // Empuje: the pace as three windows; a green row and a red row of the same
    // sizes; sube and baja are toggles that release on the second press — no libre.
    expect(controles).toMatch(/testPrefix="lab-pace"/);
    expect(controles).toMatch(/testId=\{`lab-push-\+\$\{String\(n\)\}`\}/);
    expect(controles).toMatch(/testId=\{`lab-push--\$\{String\(n\)\}`\}/);
    expect(controles).toMatch(/onBias\(bias === 1 \? 'off' : 'up'\)/);
    expect(controles).toMatch(/onBias\(bias === -1 \? 'off' : 'down'\)/);
    expect(controles).toMatch(/aria-pressed=\{pressed\}/);
    expect(controles).not.toMatch(
      /lab-direction-free|lab-direction-state|lab-push-state|lab-push-unit|<Empujar|<Badge/,
    );
    // Cierre: two windows on the chart's own timeframe; = ▲ ▼ on the price box;
    // fijar and × alternating in one place.
    expect(controles).toMatch(/testPrefix="lab-close-bucket"/);
    expect(controles).not.toMatch(/lab-close-timeframe|<select|lab-close-delta|lab-close-status/);
    // = ▲ ▼ are the close's condition since PH-24.21; a between-levels answer is said, with the two.
    expect(controles).toMatch(/es\.lab\.close\.between\(/);
    expect(controles).toMatch(
      /armedClose \? \([\s\S]*?testId="lab-close-release"[\s\S]*?\) : \([\s\S]*?testId="lab-close-apply"/,
    );
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/closeTimeframe=\{panelCloseTf\}/);
    expect(lab).toMatch(/timeframe=\$\{closeTf\}/);
    expect(lab).not.toMatch(/timeframe=\$\{tf\}/);
    const block = /<Controles[\s\S]*?\/>/.exec(lab)?.[0] ?? '';
    expect(block).not.toMatch(/onTimeframe|onDelta|onNeighbour|unitSteps/);
    // The strip is the instrument's alone again.
    expect(code('lab/Empujar.tsx')).not.toMatch(/layout/);
  });

  it('SUBIENDO / BAJANDO, the mark on the chart, and the close condition = ▲ ▼ (PH-24.21)', () => {
    const controles = code('lab/Controles.tsx');
    expect(controles).toMatch(/data-testid="lab-push-direction"/);
    expect(controles).toMatch(/direction === 1 \? p\.rising : p\.falling/);
    expect(controles).toMatch(/testPrefix="lab-close-condition"/);
    expect(controles).not.toMatch(
      /lab-close-equal|lab-close-up|lab-close-down|@otc\/core\/browser/,
    );
    // The lattice arithmetic lives in one place, with the kernel's portable ln / exp.
    const lattice = code('lab/lattice.ts');
    expect(lattice).toMatch(/import \{ exp, ln \} from '@otc\/core\/browser'/);
    expect(lattice).toMatch(
      /Math\.round\(ln\(price \/ lattice\.referencePrice\) \/ lattice\.logQuantum\)/,
    );
    expect(lattice).toMatch(/exp\(lattice\.logQuantum \* level\)/);
    expect(lattice).not.toMatch(/Math\.(log|exp)\(/);
    // A click on the chart names a price from the series' own scale; the mark is one line, removed when cleared.
    const chart = code('preview/PreviewChart.tsx');
    expect(chart).toMatch(/subscribeClick\(/);
    expect(chart).toMatch(/coordinateToPrice\(param\.point\.y\)/);
    expect(chart).toMatch(/removePriceLine\(markLine\.current\)/);
    const lab = code('lab/Lab.tsx');
    expect(lab).toMatch(/nearestLevelPrice\(lattice, picked\)/);
    expect(lab).toMatch(/onPick=\{pickPrice\}/);
    expect(lab).toMatch(/mark=\{marked\}/);
    expect(lab).toMatch(/&condition=\$\{closeCondition\}/);
  });

  it("the chart counts down to the end of the candle now forming, on the market's clock (PH-24.22)", () => {
    const chart = code('preview/PreviewChart.tsx');
    expect(chart).toMatch(/data-testid="chart-countdown"/);
    // The kernel's bucket end on the kernel's timeframe: the alignment every close uses.
    expect(chart).toMatch(/bucketEnd\(epochMillis\(Math\.floor\(now\)\), tf\)/);
    expect(chart).toMatch(/const tf = timeframe\(timeframeId\)/);
    // Anchored on the last tick's instant, advanced by the interval since it arrived — never Date.now().
    expect(chart).toMatch(/clock\.instant \+ \(performance\.now\(\) - clock\.receivedAt\)/);
    const compute = /const compute = \(\): void => \{[\s\S]*?\n {4}\};/.exec(chart)?.[0] ?? '';
    expect(compute, 'the countdown computation').not.toBe('');
    expect(compute).not.toMatch(/Date\.now/);
    // Recomputed at once on a timeframe change; the interval is cleared.
    expect(chart).toMatch(/\}, \[clock, timeframeId\]\);/);
    expect(chart).toMatch(/return \(\) => clearInterval\(handle\);/);
    // Out of the way of a click meant for the chart, and above the library's canvases.
    expect(chart).toMatch(/pointerEvents: 'none'/);
    expect(chart).toMatch(/zIndex: [1-9]/);
  });

  it('every field entered in units says «unidades», and none says «pasos» (a5)', () => {
    // **Cycle Audit 8 (a5).** PH-24.18 made the scenarios' displacement
    // parameters, the shock size and the target price be entered in candle
    // units and multiplied by `unitSteps` on the screen — and left every label
    // reading «pasos». An operator asking for a net displacement of 20 was
    // asking for twenty units, roughly a thousand to four thousand lattice
    // steps: five candles where they meant a fraction of one.
    const strings = read('../lib/es.ts');
    const params = /params: \{([\s\S]*?)\} as Record<string, string>,/.exec(strings)?.[1] ?? '';
    expect(params, 'the scenarios parameter labels').not.toBe('');
    for (const name of ['net', 'range', 'rise', 'fall', 'level', 'hold']) {
      const label = new RegExp(`${name}: '([^']*)'`).exec(params)?.[1] ?? '';
      expect(label, `${name} has no label`).not.toBe('');
      expect(label, `${name} is entered in units and labelled «${label}»`).toMatch(/unidades/);
      expect(label, `${name} still says «pasos»`).not.toMatch(/pasos/);
    }
    // depth is a fraction and changes a count: neither is converted, neither
    // carries a unit — and the guard would be vacuous if it did not say so.
    expect(/depth: '([^']*)'/.exec(params)?.[1]).not.toMatch(/unidades|pasos/);
    expect(/changes: '([^']*)'/.exec(params)?.[1]).not.toMatch(/unidades|pasos/);
    // The shock size and the target price's relative field are converted too.
    expect(/size: '([^']*)'/.exec(strings)?.[1]).toMatch(/unidades/);
    expect(/steps: 'o ([^']*)'/.exec(strings)?.[1]).toMatch(/unidades/);
    // And the screen says what a unit is, where the fields are.
    expect(code('lab/Escenarios.tsx')).toMatch(/data-testid="lab-scenario-unit"/);
    expect(code('lab/Escenarios.tsx')).toMatch(/es\.lab\.scenarios\.unitNote\(unitPrice\)/);
  });

  it('a sustained direction shows what it has left, and one clock formats every countdown (PH-24.24)', () => {
    const controles = code('lab/Controles.tsx');
    expect(controles).toMatch(/data-testid="lab-direction-left"/);
    // Only when the Lab said how long is left: a missing field is not «0:00».
    expect(controles).toMatch(
      /typeof msLeft !== 'number' \|\| msLeft <= 0 \? null : formatCountdown/,
    );
    // The instrument's own toggles carry it too, because the ⓘ promises it there.
    expect(code('lab/Empujar.tsx')).toMatch(/data-testid=\{bias === 1 && biasLeft !== null/);
    // The board counts a sustained direction as something running, and releasable.
    const board = code('lab/Tablero.tsx');
    expect(board).toMatch(/m\.armed \|\| \(m\.bias \?\? null\) !== null/);
    expect(board).not.toMatch(/\barmed === 0\b/);
    // A stale poll or an error body is never rendered as this market's control.
    const lab2 = code('lab/Lab.tsx');
    // Both awaits, not one: the state read and the batch that follows it.
    expect(lab2.match(/if \(selectedRef\.current !== asset\) return;/g) ?? []).toHaveLength(2);
    expect(lab2).toMatch(/if \(isControl\(ctl\)\) setControl\(ctl\);/);
    // And the safety event has a name in the operator's language.
    expect(read('../lib/es.ts')).toMatch(/'bias\.expired':/);
    expect(controles).toMatch(/import \{ formatCountdown \} from '\.\.\/\.\.\/lib\/countdown\.js'/);
    // One implementation, shared with the chart's candle countdown (PH-24.22).
    expect(code('preview/PreviewChart.tsx')).toMatch(
      /import \{ formatCountdown \} from '\.\.\/\.\.\/lib\/countdown\.js'/,
    );
    expect(code('preview/PreviewChart.tsx')).not.toMatch(/function formatCountdown/);
    // And the operator is told the cap in words, where the act is explained.
    expect(read('../lib/es.ts')).toMatch(/dos minutos como máximo/);
  });

  it('says the Lab is absent rather than hiding that it can be', () => {
    expect(lab()).toMatch(/lab-not-running/);
    expect(code('lab/[...path]/route.ts')).toMatch(/OTC_LAB_BASE/);
    expect(code('lab/[...path]/route.ts'), 'the panel proxies the Lab to the engine').not.toMatch(
      /OTC_API_BASE/,
    );
  });
});
