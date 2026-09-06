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
    expect(compose).toMatch(/['"]127\.0\.0\.1:3000:3000['"]/);
  });

  it('the proxy leaves the stream unbuffered, cuts the write surface and forwards the client address', () => {
    const proxy = read('nginx.conf');
    expect(proxy).toContain('proxy_buffering off');
    expect(proxy).toMatch(/location ~ \^\/assets \{\s*return 403;/);
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
