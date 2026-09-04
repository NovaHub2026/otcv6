import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What the Lab's sources claim about themselves, read as text.
 *
 * Every constructor parameter of the Lab controller has a provider (PH-24.18),
 * and every guard a comment here names exists.
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

/** Test files under the source trees, by base name. */
function testFileNames(): Set<string> {
  const found = new Set<string>();
  const skip = new Set(['node_modules', 'dist', 'coverage', '.next']);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith('.test.ts')) found.add(entry.name);
    }
  };
  const root = path.resolve(here, '../../../..');
  for (const tree of ['apps', 'packages', 'tools']) walk(path.join(root, tree));
  return found;
}

describe('a comment that names a guard names one that exists', () => {
  it('every `*.test.ts` cited under apps/api/src/lab is a file', () => {
    // `lab.module.ts` credited a test file that has never existed with closing
    // the defect its own comment described (Cycle Audit 8, a8). A comment
    // naming a guard is how the next reader decides something is covered, so
    // the name has to resolve to a file.
    const cited = new Set<string>();
    for (const file of readdirSync(here)) {
      if (!file.endsWith('.ts')) continue;
      for (const match of read(file).matchAll(/`([A-Za-z0-9_.-]+\.test\.ts)`/g)) {
        cited.add(match[1]!);
      }
    }
    expect(cited.size, 'the scan found no citations at all').toBeGreaterThanOrEqual(5);
    const present = testFileNames();
    const missing = [...cited].filter((name) => !present.has(name)).sort();
    expect(
      missing,
      'test files named by a comment under apps/api/src/lab that do not exist',
    ).toEqual([]);
  });
});
