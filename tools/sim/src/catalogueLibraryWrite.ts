#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogueLibrary } from './catalogueLibrary.js';

/**
 * Write `docs/integration/CATALOGUE.md` from the compiled catalogue (PH-26.4).
 *
 * A deliberate act like the evidence runners: `npm run catalogue:library`. The
 * table it writes is re-derived by `catalogueLibrary.test.ts`, so a catalogue
 * or a seat edited without re-running this fails the unit project by name.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../..', 'docs', 'integration', 'CATALOGUE.md');
writeFileSync(target, catalogueLibrary(), 'utf8');
process.stderr.write(`wrote ${target}\n`);
