import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const dirs = ['src', 'desktop', 'scripts', 'public', 'test'];
let failed = false;
for (const dir of dirs) {
  let entries; try { entries = await fs.readdir(dir); } catch { continue; }
  for (const file of entries.filter(f => /\.(mjs|cjs|js)$/.test(f))) {
    const result = spawnSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
  }
}
if (failed) process.exitCode = 1; else console.log('JavaScript syntax checks passed.');
