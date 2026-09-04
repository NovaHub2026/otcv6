import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The production composition cannot be given a sign source.
 *
 * PH-24.1. `AppModule.register({signSource})` exists so the Lab can wrap every
 * hosted engine's coin with `SelectableSigns` and play a chosen vector. The
 * same door, opened in production, would put a mechanism that decides which way
 * a step goes into a process carrying positions — INV-001 reduced to a claim
 * about what somebody passed to `register()`.
 *
 * So the door is asserted shut from the production side, on source text,
 * because what is being checked is what is *composed*, and composition is
 * text. Three assertions, each watched failing against a plant.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(path.join(here, file), 'utf8');
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('production registers no sign source (PH-24.1, ADR-0015 §3)', () => {
  it('main.ts registers the application bare', () => {
    const main = code('main.ts');
    expect(main).toMatch(/NestFactory\.create\(AppModule\.register\(\)/);
    expect(main, 'main.ts names a sign source').not.toMatch(
      /signSource|arrivalSource|SelectableSigns|SignSelector|SelectableArrival|ArrivalSelector/,
    );
  });

  it('app.module.ts only passes through what it was given, and defaults to null', () => {
    const app = code('app.module.ts');
    const mentions = app.match(/signSource\b/g) ?? [];
    // Exactly two: the option's declaration, and the pass-through to VenueService.
    expect(
      mentions,
      'app.module.ts does more with signSource than declare and pass it',
    ).toHaveLength(2);
    expect(app).toMatch(/readonly signSource\?: SignSourceFactory/);
    expect(app).toMatch(/options\.signSource \?\? null/);
    // PH-24.13: the arrival source, the same way.
    const arrivals = app.match(/arrivalSource\b/g) ?? [];
    expect(
      arrivals,
      'app.module.ts does more with arrivalSource than declare and pass it',
    ).toHaveLength(2);
    expect(app).toMatch(/readonly arrivalSource\?: SignSourceFactory/);
    expect(app).toMatch(/options\.arrivalSource \?\? null/);
    expect(app, 'app.module.ts constructs a sign source itself').not.toMatch(
      /SelectableSigns|SignSelector|new .*Signs\(/,
    );
  });

  it('nothing outside lab/ names the wrapper', () => {
    const production = readdirSync(here).filter(
      (name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.stat\.test\.ts$/.test(name),
    );
    expect(production.length).toBeGreaterThan(5);
    for (const file of production) {
      expect(code(file), `${file} reaches the Lab's sign source`).not.toMatch(
        /SelectableSigns|SignSelector|selectableSigns|SelectableArrival|ArrivalSelector|selectableArrival/,
      );
    }
  });

  it('markets are retractable only when a Lab source is composed in (PH-24.13)', () => {
    const venue = code('venue.service.ts');
    const sites =
      venue.match(/retractable: this\.signSource !== null \|\| this\.arrivalSource !== null,/g) ??
      [];
    expect(
      sites,
      'every resumeMarket site derives retractable from the composed sources',
    ).toHaveLength(2);
    expect(venue).not.toMatch(/retractable: true/);
  });

  it('the runtime default is the keystream: the option is optional', () => {
    const resume = readFileSync(path.join(here, '../../../packages/runtime/src/resume.ts'), 'utf8');
    expect(resume).toMatch(/readonly signSource\?: SignSourceFactory/);
    expect(resume).toMatch(/readonly arrivalSource\?: SignSourceFactory/);
    expect(resume).toMatch(
      /if \(options\.signSource === undefined && options\.arrivalSource === undefined\) return \{\};/,
    );
  });
});
