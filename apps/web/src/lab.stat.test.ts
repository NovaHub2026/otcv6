import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';

/**
 * Candle Close Control, from the panel, in a browser (PH-24.2 criterion 7).
 *
 * The Lab process is booted from `apps/api/dist/lab/lab.main.js` — the real
 * composition, not a controller constructed in a test — the panel is built and
 * pointed at it, and an operator's flow is driven through Chromium: read the
 * price, ask for a close on the next 30-second candle, take a reachable
 * neighbour if parity refuses the first, apply, and wait for the candle to end.
 * The assertion is the screen's own outcome line, which the Lab computes the
 * way settlement reads (ADR-0017): `closed at <price> — EXACT`.
 *
 * Skips, by name, where Chromium cannot launch; fails where `OTC_REQUIRE_BROWSER=1`
 * (CI). Same discipline as `panel.stat.test.ts`, whose helpers this mirrors.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** The suite's own build directory (PH-24.14): never the operator's `.next`. */
const STAT_DIST_DIR = '.next-stat';
const SECRET = 'ab'.repeat(32);
const TOKEN = 'lab-test-token-'.padEnd(32, 'l');
const BROWSER_LIBRARIES =
  'sudo apt-get install -y libnss3 libnspr4 libasound2t64 — or, without root, ' +
  'apt-get download those three, `dpkg-deb -x` each into a prefix, and point ' +
  'LD_LIBRARY_PATH at <prefix>/usr/lib/x86_64-linux-gnu';

const started: ChildProcess[] = [];
const directories: string[] = [];
let browser: Browser | null = null;
let labPort = 0;
let webPort = 0;
let unavailable: string | null = null;

afterAll(async () => {
  if (browser !== null) await browser.close();
  for (const child of started) killGroup(child);
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

function killGroup(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

async function waitUntilReady(
  port: number,
  pathname: string,
  child: ChildProcess,
  ready: (response: Response) => Promise<boolean>,
): Promise<void> {
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited (${child.exitCode}):\n${output.slice(-2_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
      if (response.ok && (await ready(response))) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`never became healthy on ${port}:\n${output.slice(-2_000)}`);
}

/** The Lab: the real entry point, its own state directory, a nonce so it is known to be ours. */
async function bootLab(port: number): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-lab-'));
  directories.push(stateDir);
  const nonce = `lab-${String(process.pid)}-${String(Date.now())}`;
  const child = spawn(process.execPath, [path.join(repoRoot, 'apps/api/dist/lab/lab.main.js')], {
    env: {
      ...process.env,
      OTC_STATE_DIR: stateDir,
      OTC_HISTORY_DB: path.join(stateDir, 'history.db'),
      OTC_MASTER_SECRET: SECRET,
      OTC_ADMIN_TOKEN: TOKEN,
      OTC_BACKFILL_DAYS: '0',
      OTC_BOOT_NONCE: nonce,
      OTC_LAB_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  started.push(child);
  await waitUntilReady(port, '/health', child, async (response) => {
    const body = (await response.json()) as { bootNonce?: string };
    return body.bootNonce === nonce;
  });
}

/** The panel, pointed at the Lab for both its engine and its Lab base. */
async function bootPanel(port: number, lab: number): Promise<void> {
  const next = path.join(repoRoot, 'node_modules/next/dist/bin/next');
  const child = spawn(process.execPath, [next, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: path.join(repoRoot, 'apps/web'),
    env: {
      ...process.env,
      OTC_NEXT_DIST_DIR: STAT_DIST_DIR,
      OTC_API_BASE: `http://127.0.0.1:${lab}`,
      OTC_LAB_BASE: `http://127.0.0.1:${lab}`,
      OTC_ADMIN_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  started.push(child);
  await waitUntilReady(port, '/lab', child, async (response) => (await response.text()).length > 0);
}

async function build(): Promise<void> {
  const child = spawn('npm', ['run', 'build:web'], {
    cwd: repoRoot,
    env: { ...process.env, OTC_NEXT_DIST_DIR: STAT_DIST_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number>((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`next build failed (${code}):\n${output.slice(-3_000)}`);
}

beforeAll(async () => {
  try {
    browser = await chromium.launch();
  } catch (error) {
    const detail = String(error).slice(0, 300);
    if (process.env['OTC_REQUIRE_BROWSER'] === '1') {
      throw new Error(
        `A browser is required here and could not be launched. ${detail}\n` +
          `Install the system libraries it links against:\n  ${BROWSER_LIBRARIES}`,
      );
    }
    unavailable = `no browser: ${detail.split('\n')[0] ?? ''}`;
    console.warn(`lab.stat.test.ts: SKIPPED — ${unavailable}. Enable with: ${BROWSER_LIBRARIES}`);
    return;
  }
  await build();
  labPort = await freePort();
  await bootLab(labPort);
  webPort = await freePort();
  await bootPanel(webPort, labPort);
}, 900_000);

describe('Candle Close Control, from the panel', () => {
  const requireBrowser = (ctx: TestContext): Browser => {
    if (browser === null) ctx.skip(`no browser — ${unavailable ?? 'not launched'}`);
    return browser;
  };

  const text = async (page: Page, testId: string): Promise<string> =>
    page.locator(`[data-testid="${testId}"]`).innerText();

  /**
   * A failing flow prints what the screen said and which Lab requests failed:
   * a 30-second timeout on `waitForFunction` is otherwise the least informative
   * message a browser test can produce.
   */
  const instrument = (page: Page): { errors: string[]; dump: () => Promise<string> } => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      if (response.url().includes('/lab/') && response.status() >= 400) {
        errors.push(
          `${String(response.status())} ${response.request().method()} ${response.url().slice(-90)}`,
        );
      }
    });
    return {
      errors,
      dump: async () => {
        // The parts a flow acts on, not the page's top: header, control row,
        // plans, positions and the session — hidden tabs included, by textContent.
        const part = async (id: string): Promise<string> => {
          const node = page.locator(`[data-testid="${id}"]`).first();
          return (await node.count()) === 0
            ? `(${id} absent)`
            : `[${id}] ${((await node.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 400)}`;
        };
        const ids = [
          'lab-header',
          'lab-control',
          'lab-close-plan',
          'lab-close-notice',
          'lab-positions',
          'lab-scenario-plan',
          'lab-scenario-notice',
          'lab-session-lab',
          'lab-session-engine',
          'lab-closes',
        ];
        const parts = await Promise.all(ids.map(part));
        return `--- lab requests/errors: ${errors.join(' ; ') || 'none'}\n${parts.join('\n')}`;
      },
    };
  };

  it('applies an exact close to the next 30-second candle and the candle closes there', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1200 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="lab-control"]', { timeout: 30_000 });
      // The banner is permanent (§3).
      expect(await page.locator('body').innerText()).toMatch(/OTC LAB/);
      expect(await page.locator('body').innerText()).toMatch(/SIMULATION ENVIRONMENT/);

      // The price on screen, as the operator reads it.
      // The price sits in the header strip since PH-24.6; the Mercado tab is hidden.
      await page.waitForFunction(
        () =>
          /^[0-9]+\.[0-9]+$/.test(
            document.querySelector('[data-testid="lab-header-price"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      const price = (await text(page, 'lab-header-price')).trim();

      await page.selectOption('[data-testid="lab-close-timeframe"]', '30s');
      await page.selectOption('[data-testid="lab-close-bucket"]', 'next');
      await page.fill('[data-testid="lab-close-price"]', price);
      await page.click('[data-testid="lab-close-preview"]');
      await page.waitForSelector('[data-testid="lab-close-plan"]', { timeout: 30_000 });
      const plan = await text(page, 'lab-close-plan');
      if (/paridad/.test(plan)) {
        // Half the lattice is off-parity for any window; the screen names the
        // two reachable neighbours as buttons, and choosing one *is* the apply.
        await page.locator('[data-testid="lab-close-neighbour"]').first().click();
      } else {
        expect(plan).not.toMatch(/FUERA DEL RANGO/);
        await page.click('[data-testid="lab-close-apply"]');
      }
      await page.waitForFunction(
        () =>
          /ARMADO/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
        null,
        { timeout: 30_000 },
      );
      const target = /objetivo\n([0-9.]+)/.exec(await text(page, 'lab-close-plan'))![1]!;

      // The next 30-second candle ends within a minute. The outcome line is the
      // Lab's own reading of its record at the candle's end.
      await page.waitForFunction(
        () =>
          /cerró en/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
        null,
        { timeout: 120_000 },
      );
      const control = await text(page, 'lab-control');
      expect(control, `the candle did not close on ${target}`).toMatch(/EXACTO/);
      expect(control).not.toMatch(/FALLÓ/);

      // Both acts are in the Lab timeline and nothing is in the engine's.
      const session = await text(page, 'lab-session-lab');
      expect(session).toMatch(/cierre aplicado ✓/);
      // PH-24.5 feeds the engine column by observing the engine; what must never
      // appear there is a Lab action.
      expect(await text(page, 'lab-session-engine')).not.toMatch(
        /cierre aplicado|preset aplicado|escenario aplicado/,
      );
      // PH-24.8: the session can leave, the positions have their own reading,
      // and Mercado shows trend strength as net displacement.
      await page.click('[data-testid="tab-session"]');
      expect(await page.locator('[data-testid="lab-session-export"]').getAttribute('href')).toBe(
        '/lab/session/export',
      );
      const exported = await page.evaluate(async () => {
        const response = await fetch('/lab/session/export');
        return {
          status: response.status,
          type: response.headers.get('content-type') ?? '',
          text: await response.text(),
        };
      });
      expect(exported.status).toBe(200);
      expect(exported.type).toMatch(/ndjson/);
      const lines = exported.text.trim().split('\n');
      expect(JSON.parse(lines[0]!)).toMatchObject({
        stream: 'meta',
        environment: 'OTC LAB — SIMULATION ENVIRONMENT',
      });
      expect(lines.some((l) => /"stream":"lab"/.test(l) && /close\.apply/.test(l))).toBe(true);
      expect(await text(page, 'lab-positions-diagnostic')).toMatch(/un veredicto necesita 10/);
      await page.click('[data-testid="tab-market"]');
      expect(await text(page, 'lab-net-displacement')).toMatch(/en 1 min · .* en 5 min/);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);
  it('opens a CALL, applies WIN by minimum distance, and settlement agrees', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1400 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="tab-positions"]', { timeout: 30_000 });
      await page.click('[data-testid="tab-positions"]');
      await page.waitForSelector('[data-testid="lab-positions"]', { timeout: 30_000 });
      await page.fill('[data-testid="lab-position-stake"]', '100');
      await page.fill('[data-testid="lab-position-horizon"]', '45');
      await page.click('[data-testid="lab-position-call"]');
      await page.waitForSelector('[data-testid^="lab-position-lab-"]', { timeout: 30_000 });
      const row = page.locator('[data-testid^="lab-position-lab-"]').first();
      const id = (await row.getAttribute('data-testid'))!.replace('lab-position-', '');

      // WIN by minimum distance; if parity refuses ±1 the Lab names ±2 and the
      // test takes the plan the screen shows rather than redefining "minimum".
      await page.click(`[data-testid="lab-preset-${id}-win-minimum"]`);
      await page.waitForFunction(() => /ARMADO|paridad/.test(document.body.innerText), null, {
        timeout: 30_000,
      });
      if (/paridad/.test(await page.locator('body').innerText())) {
        // The preset named entry and entry + 2; choosing the one above entry
        // applies it at the position's expiry — the screen carries the instant.
        await page.locator('[data-testid="lab-close-neighbour"]').last().click();
        await page.waitForFunction(
          () =>
            /ARMADO/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
          null,
          { timeout: 30_000 },
        );
      }
      // A preset lands the operator on the Cierre tab (its plan lives there); the
      // settled row is back on Posiciones, so open it before waiting for the row.
      await page.click('[data-testid="tab-positions"]');
      await page.waitForSelector(`[data-testid="lab-position-${id}-actual"]`, { timeout: 120_000 });
      const actual = await page.locator(`[data-testid="lab-position-${id}-actual"]`).innerText();
      expect(actual).toMatch(/COINCIDE/);
      expect(actual).not.toMatch(/NO COINCIDE/);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);
  it('applies a scenario from the panel and the control row reads ARMED', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1600 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="tab-scenarios"]', { timeout: 30_000 });
      await page.click('[data-testid="tab-scenarios"]');
      await page.waitForSelector('[data-testid="lab-scenario-bullish-trend"]', { timeout: 30_000 });
      // The two the signs cannot express are disabled, with their reason on screen.
      expect(
        await page.locator('[data-testid="lab-scenario-extreme-volatility"]').isDisabled(),
      ).toBe(true);
      await page.locator('[data-testid="lab-scenario-why-low-activity"] button').hover();
      expect(await page.locator('[data-testid="info-text"]').first().innerText()).toMatch(
        /llegadas/,
      );
      await page.click('[data-testid="lab-scenario-bullish-trend"]');
      await page.fill('[data-testid="lab-scenario-param-net"]', '3');
      await page.click('[data-testid="lab-scenario-preview"]');
      await page.waitForSelector('[data-testid="lab-scenario-plan"]', { timeout: 30_000 });
      expect(await text(page, 'lab-scenario-plan')).toMatch(/armado\nno/);
      await page.click('[data-testid="lab-scenario-apply"]');
      await page.waitForFunction(
        () =>
          /ARMADO/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
        null,
        { timeout: 30_000 },
      );
      expect(await text(page, 'lab-scenario-plan')).toMatch(/armado\nSÍ/);
      expect(await text(page, 'lab-session-lab')).toMatch(/escenario aplicado ✓/);
      // PH-24.5: the engine's timeline is fed by observing the engine — at least
      // its first sight of every market — and the closes diagnostic says what it
      // rests on rather than calling this session's handful a pattern.
      await page.waitForFunction(
        () =>
          /observado: régimen/.test(
            document.querySelector('[data-testid="lab-session-engine"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      expect(await text(page, 'lab-session-engine')).not.toMatch(
        /close\.apply|scenario\.apply|preset\.apply/,
      );
      const closes = await text(page, 'lab-closes');
      expect(closes).toMatch(/un veredicto necesita 10/);
      expect(closes).toMatch(/DEMASIADO POCOS PARA DECIR|SIN PATRÓN|SESGADO/);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);

  it('PH-24.7: locates a coming shock from the screen and chooses its direction, or says none is coming', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1600 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="tab-scenarios"]', { timeout: 30_000 });
      await page.click('[data-testid="tab-scenarios"]');
      await page.waitForSelector('[data-testid="lab-shock-size"]', { timeout: 30_000 });
      // A step the window cannot contain: the Lab says none is coming, and arms nothing.
      await page.fill('[data-testid="lab-shock-size"]', '100000');
      await page.click('[data-testid="lab-shock-preview"]');
      await page.waitForSelector('[data-testid="lab-shock-at"]', { timeout: 30_000 });
      expect(await text(page, 'lab-shock-at')).toMatch(/No viene/);
      // A step of one: some step in the window is that large; its direction is chosen.
      await page.fill('[data-testid="lab-shock-size"]', '1');
      await page.selectOption('[data-testid="lab-shock-direction"]', '-1');
      await page.click('[data-testid="lab-shock-apply"]');
      await page.waitForFunction(
        () =>
          /viene en el tick/.test(
            document.querySelector('[data-testid="lab-shock-at"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      await page.waitForFunction(
        () =>
          /ARMADO/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
        null,
        { timeout: 30_000 },
      );
      expect(await text(page, 'lab-session-lab')).toMatch(/escenario aplicado ✓/);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);

  it('PH-24.7: closes at a typed time, exactly, from the screen', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1600 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="lab-control"]', { timeout: 30_000 });
      await page.selectOption('[data-testid="lab-close-bucket"]', 'expiry');
      // Forty seconds from now, as HH:MM:SS UTC — the screen resolves it to an instant.
      const at = new Date(Date.now() + 40_000);
      await page.fill('[data-testid="lab-close-expiry"]', at.toISOString().slice(11, 19));
      // A relative target: one of ±1 is reachable in any window with ticks; the
      // parity refusal names the neighbour, which is the act.
      await page.click('[data-testid="lab-close-delta-+1"]');
      await page.waitForSelector('[data-testid="lab-close-plan"]', { timeout: 30_000 });
      if (!/SÍ/.test(await text(page, 'lab-close-plan'))) {
        await page.locator('[data-testid="lab-close-neighbour"]').last().click();
      }
      await page.waitForFunction(
        () =>
          /ARMADO/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
        null,
        { timeout: 30_000 },
      );
      const plan = await text(page, 'lab-close-plan');
      expect(plan).toMatch(new RegExp(`${at.toISOString().slice(11, 16)}`));
      await page.waitForFunction(
        () =>
          /cerró en/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
        null,
        { timeout: 120_000 },
      );
      expect(await text(page, 'lab-control')).toMatch(/EXACTO/);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);

  it('PH-24.7: Target Price touches a level from the screen and says it has no terminal condition', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1600 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      // PH-24.11: Objetivo de precio lives on Escenarios.
      await page.click('[data-testid="tab-scenarios"]');
      await page.waitForSelector('[data-testid="lab-target-steps"]', { timeout: 30_000 });
      await page.fill('[data-testid="lab-target-steps"]', '3');
      await page.click('[data-testid="lab-target-preview"]');
      await page.waitForSelector('[data-testid="lab-target-plan"]', { timeout: 30_000 });
      const preview = await text(page, 'lab-target-plan');
      expect(preview).toMatch(/sin condición de cierre/);
      expect(preview).toMatch(/armado\nno/);
      await page.click('[data-testid="lab-target-apply"]');
      // Wait on this act's own plan: the control row can already read ARMADO from
      // an earlier flow's close on the same Lab, which would pass for nothing.
      await page.waitForFunction(
        () =>
          /SÍ/.test(document.querySelector('[data-testid="lab-target-plan"]')?.textContent ?? ''),
        null,
        { timeout: 30_000 },
      );
      expect(await text(page, 'lab-target-plan')).toMatch(/armado\nSÍ/);
      expect(await text(page, 'lab-session-lab')).toMatch(/escenario aplicado ✓/);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);

  it('PH-24.9: two markets armed read as two rows on the board, and one act releases both', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1600 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="lab-control"]', { timeout: 30_000 });
      for (const asset of ['eurusd', 'gbpjpy']) {
        await page.click(`[data-testid="lab-asset-${asset}"]`);
        await page.waitForTimeout(1_500);
        await page.selectOption('[data-testid="lab-close-bucket"]', 'next');
        await page.click('[data-testid="lab-close-delta-+1"]');
        await page.waitForSelector('[data-testid="lab-close-plan"]', { timeout: 30_000 });
        if (!/SÍ/.test(await text(page, 'lab-close-plan'))) {
          await page.locator('[data-testid="lab-close-neighbour"]').last().click();
        }
        await page.waitForFunction(
          (id) =>
            /ARMADO/.test(
              document.querySelector(`[data-testid="lab-asset-badge-${id}"]`)?.textContent ?? '',
            ),
          asset,
          { timeout: 30_000 },
        );
      }
      await page.click('[data-testid="tab-board"]');
      await page.waitForSelector('[data-testid="lab-board"]', { timeout: 30_000 });
      expect(await text(page, 'lab-board-state-eurusd')).toMatch(/ARMADO/);
      expect(await text(page, 'lab-board-state-gbpjpy')).toMatch(/ARMADO/);
      await page.click('[data-testid="lab-release-all"]');
      await page.waitForFunction(
        () =>
          /keystream/.test(
            document.querySelector('[data-testid="lab-board-state-eurusd"]')?.textContent ?? '',
          ) &&
          /keystream/.test(
            document.querySelector('[data-testid="lab-board-state-gbpjpy"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      await page.click('[data-testid="tab-session"]');
      const session = await text(page, 'lab-session-lab');
      expect((session.match(/liberado ✓/g) ?? []).length).toBeGreaterThanOrEqual(2);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);

  it('PH-24.10/24.11: pushes +3 from the strip — running, then landed where announced; a push over an armed close releases it', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1200 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="lab-control"]', { timeout: 30_000 });
      await page.waitForFunction(
        () =>
          /^[0-9]+\.[0-9]+$/.test(
            document.querySelector('[data-testid="lab-header-price"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      // Nothing armed from an earlier flow: the proxy signs the write.
      await page.evaluate(() => fetch('/lab/release-all', { method: 'POST' }));
      await page.waitForFunction(
        () =>
          /sin empuje/.test(
            document.querySelector('[data-testid="lab-push-state"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      // The strip is on every tab.
      await page.click('[data-testid="tab-board"]');
      expect(await page.locator('[data-testid="lab-push"]').isVisible()).toBe(true);
      await page.click('[data-testid="tab-close"]');

      // PH-24.15: the pace is chosen on the strip and travels with the push.
      await page.click('[data-testid="lab-push-pace-rapido"]');
      const clickedAt = performance.now();
      await page.click('[data-testid="lab-push-+3"]');
      // PH-24.13: the burst lands in about a second, often before the strip's next
      // poll — the running state is not waited for; the landing line stays on the
      // strip until the record has the landing, and the outcome follows.
      await page.waitForSelector('[data-testid="lab-push-landing"]', { timeout: 30_000 });
      const landing = /llegará a ([0-9.]+) tras (\d+) ticks/.exec(
        await text(page, 'lab-push-landing'),
      );
      expect(landing, 'the strip did not announce a landing').not.toBeNull();
      expect(landing![2]).toBe('3');
      expect(await text(page, 'lab-push-landing')).toMatch(/rápido/i);

      // Three ticks later the record is read at the landing's sequence — and with
      // PH-24.13's burst, "later" is seconds: the pending tick was retracted and the
      // pushed ticks arrived at the engine's fastest pace.
      await page.waitForSelector('[data-testid="lab-push-outcome"]', { timeout: 120_000 });
      const landedAfterMs = performance.now() - clickedAt;
      console.log(`PH-24.13 push landed ${String(Math.round(landedAfterMs))} ms after the click`);
      expect(landedAfterMs, 'a push should land within seconds').toBeLessThan(6_000);
      const outcome = await text(page, 'lab-push-outcome');
      expect(outcome).toMatch(/↑ 3 ticks · llegó a/);
      expect(outcome, `landed elsewhere than ${landing![1]!}`).toContain(
        `llegó a ${landing![1]!} ✓`,
      );
      // The API's own account agrees: landed exactly where announced.
      const own = (await page.evaluate(async () => {
        const list = (await (await fetch('/lab/markets')).json()) as { markets: { id: string }[] };
        const first = list.markets[0]!.id;
        return (await (await fetch(`/lab/markets/${first}/control`)).json()) as unknown;
      })) as {
        lastPush: { exact: boolean | null; landingPrice: string; landedPrice: string | null };
      };
      expect(own.lastPush.exact).toBe(true);
      expect(own.lastPush.landedPrice).toBe(landing![1]!);
      await page.waitForFunction(
        () =>
          /push/.test(document.querySelector('[data-testid="lab-session-lab"]')?.textContent ?? ''),
        null,
        { timeout: 30_000 },
      );

      // PH-24.15: a medio push lands too, and the session records its pace.
      await page.click('[data-testid="lab-push-pace-medio"]');
      await page.click('[data-testid="lab-push--1"]');
      await page.waitForFunction(
        () =>
          /↓ 1 ticks · llegó a/.test(
            document.querySelector('[data-testid="lab-push-outcome"]')?.textContent ?? '',
          ),
        null,
        { timeout: 60_000 },
      );
      await page.waitForFunction(
        () =>
          /pace=medio/.test(
            document.querySelector('[data-testid="lab-session-lab"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      // PH-24.11: a push over an armed close releases it and says so on the strip.
      const markets = (await page.evaluate(
        async () => (await (await fetch('/lab/markets')).json()) as unknown,
      )) as { markets?: { id: string }[] };
      const id = markets.markets?.[0]?.id;
      expect(id).toBeDefined();
      let armed = false;
      for (const delta of ['2', '1', '-1', '3']) {
        const body = (await page.evaluate(
          async (url) => (await (await fetch(url, { method: 'POST' })).json()) as unknown,
          `/lab/markets/${id!}/close?delta=${delta}&bucket=next&timeframe=1m`,
        )) as { armed?: boolean };
        if (body.armed === true) {
          armed = true;
          break;
        }
      }
      expect(armed, 'no relative close could be armed').toBe(true);
      await page.waitForFunction(
        () =>
          /ARMADO/.test(
            document.querySelector('[data-testid="lab-header-armed"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      // The buttons are not held by the armed close.
      expect(await page.locator('[data-testid="lab-push-+1"]').isDisabled()).toBe(false);
      await page.click('[data-testid="lab-push-+1"]');
      await page.waitForSelector('[data-testid="lab-push-released"]', { timeout: 30_000 });
      expect(await text(page, 'lab-push-released')).toMatch(/se liberó lo que estaba armado/);
      // The timeline is the strip's next poll away; the release is in the record already.
      await page.waitForFunction(
        () =>
          /liberado ✓ by=push/.test(
            document.querySelector('[data-testid="lab-session-lab"]')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      await page.evaluate(() => fetch('/lab/release-all', { method: 'POST' }));
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);

  it('PH-24.12: one engine — the Lab draws its chart from the Lab engine, and every screen declares Lab mode', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1200 } });
    const { errors, dump } = instrument(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="lab-control"]', { timeout: 30_000 });
      // The chart is on the Lab screen and goes live from the Lab's engine routes.
      expect(await page.locator('[data-testid="lab-chart"]').isVisible()).toBe(true);
      await page.waitForFunction(
        () =>
          /en vivo|live/i.test(
            document.querySelector('[data-testid="lab-chart"] [data-testid="stream-status"]')
              ?.textContent ?? '',
          ),
        null,
        { timeout: 60_000 },
      );
      expect(
        await page.locator('[data-testid="lab-chart"] [data-testid="last-price"]').textContent(),
      ).toMatch(/^[0-9]+\.[0-9]+$/);
      // The proxy reaches the Lab's engine: the same markets /lab names.
      const ids = await page.evaluate(async () => {
        const viaProxy = (await (await fetch('/labengine/lab/markets')).json()) as {
          markets: { id: string }[];
        };
        const direct = (await (await fetch('/lab/markets')).json()) as {
          markets: { id: string }[];
        };
        const catalogue = (await (await fetch('/labengine/catalogue')).json()) as { id: string }[];
        return {
          proxy: viaProxy.markets.map((m) => m.id).sort(),
          direct: direct.markets.map((m) => m.id).sort(),
          catalogue: catalogue.map((c) => c.id).sort(),
        };
      });
      expect(ids.proxy).toEqual(ids.direct);
      expect(ids.catalogue).toEqual(ids.direct);
      // A write through the read-only proxy is refused — probed outside the page, so the
      // browser's own console line about a 405 is not counted as a page error.
      expect(
        (await page.request.post(`http://127.0.0.1:${webPort}/labengine/lab/release-all`)).status(),
      ).toBe(405);
      // The harness points both bases at one process: Vista declares Lab mode; the Lab screen does not repeat it.
      expect(await page.locator('[data-testid="lab-mode-banner"]').count()).toBe(0);
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="lab-mode-banner"]', { timeout: 30_000 });
      expect(await text(page, 'lab-mode-banner')).toMatch(/OTC LAB/);
    } catch (error) {
      console.error(await dump());
      throw error;
    }
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);
});
