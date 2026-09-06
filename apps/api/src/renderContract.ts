import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderContract } from './contract.js';

/** `npm run contract:render`: write the contract's Markdown where the docs index expects it (PH-29.2). */
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../../docs/architecture/API_CONTRACT.md');
writeFileSync(target, renderContract());
process.stdout.write(`${target}\n`);
