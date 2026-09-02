/**
 * A main-thread probe for the statistical suite.
 *
 * The worker-side watchdog in `vitest.setup.statistical.ts` measures how long a
 * *worker* stays away from its own event loop. Hosted CI run 33607930939 —
 * the first with that watchdog — reported no file blocking longer than 20.4 s
 * and still failed with `Timeout calling "onTaskUpdate"`, which is the worker
 * giving up on a reply from the **main** thread after 60 s. So the other half
 * of the channel has to be measured too, and this is the only place that can:
 * a reporter runs in the main process.
 *
 * Two things are recorded, to stderr, with a timestamp so the lines sort
 * against the runner's own output:
 *
 * - main-thread event-loop lag: a 250 ms timer, and any tick that arrives more
 *   than two seconds late is a block of that length in the process that has to
 *   answer every worker RPC;
 * - the wall-clock moment each test module ends, which is when the worker sends
 *   the update whose reply it is waiting for.
 *
 * It fails nothing. Its job is attribution, not judgement.
 */
import type { Reporter, TestModule } from 'vitest/node';

const INTERVAL_MS = 250;
const REPORT_ABOVE_MS = 2_000;

function stamp(): string {
  return new Date().toISOString();
}

function log(line: string): void {
  process.stderr.write(`[main-probe] ${stamp()} ${line}\n`);
}

export default class MainThreadProbe implements Reporter {
  private timer: NodeJS.Timeout | null = null;
  private expected = 0;

  onInit(): void {
    this.expected = Date.now() + INTERVAL_MS;
    this.timer = setInterval(() => {
      const now = Date.now();
      const lag = now - this.expected;
      if (lag >= REPORT_ABOVE_MS) log(`main thread blocked for ${(lag / 1000).toFixed(1)}s`);
      this.expected = now + INTERVAL_MS;
    }, INTERVAL_MS);
    this.timer.unref();
    log(`probe armed (pid ${process.pid})`);
  }

  onTestModuleEnd(module: TestModule): void {
    // The unit suite has 86 files and no history of this failure; only the
    // statistical files are worth a line each.
    if (module.moduleId.endsWith('.stat.test.ts')) log(`module end ${module.moduleId}`);
  }

  onTestRunEnd(): void {
    if (this.timer !== null) clearInterval(this.timer);
    log('run end');
  }
}
