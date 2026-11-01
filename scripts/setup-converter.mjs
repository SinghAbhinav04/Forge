import path from 'node:path';
import { ensureConverter } from '../src/converter.mjs';
console.log(await ensureConverter(path.resolve('.data')));
