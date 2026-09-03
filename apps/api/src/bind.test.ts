import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bindAddressFromEnvironment, DEFAULT_BIND_ADDRESS, isExposedBind } from './bind.js';

/** `apps/api/src` -> the repository root. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The bind surface, pinned.
 *
 * Cycle Audit 7 planted `0.0.0.0` as the default and ran everything: 557 tests
 * passed and nothing said a word (CA7-27). A constant that decides whether an
 * unauthenticated network can reach the write surface is not a constant to be
 * trusted to review.
 */
describe('the service listens on this machine only unless told otherwise', () => {
  it('defaults to loopback', () => {
    expect(DEFAULT_BIND_ADDRESS).toBe('127.0.0.1');
    expect(bindAddressFromEnvironment({})).toBe('127.0.0.1');
    expect(bindAddressFromEnvironment({ OTC_BIND: '' })).toBe('127.0.0.1');
    expect(bindAddressFromEnvironment({ OTC_BIND: '   ' })).toBe('127.0.0.1');
  });

  it('refuses the short spellings of "every interface", by name', () => {
    // CA7-28. `OTC_BIND=0` is `0.0.0.0` to Node: the shortest possible typo
    // published the admin surface to the LAN, and the boot line printed `0`.
    for (const shorthand of ['0', '*', 'any', 'all', 'ANY', 'All']) {
      expect(() => bindAddressFromEnvironment({ OTC_BIND: shorthand }), shorthand).toThrow(
        /binds every interface/,
      );
    }
  });

  it('takes an address an operator wrote out in full', () => {
    expect(bindAddressFromEnvironment({ OTC_BIND: '0.0.0.0' })).toBe('0.0.0.0');
    expect(bindAddressFromEnvironment({ OTC_BIND: '192.168.1.10' })).toBe('192.168.1.10');
    expect(bindAddressFromEnvironment({ OTC_BIND: '::' })).toBe('::');
  });

  it('knows which addresses reach past this machine', () => {
    for (const local of ['127.0.0.1', 'localhost', '::1']) {
      expect(isExposedBind(local), local).toBe(false);
    }
    for (const exposed of ['0.0.0.0', '::', '192.168.1.10']) {
      expect(isExposedBind(exposed), exposed).toBe(true);
    }
  });
});

describe('the panel binds where the engine does', () => {
  /**
   * **Cycle Audit 7, CA7-06.** Taking the engine off the LAN moved the
   * exposure one hop rather than closing it. `next start` binds every
   * interface by default, and the panel's `/engine` route adds the operator's
   * bearer token to every write it forwards — so an unauthenticated LAN POST
   * to the panel retired a market, measured, on a tree whose engine was
   * correctly loopback-only.
   *
   * The panel has no `OTC_BIND` of its own, so this pins the start script.
   */
  it('the shipped start script binds loopback unless OTC_PANEL_BIND says otherwise', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const start = manifest.scripts['start'] ?? '';
    expect(start, 'apps/web start script').toMatch(/-H\s+\$\{OTC_PANEL_BIND:-127\.0\.0\.1\}/);
  });

  it('the browser suite boots the panel the way an operator does', () => {
    // A suite that bound differently from the shipped script would be testing
    // a panel nobody runs — which is how this exposure survived PH-20.
    const suite = readFileSync(path.join(repoRoot, 'apps/web/src/panel.stat.test.ts'), 'utf8');
    expect(suite).toMatch(/'start',\s*'-p',\s*String\(port\),\s*'-H',\s*'127\.0\.0\.1'/);
  });
});
