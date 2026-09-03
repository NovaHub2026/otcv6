// Invariant evidence: INV-002 (shared market), INV-004 (timeframe observer independence).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';

/**
 * The panel, under a real browser, against a real engine.
 *
 * ## Why this exists, and why it is the first thing PH-20 built
 *
 * In one day the Human Owner found three real defects by opening the panel:
 *
 * 1. the engine sent no CORS headers, so the browser blocked every request;
 * 2. the panel needed a second port open and free on the host, and the first
 *    machine it met already had 3000 taken;
 * 3. the chart had **no height** — its grid row sized to content and a chart
 *    container has none — so nothing was drawn while the candles arrived.
 *
 * The gate was green for all three. 2,050 tests, and **not one of them
 * referenced `apps/web/src`** (Cycle Audit 6, CA6-10). Every check in this
 * repository talks to the service with `fetch` from Node, where there is no
 * same-origin policy, no port forwarding, no layout and no canvas. **A suite
 * that only tests the server from the server cannot see the client's world.**
 *
 * So this drives the real production build in a real browser and asserts the
 * things `fetch` cannot: that requests are not blocked, that the chart has a
 * size, that bars are drawn, that switching an asset switches the chart, and
 * that the price moves.
 *
 * ## When the browser is missing
 *
 * `playwright install chromium` downloads the browser but not the system
 * libraries it links against, and installing those needs root. On a machine
 * without them this **fails** when `OTC_REQUIRE_BROWSER=1` — which CI sets —
 * and otherwise **skips**, as a skip: every test is marked skipped in the
 * summary, and one line names the packages that fix it. Until the out-of-band
 * audit (a6-03) the six tests were reported as *passed* while doing nothing,
 * on a host where no Chromium build could launch. A test that passes without
 * running is not evidence, and a gate that silently drops its only browser
 * coverage is how CA6-10 happened in the first place.
 *
 * ## Two children, two process groups
 *
 * The panel was started as `npx next start`, and `npx` runs `next` through a
 * shell; killing `npx` in `afterAll` left `next-server` running — and holding
 * its port — for the rest of every CI job (a1-05, the runner's own orphan
 * cleanup lines). Both children are now spawned directly, each as the leader
 * of its own process group, and the group is what is killed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const SECRET = 'e'.repeat(64);
/** The operator's write credential, shared by the engine and the panel. Public: a test. */
const TOKEN = 'panel-test-token-'.padEnd(32, 'p');
const BACKFILL_DAYS = 2;
/** The one command that makes the browser launch on a Debian-family host. */
/**
 * What Chromium links against, and the two ways to supply it.
 *
 * The second exists because a host without root is not a host without a
 * browser, and this suite spent PH-20 and most of PH-21 being skipped on one.
 * `apt-get download` needs no privileges, and neither does unpacking a `.deb`
 * into a directory the loader is pointed at:
 *
 * ```
 * apt-get download libnss3 libnspr4 libasound2t64
 * for d in *.deb; do dpkg-deb -x "$d" prefix; done
 * export LD_LIBRARY_PATH="$PWD/prefix/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
 * ```
 *
 * That prefix is a local artefact, not a repository one: it is nobody's build
 * output and it does not survive being cleaned up. It is written here rather
 * than in a phase document so that whoever next reads `SKIPPED` gets the
 * option, on the host where they are reading it.
 */
const BROWSER_LIBRARIES =
  'sudo apt-get install -y libnss3 libnspr4 libasound2t64 — or, without root, ' +
  'apt-get download those three, `dpkg-deb -x` each into a prefix, and point ' +
  'LD_LIBRARY_PATH at <prefix>/usr/lib/x86_64-linux-gnu';

const started: ChildProcess[] = [];
const directories: string[] = [];
let browser: Browser | null = null;
let apiPort = 0;
let webPort = 0;
let unavailable: string | null = null;

afterAll(async () => {
  if (browser !== null) await browser.close();
  for (const child of started) killGroup(child);
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

/**
 * Kill a child and everything it started (a1-05).
 *
 * Each child is spawned `detached`, which makes it the leader of its own
 * process group; a negative pid addresses the group. The fallback is for a
 * child that already died and took its group with it.
 */
function killGroup(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * Wait until *this* child answers at `pathname`.
 *
 * `ready` decides from the response body: the engine echoes the boot nonce it
 * was given (a6-14), so a foreign engine on the port is never mistaken for the
 * child while the child is still provisioning.
 */
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

async function bootEngine(port: number): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'otc-panel-'));
  directories.push(stateDir);
  const nonce = randomUUID();
  const child = spawn(process.execPath, [path.join(repoRoot, 'apps/api/dist/main.js')], {
    env: {
      ...process.env,
      OTC_STATE_DIR: stateDir,
      OTC_HISTORY_DB: path.join(stateDir, 'history.db'),
      OTC_MASTER_SECRET: SECRET,
      OTC_ADMIN_TOKEN: TOKEN,
      OTC_BACKFILL_DAYS: String(BACKFILL_DAYS),
      OTC_BOOT_NONCE: nonce,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  started.push(child);
  await waitUntilReady(
    port,
    '/health',
    child,
    async (response) =>
      ((await response.json()) as { bootNonce: string | null }).bootNonce === nonce,
  );
}

async function bootPanel(port: number, enginePort: number): Promise<void> {
  // `next` itself, not `npx next`: a shell in between is a process the group
  // kill would otherwise have to know about.
  const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [next, 'start', '-p', String(port)], {
    cwd: path.join(repoRoot, 'apps/web'),
    env: {
      ...process.env,
      OTC_API_BASE: `http://127.0.0.1:${enginePort}`,
      // The panel adds the token to every write on its server (a6-01); the
      // browser under test never holds it.
      OTC_ADMIN_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  started.push(child);
  await waitUntilReady(port, '/preview', child, () => Promise.resolve(true));
}

/** A free port, found by asking the operating system for one. */
async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * A stream that is live, in either of the two honest ways.
 *
 * Plain `live` means the stream resumed exactly where the record stops. The
 * other spelling means the engine could not replay that far — the feed keeps a
 * bounded window and a restart empties it — and said so, so the forming candle
 * is drawn from the record and re-read as it fills. Both are live; neither is
 * `loading`, `reconnecting`, or an error, which is what this assertion is for.
 *
 * Pinning the exact string pinned the wrong thing: a CI engine is always
 * freshly started, so its feed can never reach back to the stored candle it is
 * asked to resume from, and the suite failed on correct behaviour (run
 * 33689094040). The behaviour behind each spelling has its own test below.
 */
const LIVE = /^live\b/;

interface Observed {
  readonly consoleErrors: string[];
  readonly failedRequests: string[];
  readonly requested: string[];
}

function watch(page: Page): Observed {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const requested: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  // Every URL the page asks for, in order. This is the only observable that
  // identifies *which market* the panel is showing — see the asset-switch test.
  page.on('request', (request) => {
    requested.push(request.url());
  });
  page.on('requestfailed', (request) => {
    // An aborted request is how a server-sent-event stream *ends*: the browser
    // reports `net::ERR_ABORTED` whenever the page closes one, which happens on
    // every asset switch and on every navigation. Counting that as a failure
    // would make this assertion fire on correct behaviour, which is worse than
    // not making it at all.
    const reason = request.failure()?.errorText ?? '';
    // By **path**, not by the whole URL. The stream carries a query now
    // (`?from=…&onGap=live`), and matching the URL's tail made every normally
    // ended stream look like a failure the moment that query appeared.
    if (reason.includes('ERR_ABORTED') && new URL(request.url()).pathname.endsWith('/stream')) {
      return;
    }
    failedRequests.push(`${request.method()} ${request.url()} — ${reason}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  return { consoleErrors, failedRequests, requested };
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
    // Once, and in the run's output: the summary will say `skipped`, and this
    // line says why and what fixes it (a6-03).
    console.warn(
      `panel.stat.test.ts: SKIPPED — ${unavailable}. Enable with: ${BROWSER_LIBRARIES} ` +
        `(or set OTC_REQUIRE_BROWSER=1 to make this a failure, as CI does).`,
    );
    return;
  }
  // **Build the panel from source, every run.** `next start` serves whatever
  // `.next` happens to hold, so a stale directory would let this suite pass a
  // panel that no longer exists in the tree — the exact shape of the failure it
  // was written to end. It costs about forty seconds once per file, and it is
  // what makes the planted-defect campaign in PH-20.1 meaningful at all.
  await build();
  apiPort = await freePort();
  await bootEngine(apiPort);
  webPort = await freePort();
  await bootPanel(webPort, apiPort);
}, 900_000);

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

describe('the panel, in a browser', () => {
  /**
   * A real skip, not a pass (a6-03). `ctx.skip()` marks the test skipped in
   * the summary; the previous guard returned early and six tests that had run
   * nothing were counted as passed.
   */
  const requireBrowser = (ctx: TestContext): Browser => {
    if (browser === null) ctx.skip(`no browser — ${unavailable ?? 'not launched'}`);
    return browser;
  };

  it('loads, reaches the engine, and draws bars in a chart with a size', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    const observed = watch(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });

      // Defect 1 and 2: if the browser could not reach the engine, this is the
      // message the Human Owner saw.
      expect(await page.getByText('Cannot reach the engine').count()).toBe(0);

      // Defect 3: the chart's canvas must have a size. `getBoundingClientRect`
      // in jsdom returns zeros for everything, which is why this needs a real
      // layout engine and not a DOM emulator.
      const canvas = page.locator('canvas').first();
      await canvas.waitFor({ state: 'attached', timeout: 30_000 });
      const box = await canvas.boundingBox();
      expect(box, 'the chart canvas has no box at all').not.toBeNull();
      expect(box!.height, 'the chart canvas has no height').toBeGreaterThan(200);
      expect(box!.width, 'the chart canvas has no width').toBeGreaterThan(400);

      // And it drew something: the footer counts the bars it was given.
      const bars = await page.getByTestId('bar-count').textContent();
      const drawn = Number((bars ?? '0').replace(/[^\d]/g, ''));
      expect(drawn, `footer said ${String(bars)}`).toBeGreaterThan(10);

      expect(observed.consoleErrors, 'console errors').toEqual([]);
      expect(observed.failedRequests, 'failed requests').toEqual([]);
    } finally {
      await page.close();
    }
  }, 300_000);

  it('draws the bucket now forming, however the stream had to reach it', async (ctx) => {
    // The defect this exists for, in the Human Owner's words: "la línea de
    // precio se mueve pero la vela está totalmente quieta". Twice on
    // 2026-09-02, and nothing in this suite could see it — a candle is painted
    // on a canvas, so no DOM assertion reads its close.
    //
    // What separates the defect from correct behaviour is not a price: it is
    // *which bucket has a live bar*. Frozen means the newest bar is the last
    // one history flushed, an hour old on the panel's default chart, while the
    // price line runs away from it. So the panel publishes the bucket it is
    // drawing live, and this asserts that bucket is the one now in progress.
    //
    // Which of the two routes it took getting there is deliberately not
    // asserted. A CI engine is always freshly started, so its feed can never
    // replay from the stored candle the client resumes at, and the panel draws
    // the bucket from the record instead — the case that used to cost an hour
    // of frozen candle. A long-running engine takes the exact-join route. Both
    // must end with the forming bucket drawn.
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    const observed = watch(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await expect
        .poll(async () => page.getByTestId('stream-status').textContent(), { timeout: 60_000 })
        .toMatch(LIVE);
      await expect
        .poll(async () => page.getByTestId('forming-bucket').textContent(), { timeout: 90_000 })
        .toMatch(/^live bar \d+$/);

      const label = (await page.getByTestId('forming-bucket').textContent()) ?? '';
      const drawnAt = Number(/^live bar (\d+)$/.exec(label)![1]);
      const HOUR_SECONDS = 3_600;
      // The panel opens on a one-hour chart, so a live bar sits on an hour
      // boundary, and the bucket in progress began less than an hour ago.
      expect(drawnAt % HOUR_SECONDS, `${label} is not an hour boundary`).toBe(0);
      const age = Math.floor(Date.now() / 1000) - drawnAt;
      expect(age, `${label} is ${String(age)}s old — a bucket that is over`).toBeLessThan(
        HOUR_SECONDS,
      );
      expect(age, `${label} is in the future`).toBeGreaterThanOrEqual(0);

      expect(observed.consoleErrors, 'console errors').toEqual([]);
      expect(observed.failedRequests, 'failed requests').toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('shows a price that moves', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await expect
        .poll(async () => page.getByTestId('stream-status').textContent(), { timeout: 60_000 })
        .toMatch(LIVE);

      // The candles of a bucket already in progress belong to the record, so at
      // an hourly timeframe nothing new is drawn for up to an hour. What moves
      // is the last published price — and a chart that never moves is what the
      // Human Owner reported second.
      const priceOf = async (): Promise<string> =>
        (await page.getByTestId('last-price').textContent()) ?? '';
      await page.getByTestId('last-price').waitFor({ state: 'visible', timeout: 60_000 });
      const first = await priceOf();
      await expect.poll(priceOf, { timeout: 120_000, interval: 500 }).not.toBe(first);
    } finally {
      await page.close();
    }
  }, 300_000);

  it('switches the whole screen when the asset changes', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    const observed = watch(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 30_000 });

      // One asset per screen: exactly one chart, before and after.
      expect(await page.locator('canvas').count()).toBeGreaterThan(0);
      expect(await page.getByTestId('asset-eurusd').count()).toBe(1);

      // **What the panel asks the engine for is the only thing that identifies
      // the market on screen.** This assertion took three attempts, and the two
      // that failed are worth keeping in view:
      //
      // 1. comparing the *quantum* readout across a switch — passed against a
      //    chart planted to be reused across assets, because the quantum is a
      //    React prop and re-renders whether or not the chart followed;
      // 2. comparing the *displayed price* against the asset's reference —
      //    passed against a stream planted to stay subscribed to `eurusd`,
      //    because `displayPrice` converts an integer count through *the
      //    selected asset's* quantum and reference. Ticks from the wrong market
      //    still land near the right price. The number on screen genuinely
      //    cannot tell you whose market it is.
      //
      // The requests can. Each asset must be asked for by name, at both tiers —
      // the stored candles and the live stream — and nothing may be asked of
      // another market afterwards.
      for (const id of ['spx', 'xauusd', 'eurusd'] as const) {
        const before = observed.requested.length;
        await page.getByTestId(`asset-${id}`).click();
        await expect
          .poll(async () => page.getByTestId('stream-status').textContent(), { timeout: 60_000 })
          .toMatch(LIVE);

        const after = observed.requested.slice(before);
        expect(
          after.filter((url) => url.includes(`/markets/${id}/history`)),
          `history fetched for ${id}`,
        ).not.toEqual([]);
        expect(
          after.filter((url) => url.includes(`/markets/${id}/stream`)),
          `stream opened for ${id}`,
        ).not.toEqual([]);
        expect(
          after.filter((url) => /\/markets\/[a-z]+\//.test(url) && !url.includes(`/${id}/`)),
          `no request for another market after selecting ${id}`,
        ).toEqual([]);

        // And the price on screen is at least in the asset's decade. Weak on its
        // own, as note 2 says; it costs nothing beside the request check and it
        // would catch a reference price wired to the wrong asset.
        const reference = { spx: 5_400, xauusd: 2_380, eurusd: 1.085 }[id];
        const price = Number(await page.getByTestId('last-price').textContent());
        expect(price).toBeGreaterThan(reference * 0.5);
        expect(price).toBeLessThan(reference * 1.5);
      }

      // And it survived the switches with a size.
      const box = await page.locator('canvas').first().boundingBox();
      expect(box!.height).toBeGreaterThan(200);
      const bars = await page.getByTestId('bar-count').textContent();
      expect(Number((bars ?? '0').replace(/[^\d]/g, ''))).toBeGreaterThan(10);

      expect(observed.consoleErrors, 'console errors').toEqual([]);
      expect(observed.failedRequests, 'failed requests').toEqual([]);
    } finally {
      await page.close();
    }
  }, 300_000);

  it('changes timeframe without refetching a different market', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 30_000 });

      const barsNow = async (): Promise<number> => {
        const text = await page.getByTestId('bar-count').textContent();
        return Number((text ?? '0').replace(/[^\d]/g, ''));
      };
      await page.getByRole('button', { name: '5m', exact: true }).click();
      await expect.poll(barsNow, { timeout: 60_000 }).toBeGreaterThan(50);
      const fine = await barsNow();

      await page.getByRole('button', { name: '1d', exact: true }).click();
      await expect.poll(barsNow, { timeout: 60_000 }).toBeLessThan(fine);

      // INV-004 as a viewer meets it: the coarser view holds fewer bars of the
      // same record, and the chart still has a size.
      const box = await page.locator('canvas').first().boundingBox();
      expect(box!.height).toBeGreaterThan(200);
    } finally {
      await page.close();
    }
  }, 300_000);

  it('creates an asset from the panel and then shows it', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    const observed = watch(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/assets/new`, { waitUntil: 'networkidle' });

      await page.getByTestId('field-id').fill('panelmetal');
      await page.getByTestId('field-displayName').fill('Panel Metal');
      // `metal` is the cheapest family to register — the fit span its cascade
      // memory asks for is the shortest in the catalogue — and this test pays
      // for a real one, six stages and all.
      await page.getByTestId('field-archetype').selectOption('metal');
      await page.getByTestId('field-referencePrice').fill('1900');
      await page.getByTestId('create-submit').click();

      await expect
        .poll(async () => page.getByTestId('job-state').textContent(), { timeout: 240_000 })
        .toMatch(/registered/);

      // The asset exists where an operator would look for it, and the screen it
      // arrives on is the one PH-20.1 already proved draws a market.
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await page.getByTestId('asset-panelmetal').click();
      await expect
        .poll(async () => page.getByTestId('stream-status').textContent(), { timeout: 60_000 })
        .toMatch(LIVE);
      const price = Number(await page.getByTestId('last-price').textContent());
      expect(price).toBeGreaterThan(950);
      expect(price).toBeLessThan(2_850);

      expect(observed.consoleErrors, 'console errors').toEqual([]);
      expect(observed.failedRequests, 'failed requests').toEqual([]);
    } finally {
      await page.close();
    }
  }, 600_000);

  it('renames and retires from the panel, and refuses the rest', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    const observed = watch(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/assets/manage`, { waitUntil: 'networkidle' });

      // Renaming a compiled catalogue asset, which is the case an overlay
      // exists for: `gbpjpy` was never registered here and is administered
      // exactly like one that was.
      await page.getByTestId('rename-gbpjpy').click();
      await page.getByTestId('rename-input-gbpjpy').fill('Sterling / Yen');
      await page.getByTestId('rename-save-gbpjpy').click();
      // A failed write puts the engine's own words on the screen. Checking for
      // it first turns a timeout into a message.
      expect(await page.getByTestId('manage-error').count(), 'the rename was refused').toBe(0);
      await expect
        .poll(async () => page.getByTestId('name-gbpjpy').textContent(), { timeout: 30_000 })
        .toBe('Sterling / Yen');

      // Retiring asks first, and the confirmation says it cannot be undone.
      await page.getByTestId('retire-xauusd').click();
      await page.getByTestId('retire-confirm-xauusd').waitFor({ state: 'visible' });
      await page.getByTestId('retire-confirm-xauusd').click();
      await expect
        .poll(async () => page.getByTestId('state-xauusd').textContent(), { timeout: 30_000 })
        .toBe('retired');

      // And it is gone from the screen that hosts markets, while the one that
      // was renamed is still there under its new name.
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await page.getByTestId('asset-gbpjpy').click();
      await expect
        .poll(async () => page.getByTestId('stream-status').textContent(), { timeout: 60_000 })
        .toMatch(LIVE);
      await page.getByTestId('asset-xauusd').click();
      await expect
        .poll(async () => page.getByTestId('stream-status').textContent(), { timeout: 30_000 })
        .toContain('not hosted');

      expect(observed.consoleErrors, 'console errors').toEqual([]);
      expect(observed.failedRequests, 'failed requests').toEqual([]);
    } finally {
      await page.close();
    }
  }, 300_000);

  it('finds one asset among many, by id, by name and by family', async (ctx) => {
    const page = await requireBrowser(ctx).newPage({ viewport: { width: 1440, height: 900 } });
    const observed = watch(page);
    try {
      await page.goto(`http://127.0.0.1:${webPort}/preview`, { waitUntil: 'networkidle' });
      await page.getByTestId('asset-eurusd').waitFor({ state: 'visible', timeout: 30_000 });

      // Grouped by family, and the headings are the families the catalogue has.
      await page
        .getByText('forex ·', { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });

      // A filter that narrows the list. `filterCatalogue` is unit-tested
      // exhaustively; what only a browser can show is that the box is wired to
      // it and that the list actually shrinks.
      await page.getByTestId('asset-filter').fill('btc');
      await expect
        .poll(async () => page.getByTestId('asset-eurusd').count(), { timeout: 10_000 })
        .toBe(0);
      expect(await page.getByTestId('asset-btcusd').count()).toBe(1);

      // By family, not just by id.
      await page.getByTestId('asset-filter').fill('forex');
      await expect
        .poll(async () => page.getByTestId('asset-btcusd').count(), { timeout: 10_000 })
        .toBe(0);
      expect(await page.getByTestId('asset-eurusd').count()).toBe(1);
      expect(await page.getByTestId('asset-gbpjpy').count()).toBe(1);

      // Nothing matching says so rather than showing an empty sidebar.
      await page.getByTestId('asset-filter').fill('zzzz');
      await page.getByTestId('no-matches').waitFor({ state: 'visible', timeout: 10_000 });

      // And clearing it brings the catalogue back — a filter that hid the
      // catalogue until something was typed would have broken the screen.
      await page.getByTestId('asset-filter').fill('');
      await expect
        .poll(async () => page.getByTestId('asset-eurusd').count(), { timeout: 10_000 })
        .toBe(1);

      // The chart never stopped: filtering narrows the list, not the selection.
      const box = await page.locator('canvas').first().boundingBox();
      expect(box!.height).toBeGreaterThan(200);

      expect(observed.consoleErrors, 'console errors').toEqual([]);
      expect(observed.failedRequests, 'failed requests').toEqual([]);
    } finally {
      await page.close();
    }
  }, 300_000);
});
