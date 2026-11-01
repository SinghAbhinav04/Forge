import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const directory=path.resolve(process.argv[2] || 'dist'); const files=(await fs.readdir(directory)).filter(f => /\.(exe|dmg|zip|AppImage|deb)$/.test(f)).sort(); if (!files.length) throw new Error('No release packages found.');
const lines=[]; for (const file of files) { const hash=createHash('sha256'); for await (const chunk of createReadStream(path.join(directory,file))) hash.update(chunk); lines.push(`${hash.digest('hex')}  ${file}`); }
await fs.writeFile(path.join(directory,'SHA256SUMS.txt'),lines.join('\n')+'\n'); console.log(`Wrote checksums for ${files.length} package(s).`);
