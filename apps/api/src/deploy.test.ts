import { existsSync, readFileSync, statSync } from 'node:fs';
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

  it('the backup script runs the state tool and keeps the newest N', () => {
    const script = read('backup.sh');
    expect(script).toContain('stateTool.js backup');
    expect(script).toMatch(/head -n -"\$keep"/);
    expect(script).toMatch(/^set -euo pipefail$/m);
  });
});
