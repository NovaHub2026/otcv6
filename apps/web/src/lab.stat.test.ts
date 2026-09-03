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

  it('applies an exact close to the next 30-second candle and the candle closes there', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1200 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="lab-control"]', { timeout: 30_000 });
    // The banner is permanent (§3).
    expect(await page.locator('body').innerText()).toMatch(/OTC LAB/);
    expect(await page.locator('body').innerText()).toMatch(/SIMULATION ENVIRONMENT/);

    // The price on screen, as the operator reads it.
    await page.waitForFunction(() => /\nprice\n[0-9.]+\n/.test(document.body.innerText), null, {
      timeout: 30_000,
    });
    const price = /\nprice\n([0-9.]+)\n/.exec(await page.locator('body').innerText())![1]!;

    await page.selectOption('[data-testid="lab-close-timeframe"]', '30s');
    await page.selectOption('[data-testid="lab-close-bucket"]', 'next');
    await page.fill('[data-testid="lab-close-price"]', price);
    await page.click('[data-testid="lab-close-preview"]');
    await page.waitForSelector('[data-testid="lab-close-plan"]', { timeout: 30_000 });
    const plan = await text(page, 'lab-close-plan');
    if (/parity/.test(plan)) {
      // Half the lattice is off-parity for any window; the screen names the
      // two reachable neighbours as buttons, and choosing one *is* the apply.
      await page.locator('[data-testid="lab-close-plan"] button').first().click();
    } else {
      expect(plan).not.toMatch(/outside-natural-range/);
      await page.click('[data-testid="lab-close-apply"]');
    }
    await page.waitForFunction(
      () => /ARMED/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    const target = /target\n([0-9.]+)/.exec(await text(page, 'lab-close-plan'))![1]!;

    // The next 30-second candle ends within a minute. The outcome line is the
    // Lab's own reading of its record at the candle's end.
    await page.waitForFunction(
      () =>
        /closed at/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
      null,
      { timeout: 120_000 },
    );
    const control = await text(page, 'lab-control');
    expect(control, `the candle did not close on ${target}`).toMatch(/EXACT/);
    expect(control).not.toMatch(/MISSED/);

    // Both acts are in the Lab timeline and nothing is in the engine's.
    const session = await text(page, 'lab-session-lab');
    expect(session).toMatch(/close\.apply ✓/);
    // PH-24.5 feeds the engine column by observing the engine; what must never
    // appear there is a Lab action.
    expect(await text(page, 'lab-session-engine')).not.toMatch(
      /close\.apply|preset\.apply|scenario\.apply/,
    );
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);
  it('opens a CALL, applies WIN by minimum distance, and settlement agrees', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1400 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
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
    await page.waitForFunction(() => /ARMED|parity/.test(document.body.innerText), null, {
      timeout: 30_000,
    });
    if (/parity/.test(await page.locator('body').innerText())) {
      // The preset named entry and entry + 2; choosing the one above entry
      // applies it at the position's expiry — the screen carries the instant.
      await page.locator('[data-testid="lab-close-plan"] button').last().click();
      await page.waitForFunction(
        () =>
          /ARMED/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
        null,
        { timeout: 30_000 },
      );
    }
    await page.waitForSelector(`[data-testid="lab-position-${id}-actual"]`, { timeout: 120_000 });
    const actual = await page.locator(`[data-testid="lab-position-${id}-actual"]`).innerText();
    expect(actual).toMatch(/agrees/);
    expect(actual).not.toMatch(/DISAGREES/);
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);
  it('applies a scenario from the panel and the control row reads ARMED', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1280, height: 1600 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${webPort}/lab`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="lab-scenario-bullish-trend"]', { timeout: 30_000 });
    // The two the signs cannot express are disabled, with their reason on screen.
    expect(await page.locator('[data-testid="lab-scenario-extreme-volatility"]').isDisabled()).toBe(
      true,
    );
    expect(await text(page, 'lab-scenario-why-low-activity')).toMatch(/arrival/);
    await page.click('[data-testid="lab-scenario-bullish-trend"]');
    await page.fill('[data-testid="lab-scenario-param-net"]', '3');
    await page.click('[data-testid="lab-scenario-preview"]');
    await page.waitForSelector('[data-testid="lab-scenario-plan"]', { timeout: 30_000 });
    expect(await text(page, 'lab-scenario-plan')).toMatch(/armed\nno/);
    await page.click('[data-testid="lab-scenario-apply"]');
    await page.waitForFunction(
      () => /ARMED/.test(document.querySelector('[data-testid="lab-control"]')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    expect(await text(page, 'lab-scenario-plan')).toMatch(/armed\nYES/);
    expect(await text(page, 'lab-session-lab')).toMatch(/scenario\.apply ✓/);
    // PH-24.5: the engine's timeline is fed by observing the engine — at least
    // its first sight of every market — and the closes diagnostic says what it
    // rests on rather than calling this session's handful a pattern.
    await page.waitForFunction(
      () =>
        /observed: regime/.test(
          document.querySelector('[data-testid="lab-session-engine"]')?.textContent ?? '',
        ),
      null,
      { timeout: 30_000 },
    );
    expect(await text(page, 'lab-session-engine')).not.toMatch(
      /close\.apply|scenario\.apply|preset\.apply/,
    );
    const closes = await text(page, 'lab-closes');
    expect(closes).toMatch(/a verdict needs 10/);
    expect(closes).toMatch(/TOO-FEW-TO-SAY|NO-PATTERN|ONE-SIDED/);
    expect(errors).toEqual([]);
    await page.close();
  }, 300_000);
});
