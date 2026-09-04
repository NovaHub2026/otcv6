import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every constructor parameter of the Lab controller has a provider (PH-24.18).
 *
 * Nest resolves the controller's parameters by their declared types at boot.
 * A parameter with a default value passes every unit test that builds the
 * controller by hand and kills the Lab process on start, which the browser
 * suite found after the whole unit suite was green (`LabDistances`, 2026-09-04).
 * This reads the two sources and checks the list, so the defect is a unit
 * failure with the parameter's name in it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(path.join(here, file), 'utf8');

/** Types named by the controller's constructor parameters. */
function constructorTypes(source: string): string[] {
  const match = /export class LabController \{[\s\S]*?constructor\(([\s\S]*?)\) \{\}/.exec(source);
  expect(match, 'the controller constructor').not.toBeNull();
  const types: string[] = [];
  for (const line of match![1]!.split('\n')) {
    const m = /^\s*private readonly \w+: ([A-Za-z]+)/.exec(line);
    if (m) types.push(m[1]!);
  }
  return types;
}

describe('the Lab module provides what its controller asks for', () => {
  it('names a provider for every constructor parameter type', () => {
    const types = constructorTypes(read('lab.controller.ts'));
    expect(types.length).toBeGreaterThanOrEqual(5);
    const module = read('lab.module.ts');
    // VenueService comes from the application module the Lab module registers.
    const fromApp = new Set(['VenueService']);
    const missing = types.filter(
      (type) =>
        !fromApp.has(type) &&
        !new RegExp(`provide: ${type}\\b`).test(module) &&
        !new RegExp(`^\\s*${type},\\s*$`, 'm').test(module),
    );
    expect(missing, 'constructor parameter types with no provider in lab.module.ts').toEqual([]);
  });
});
