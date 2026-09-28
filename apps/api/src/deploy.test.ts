import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The deployment files ship with the engine (PH-30.1) and are held to what
 * the engine actually needs: the environment names the module reads, the
 * readiness route, the stop signal a checkpoint needs, the state directory.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file: string): string => readFileSync(path.join(root, 'deploy', file), 'utf8');

describe('the deployment files match the engine (PH-30.1)', () => {
  it('ship, and are named by the guide', () => {
    for (const file of [
      'otc-engine.service',
      'Dockerfile',
      'docker-compose.yml',
      'nginx.conf',
      'backup.sh',
    ]) {
      expect(existsSync(path.join(root, 'deploy', file)), file).toBe(true);
    }
    expect(statSync(path.join(root, 'deploy', 'backup.sh')).mode & 0o111).not.toBe(0);
    const guide = readFileSync(path.join(root, 'docs/integration/INTEGRATION.md'), 'utf8');
    for (const file of ['otc-engine.service', 'docker-compose.yml', 'nginx.conf', 'backup.sh']) {
      expect(guide, `the guide does not name deploy/${file}`).toContain(`deploy/${file}`);
    }
  });

  it('the systemd unit stops with SIGTERM, restarts, and names the state directory and the secrets file', () => {
    const unit = read('otc-engine.service');
    const value = (key: string): string | undefined =>
      new RegExp(`^${key}=(.*)$`, 'm').exec(unit)?.[1];
    expect(value('KillSignal')).toBe('SIGTERM');
    expect(value('Restart')).toBe('always');
    expect(unit).toMatch(/^Environment=OTC_STATE_DIR=\S+$/m);
    expect(value('EnvironmentFile')).toMatch(/secrets\.env$/);
    expect(value('ExecStart')).toMatch(/apps\/api\/dist\/main\.js$/);
    expect(unit).toMatch(/^Environment=OTC_BIND=127\.0\.0\.1$/m);
  });

  it('the image and the compose file check readiness, not liveness, and stop with SIGTERM', () => {
    const image = read('Dockerfile');
    expect(image).toMatch(/HEALTHCHECK[\s\S]*\/health\/ready/);
    expect(image).toMatch(/^STOPSIGNAL SIGTERM$/m);
    expect(image).toMatch(/^VOLUME \["\/var\/lib\/otc"\]$/m);
    const compose = read('docker-compose.yml');
    expect(compose).toContain('/health/ready');
    expect(compose).toContain('stop_signal: SIGTERM');
    expect(compose).toMatch(/OTC_MASTER_SECRET: \$\{OTC_MASTER_SECRET:\?/);
    expect(compose).toContain('deploy/backup.sh');
    // Publication is opt-in, so its directory and its key arrive together: setting
    // the directory makes the key mandatory, and this file set the directory
    // unconditionally while its own header documented an invocation with no key —
    // the engine refused to boot and `restart: unless-stopped` looped it for ever
    // (the readiness audit of 2026-09-28).
    expect(compose).toMatch(/OTC_PUBLICATION_DIR: \$\{OTC_PUBLICATION_DIR:-\}/);
    expect(compose).toMatch(/['"]127\.0\.0\.1:3000:3000['"]/);
  });

  it('the proxy leaves the stream unbuffered, cuts the write surface and forwards the client address', () => {
    const proxy = read('nginx.conf');
    expect(proxy).toContain('proxy_buffering off');
    // **Case-insensitive, and the monitor surface with an optional trailing
    // slash** (the readiness audit of 2026-09-28). nginx's `~` is case-sensitive
    // and the engine's router is not, so `/Assets/eurusd-otc` fell through this
    // block to the write surface and `/Metrics` and `/metrics/` reached the
    // monitor surface — while this guard asserted the very regex that let them.
    expect(proxy).toMatch(/location ~\* \^\/assets \{\s*return 403;/);
    expect(proxy).toMatch(/location ~\* \^\/\(metrics\|health\/ready\)\/\?\$ \{/);
    expect(proxy, 'a case-sensitive location still guards a case-insensitive router').not.toMatch(
      /location ~ \^\//,
    );
    expect(proxy).toContain('X-Forwarded-For');
    expect(proxy).toContain("proxy_set_header Connection ''");
  });

  /**
   * Cycle Audit 10 (a1-02, a5-01, a8-01). The proxy forwarded the client and
   * the engine was never told to read it, so the guard above asserted the half
   * nobody consumed: behind this deployment every client shared one bucket.
   */
  it('every composition that puts a proxy in front tells the engine how many hops to trust', () => {
    for (const file of ['docker-compose.yml', 'otc-engine.service']) {
      const text = read(file);
      expect(text, file).toMatch(/OTC_TRUSTED_PROXIES/);
      // The value is a hop count, and one proxy is one hop.
      expect(text, file).toMatch(/OTC_TRUSTED_PROXIES[:=]\s*(\$\{OTC_TRUSTED_PROXIES:-)?1/);
    }
  });

  /**
   * **Cycle Audit 10 (a5-04).** The guard above read `deploy/backup.sh` out of
   * the compose file as a string, and the string was fine: the service was
   * `image: node:24-slim` with the host's checkout bind-mounted read-only, so
   * it ran `node tools/sim/dist/stateTool.js` out of a `dist/` that `.gitignore`
   * excludes. On a fresh clone the first run dies with `Cannot find module`,
   * the loop swallows it and sleeps six hours, and the operator has a backup
   * service that is up, healthy and has never written a backup.
   *
   * So this reads the half that matters: what image each service runs, whether
   * it reaches outside its image for the files it executes, and whether those
   * files are in the image at all. It is deliberately not a docker run — docker
   * is not installed in every environment this suite runs in — but every
   * property it checks is one a docker run would have failed on.
   */
  describe('every service the compose file runs is the image the compose builds (a5-04)', () => {
    const compose = read('docker-compose.yml');
    /** `{name: body}` for each entry under `services:`, by indentation. */
    const services = ((): Record<string, string> => {
      const lines = compose.split('\n');
      const start = lines.findIndex((line) => line === 'services:');
      expect(start, 'the compose file has no services: block').toBeGreaterThanOrEqual(0);
      const out: Record<string, string> = {};
      let current: string | null = null;
      for (const line of lines.slice(start + 1)) {
        if (line.trim() === '' || line.startsWith('#')) continue;
        if (!line.startsWith(' ')) break; // a new top-level key ends the block
        const header = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
        if (header) {
          current = header[1]!;
          out[current] = '';
        } else if (current !== null) {
          out[current] += `${line}\n`;
        }
      }
      return out;
    })();

    /** The repository directories `deploy/Dockerfile`'s build stage copies in. */
    const copied = ((): string[] => {
      const image = read('Dockerfile');
      const roots: string[] = [];
      for (const line of image.split('\n')) {
        const copy = /^COPY (?!--from)(.+?) \.?\/?[\w./]*$/.exec(line.trim());
        if (copy === null) continue;
        for (const source of copy[1]!.split(/\s+/)) roots.push(source.split('/')[0]!);
      }
      return roots;
    })();

    it('defines at least the engine and its backup timer', () => {
      expect(Object.keys(services).sort()).toEqual(['backup', 'engine']);
    });

    it('runs no service on a stock base image, and mounts the checkout into none', () => {
      for (const [name, body] of Object.entries(services)) {
        expect(body, `${name} is not built from deploy/Dockerfile`).toMatch(
          /dockerfile: deploy\/Dockerfile/,
        );
        expect(body, `${name} runs a stock base image, not the one the compose builds`).not.toMatch(
          /^\s*image: (?!otc-)/m,
        );
        // `..:/opt/otc:ro` is the host's checkout: unbuilt on a fresh clone, and
        // built for the host's platform when it is built at all.
        expect(body, `${name} bind-mounts the repository from the host`).not.toMatch(
          /^\s*- \.\.[:/]/m,
        );
      }
    });

    it('runs only files the image contains, all the way down to what those files run', () => {
      const inImage = (file: string): void => {
        expect(
          copied,
          `deploy/Dockerfile does not COPY ${file.split('/')[0]!}/, so a ` +
            `service running ${file} runs a file the image does not contain`,
        ).toContain(file.split('/')[0]!);
        // A `dist/` path is built inside the image and is not in the tree —
        // `.gitignore` excludes it, which is the whole of a5-04 — so what has
        // to exist here is the source the image's `npm run build` makes it
        // from. Asserting the artefact would make this test depend on a build.
        const source = file.includes('/dist/')
          ? file.replace('/dist/', '/src/').replace(/\.js$/, '.ts')
          : file;
        expect(existsSync(path.join(root, source)), `${source} is not in the repository`).toBe(
          true,
        );
      };
      // Every repository-relative path a service's command names…
      const commands = [...compose.matchAll(/^\s*command: \[(.+)\]$/gm)].flatMap((m) =>
        [...m[1]!.matchAll(/'([\w./-]+\.(?:sh|js|mjs))'/g)].map((f) => f[1]!),
      );
      expect(commands.length, 'no service command names a file in this repository').toBeGreaterThan(
        0,
      );
      for (const file of commands) inImage(file);
      // …and every repository-relative path those files run in turn.
      for (const file of commands.filter((f) => f.endsWith('.sh'))) {
        const script = readFileSync(path.join(root, file), 'utf8');
        for (const m of script.matchAll(/\bnode ([\w./-]+\.(?:js|mjs))/g)) inImage(m[1]!);
      }
    });

    it('has a title that names the services it defines, and no service it does not', () => {
      // PH-30.1 §2 and this file's first line both said "engine and panel";
      // there has never been a panel service and the image copies no apps/web.
      const title = compose.split('\n')[0]!;
      for (const noun of ['engine', 'panel', 'backup', 'lab', 'web']) {
        if (!new RegExp(`\\b${noun}\\b`).test(title)) continue;
        expect(
          Object.keys(services),
          `the title names ${noun} and the file defines no such service`,
        ).toContain(noun);
      }
      for (const name of Object.keys(services)) {
        expect(title, `the title does not name the ${name} service`).toMatch(
          new RegExp(`\\b${name}\\b`),
        );
      }
    });
  });

  it('the backup script runs the state tool and keeps the newest N', () => {
    const script = read('backup.sh');
    expect(script).toContain('stateTool.js backup');
    expect(script).toMatch(/head -n -"\$keep"/);
    expect(script).toMatch(/^set -euo pipefail$/m);
  });

  /**
   * **Cycle Audit 10 (a5-04), the behavioural half.** The service is supposed to
   * produce backups, so this runs the script and counts them. The failure this
   * catches is the one the compose service had: the run dies, the loop's
   * `|| echo "backup failed"` swallows it, the container sleeps six hours and
   * reports healthy, and the backups directory stays empty for ever. The first
   * run is fatal now, and this asserts it by giving the script a source that
   * does not exist *with* an interval — the shape that used to sleep.
   *
   * **It needs `tools/sim/dist`, and says so rather than skipping.** The script
   * runs the built tool, the gate builds before it tests (ADR-0009), and
   * `packages/runtime/src/sqliteConcurrency.test.ts` already states this
   * precondition in the same words — a guard that quietly does not run is the
   * defect this project has found more often than any other.
   */
  describe('deploy/backup.sh, run', () => {
    const tool = path.join(root, 'tools/sim/dist/stateTool.js');
    const scratch = (): string => mkdtempSync(path.join(tmpdir(), 'otc-deploy-'));
    const run = (args: string[]): { status: number | null; stderr: string } => {
      if (!existsSync(tool)) {
        throw new Error(
          `deploy/backup.sh runs tools/sim/dist/stateTool.js, which does not exist. Run ` +
            `\`npm run build\` first — the same ordering \`npm run lint\` already requires.`,
        );
      }
      const result = spawnSync('bash', [path.join(root, 'deploy/backup.sh'), ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15_000,
      });
      return { status: result.status, stderr: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    };

    it('writes a verified copy per run and keeps only the newest N', () => {
      const state = scratch();
      const out = path.join(scratch(), 'backups');
      writeFileSync(
        path.join(state, 'eurusd-otc.json'),
        JSON.stringify({ version: 1, assetId: 'eurusd-otc' }),
      );
      for (const stamp of ['otc-20260101T000000Z', 'otc-20260102T000000Z']) {
        mkdirSync(path.join(out, stamp), { recursive: true });
      }
      const first = run([state, out, '2']);
      expect(first.status, first.stderr).toBe(0);
      const kept = readdirSync(out).filter((name) => name.startsWith('otc-'));
      expect(kept, 'the run wrote no backup').toHaveLength(2);
      expect(kept, 'the oldest was not pruned').not.toContain('otc-20260101T000000Z');
      const written = kept.find((name) => name !== 'otc-20260102T000000Z')!;
      expect(readdirSync(path.join(out, written))).toContain('eurusd-otc.json');
      expect(readdirSync(path.join(out, written))).toContain('backup.json');
    });

    /**
     * **Cycle Audit 10 (a2-09).** Retention is `head -n -"$keep"`, and
     * `head -n -0` prints *every* line: `deploy/backup.sh <state> <out> 0` took
     * a backup, verified it, printed `Consistent: every file agrees.` and then
     * deleted every backup in the directory including the one it had just
     * taken — exit 0, no message. A backup script whose job is to keep backups
     * may not be told to keep none, and the guard is watched here rather than
     * in the grep above, which reads the retention line and not what it does.
     */
    it('refuses keep<1 before it writes anything, rather than deleting every backup', () => {
      const state = scratch();
      const out = path.join(scratch(), 'backups');
      writeFileSync(
        path.join(state, 'eurusd-otc.json'),
        JSON.stringify({ version: 1, assetId: 'eurusd-otc' }),
      );
      mkdirSync(path.join(out, 'otc-20260101T000000Z'), { recursive: true });
      for (const keep of ['0', '-1', 'all']) {
        const refused = run([state, out, keep]);
        expect(refused.status, `keep=${keep} was accepted`).not.toBe(0);
        expect(refused.stderr, `keep=${keep}`).toMatch(/keep must be/);
        expect(readdirSync(out), `keep=${keep} deleted the backups it was asked to keep`).toEqual([
          'otc-20260101T000000Z',
        ]);
      }
      // And the retention it does accept keeps the newest, not the oldest.
      expect(run([state, out, '1']).status).toBe(0);
      const kept = readdirSync(out);
      expect(kept, 'the newest backup was not the survivor').toHaveLength(1);
      expect(kept[0]).not.toBe('otc-20260101T000000Z');
    });

    it('fails the first run rather than sleeping on a timer that can never work', () => {
      const out = path.join(scratch(), 'backups');
      mkdirSync(out, { recursive: true });
      // With an interval: the shape the compose service runs, which is the
      // shape that used to swallow the failure. It must exit, not sleep — the
      // spawn timeout is what "sleeps" looks like from here. One second rather
      // than compose's six hours, because `spawnSync`'s timeout kills bash and
      // not its `sleep` child: a regression here should leave a one-second
      // orphan on the machine, not a six-hour one.
      const failed = run([path.join(scratch(), 'never'), out, '8', '1']);
      expect(failed.status, 'the script did not fail; it is sleeping on a broken backup').toBe(1);
      expect(failed.stderr).toMatch(/No state directory/);
      expect(readdirSync(out)).toEqual([]);
    });
  });
});

/**
 * **Ten defects in these files, all of them found by reading them against the
 * code rather than by any test** (the readiness audit of 2026-09-28). Every one
 * would have hit an operator on a first deployment, and the guards above had
 * grepped the same files for other properties without ever asking these
 * questions. `nginx -t` cannot run here — nginx is not installed on a gate host —
 * so the proxy is held to the structural invariant instead.
 */
describe('the deployment files can actually be deployed', () => {
  const guide = (): string =>
    readFileSync(path.join(root, 'docs/integration/INTEGRATION.md'), 'utf8');

  it('nginx declares a certificate for every TLS listener, or listens without TLS', () => {
    const conf = read('nginx.conf');
    const directives = conf
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    const tlsListeners = [...directives.matchAll(/^\s*listen\s+([^;]*);/gm)].filter(([, rest]) =>
      /\bssl\b/.test(rest!),
    );
    if (tlsListeners.length > 0) {
      expect(
        directives,
        'nginx refuses the whole config at parse time when a `listen ... ssl` has no ' +
          'certificate — `no "ssl_certificate" is defined` — so the layer that cuts the ' +
          'write surface is the one piece of the deployment that never starts',
      ).toMatch(/^\s*ssl_certificate\s+\S+;/m);
      expect(directives).toMatch(/^\s*ssl_certificate_key\s+\S+;/m);
    }
    // And there is a listener at all: a server block with none listens on 80 by
    // default as root, which is not what this file means.
    expect(
      tlsListeners.length + [...directives.matchAll(/^\s*listen\s+/gm)].length,
    ).toBeGreaterThan(0);
  });

  it('nginx lets the monitor of every shipped topology reach /metrics', () => {
    const conf = read('nginx.conf');
    const block = /location[^{]*\(metrics\|health\/ready\)[^{]*\{([\s\S]*?)\}/.exec(conf)?.[1];
    expect(block, 'the monitor location is gone or unrecognisable').toBeDefined();
    // The engine binds loopback and compose publishes on 127.0.0.1, so a monitor
    // on the same host is the shipped topology. It allowed 10/8 alone, which
    // excludes that, Docker's default bridge and every 192.168 LAN.
    expect(block, 'the monitor cannot reach /metrics from the host the engine runs on').toMatch(
      /allow 127\.0\.0\.1;/,
    );
    expect(block).toMatch(/allow 172\.16\.0\.0\/12;/);
    expect(block, 'the monitor surface must still not be public').toMatch(/deny all;/);
  });

  it('the systemd unit runs as a user the recipe creates, on a directory systemd gives it', () => {
    const unit = read('otc-engine.service');
    const value = (key: string): string | undefined =>
      new RegExp(`^${key}=(.*)$`, 'm').exec(unit)?.[1];
    const user = value('User');
    expect(user, 'the unit runs as root').toBeDefined();
    expect(value('Group'), 'no Group=, so the files it writes are owned by a surprise').toBe(user);
    // Without this, `install -d /var/lib/otc` leaves a root-owned directory and the
    // engine's first act — a lock file *inside* it — is an EACCES printed as a raw
    // Node stack, at RestartSec=2.
    expect(
      value('StateDirectory'),
      'systemd must create and chown the state directory: the unit does not run as root',
    ).toBeDefined();
    expect(unit, `the install recipe never creates ${String(user)}`).toMatch(
      new RegExp(`useradd[^\\n]*\\b${String(user)}\\b`),
    );
    // The recipe's secrets line was a literal `...`, which writes three empty
    // values and dies on "OTC_MASTER_SECRET must be 64 hex characters".
    const recipe = unit.slice(0, unit.indexOf('[Unit]'));
    expect(recipe, 'the recipe writes secrets it does not generate').toMatch(/openssl rand -hex/);
    expect(recipe).not.toMatch(/%s\\n' \.\.\./);
  });

  it('the systemd unit refuses a Node too old for node:sqlite, in one line', () => {
    const unit = read('otc-engine.service');
    const pre = /^ExecStartPre=(.*)$/m.exec(unit)?.[1];
    expect(pre, 'nothing checks the Node version, so an old one crash-loops').toBeDefined();
    expect(pre).toMatch(/node/);
    // The real requirement, from the source of truth rather than a number typed
    // here: the record and the history import `node:sqlite`.
    expect(readFileSync(path.join(root, 'packages/runtime/src/stateDirectory.ts'), 'utf8')).toMatch(
      /from 'node:sqlite'/,
    );
    const engines = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };
    const major = /(\d+)/.exec(engines.engines?.node ?? '')?.[1];
    expect(major, 'package.json no longer states a Node version').toBeDefined();
    expect(
      pre,
      `the gate must name the major this workspace requires (${String(major)})`,
    ).toContain(String(major));
    // And the snippet must be shell systemd can run: no nested double quotes
    // inside the command substitution, which is how the first attempt broke.
    const script = /-c '(.*)'$/.exec(pre!)?.[1]?.replaceAll('$$', '$');
    expect(script, 'ExecStartPre is not a quoted sh -c command').toBeDefined();
    const checked = spawnSync('/bin/sh', ['-n', '-c', script!], { encoding: 'utf8' });
    expect(checked.status, `sh cannot parse the version gate: ${checked.stderr}`).toBe(0);
  });

  it('the health checks follow PORT instead of hard-coding one', () => {
    // A container that is `unhealthy` for ever on a changed port takes the backup
    // service with it, because compose gates it on `service_healthy`: up, healthy,
    // and never a single backup written.
    expect(readFileSync(path.join(root, 'apps/api/src/main.ts'), 'utf8')).toMatch(
      /process\.env\.PORT/,
    );
    for (const file of ['Dockerfile', 'docker-compose.yml']) {
      const text = read(file);
      const probe = /health\/ready[^\n]*/.exec(text)?.[0] ?? '';
      expect(probe, `${file} probes readiness`).not.toBe('');
      const line = text.split('\n').find((l) => l.includes('health/ready')) ?? '';
      expect(line, `${file} hard-codes the port its probe asks for`).toMatch(/process\.env\.PORT/);
    }
  });

  it('a build context cannot carry the host build into the image', () => {
    // `npm run build` is `tsc -b`: with a dist/ and a .tsbuildinfo from the host in
    // the context, every project reads as up to date, nothing is emitted, and the
    // image runs JavaScript compiled from another tree.
    const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8');
    for (const pattern of ['dist', '*.tsbuildinfo', 'node_modules']) {
      expect(ignore, `.dockerignore does not exclude ${pattern}`).toContain(pattern);
    }
    expect(read('Dockerfile')).toMatch(/npm run build/);
  });

  it('the systemd deployment has a backup, and it runs once per firing', () => {
    for (const file of ['otc-backup.service', 'otc-backup.timer']) {
      expect(existsSync(path.join(root, 'deploy', file)), `deploy/${file} is missing`).toBe(true);
    }
    const service = read('otc-backup.service');
    expect(/^Type=(.*)$/m.exec(service)?.[1]).toBe('oneshot');
    const exec = /^ExecStart=(.*)$/m.exec(service)?.[1] ?? '';
    expect(exec).toMatch(/backup\.sh/);
    // Four arguments would be the looping form, which belongs to compose: under a
    // timer it would sleep for ever inside a oneshot unit.
    expect(exec.trim().split(/\s+/).length, 'the timer form of backup.sh takes no interval').toBe(
      4,
    );
    const timer = read('otc-backup.timer');
    expect(timer).toMatch(/^OnUnitActiveSec=/m);
    expect(timer, 'a host that was asleep must still take its missed backup').toMatch(
      /^Persistent=true$/m,
    );
    expect(timer).toMatch(/^WantedBy=timers\.target$/m);
    expect(guide(), 'the guide does not name the timer').toContain('deploy/otc-backup.timer');
  });

  it('the guide ships no second systemd unit, because the second one was wrong', () => {
    // Its copy omitted User=, WorkingDirectory=, OTC_BIND and OTC_TRUSTED_PROXIES.
    // The last puts every client on the Internet in one 600/min bucket behind the
    // proxy described 120 lines earlier in the same section — the Cycle Audit 10
    // defect, re-shipped in the document an operator actually pastes from.
    const text = guide();
    const blocks = [...text.matchAll(/```ini\n([\s\S]*?)```/g)].map(([, body]) => body!);
    for (const block of blocks.filter((b) => b.includes('[Service]'))) {
      expect(
        block,
        'a systemd unit in the guide must set OTC_TRUSTED_PROXIES, or not be in the guide',
      ).toMatch(/OTC_TRUSTED_PROXIES=/);
      expect(block, 'a systemd unit in the guide must not run the engine as root').toMatch(/User=/);
    }
    expect(text, 'the guide must point at the unit that is guarded').toContain(
      'deploy/otc-engine.service',
    );
  });

  it('the guide states the boot order the code implements, not the reverse', () => {
    // It said the markets come up *before* the port listens. The code listens
    // first, deliberately (Cycle Audit 10, a5-02: the old order let a liveness
    // probe restart the venue for ever), which is the whole reason /health/ready
    // exists. An operator who believed the guide pointed a load balancer at the
    // port and routed traffic at markets that answer 404.
    const main = readFileSync(path.join(root, 'apps/api/src/main.ts'), 'utf8');
    const listensAt = main.indexOf('app.listen(');
    const resumesAt = main.indexOf('venue.start()');
    expect(listensAt).toBeGreaterThan(0);
    expect(resumesAt).toBeGreaterThan(0);
    expect(
      listensAt,
      'main.ts no longer listens before it resumes: fix the guide too',
    ).toBeLessThan(resumesAt);
    const text = guide();
    expect(text, 'the guide claims the markets come up before the port').not.toMatch(
      /mercados se levantan \*\*antes\*\* de que escuche el puerto/,
    );
    expect(text, 'the guide must send readiness checks to /health/ready').toMatch(/health\/ready/);
  });

  it('the quickstart writes somewhere a non-root user can write', () => {
    // `export OTC_STATE_DIR=/var/lib/otc` was the guide's *first* command block,
    // and /var/lib is root-owned everywhere: the engine dies taking its lock, with
    // a raw EACCES stack.
    const first = /```bash\n([\s\S]*?)```/.exec(guide())?.[1] ?? '';
    const assignment = /OTC_STATE_DIR=(\S+)/.exec(first)?.[1];
    expect(assignment, 'the quickstart no longer sets a state directory').toBeDefined();
    expect(
      assignment!.startsWith('/'),
      `the quickstart writes to ${String(assignment)}, which a non-root user cannot create`,
    ).toBe(false);
  });
});
