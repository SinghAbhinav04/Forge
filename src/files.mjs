import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const blocked = new Set(['.git', '.codex', '.agents', '.aws', '.ssh', 'node_modules', '.data', 'runtime']);
const extensions = new Set(['.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.csv', '.yaml', '.yml', '.toml', '.py', '.rs', '.xml', '.svg', '.sql', '.log', '.ini']);
export const MAX_FILE = 512 * 1024;
export const hash = text => createHash('sha256').update(text).digest('hex');
export const isText = name => extensions.has(path.extname(name).toLowerCase());
const isDocument=name => ['.pdf','.docx','.doc'].includes(path.extname(name).toLowerCase());
const safeName = name => !blocked.has(name.toLowerCase()) && !name.startsWith('.') && !/[<>:"|?*\x00-\x1f]/.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

export async function confined(root, relative = '.', { missing = false } = {}) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('Use a relative workspace path.');
  const parts = relative.replaceAll('\\', '/').split('/').filter(p => p && p !== '.');
  if (parts.some(p => p === '..' || !safeName(p) || /[. ]$/.test(p))) throw new Error('This path is outside the editable workspace or is protected.');
  const base = await fs.realpath(root);
  let target = base;
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i]);
    try {
      const info = await fs.lstat(target);
      if (info.isSymbolicLink()) throw new Error('Linked files and folders are not accessible.');
      const resolved = await fs.realpath(target);
      const rel = path.relative(base, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes the workspace.');
    } catch (error) {
      if (error.code === 'ENOENT' && missing && i === parts.length - 1) return target;
      throw error;
    }
  }
  return target;
}

export async function listFiles(root, relative = '.') {
  const target = await confined(root, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.filter(e => safeName(e.name) && !e.isSymbolicLink() && (e.isDirectory() || isText(e.name) || isDocument(e.name)))
    .map(e => ({ name: e.name, path: path.posix.join(relative.replaceAll('\\', '/'), e.name), directory: e.isDirectory() }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)).slice(0, 500);
}

export async function readFile(root, relative) {
  const target = await confined(root, relative);
  if (isDocument(target)) { const { extractDocument }=await import('./datasets.mjs'); const content=await extractDocument(target); return { path:relative,content,hash:hash(content),readOnly:true,extracted:true }; }
  if (!isText(target)) throw new Error('This version supports text, Markdown and code files.');
  const handle = await fs.open(target, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_FILE) throw new Error('Choose a text file smaller than 512 KiB.');
    const bytes = await handle.readFile();
    if (bytes.includes(0)) throw new Error('Binary files cannot be opened as documents.');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { path: relative, content, hash: hash(content) };
  } finally { await handle.close(); }
}

export async function inspectWrite(root, relative, content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE || content.includes('\0')) throw new Error('Document must be UTF-8 text smaller than 512 KiB.');
  const target = await confined(root, relative, { missing: true });
  if (!isText(target)) throw new Error('Use a text, Markdown or code file extension.');
  try { return { before: (await readFile(root, relative)).content, exists: true }; }
  catch (error) { if (error.code === 'ENOENT') return { before: '', exists: false }; throw error; }
}

export async function writeFile(root, relative, content, expectedHash) {
  const previous = await inspectWrite(root, relative, content);
  const revision = previous.exists ? hash(previous.before) : null;
  if (expectedHash !== revision) throw new Error('File changed since it was opened. Reopen it and review your changes.');
  const target = await confined(root, relative, { missing: true });
  const temporary = path.join(path.dirname(target), `.local-desk-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    // Recheck the revision immediately before replacing the file.
    const current = await inspectWrite(root, relative, content);
    if ((current.exists ? hash(current.before) : null) !== expectedHash) throw new Error('File changed while saving. Reopen it first.');
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
  return { path: relative, content, hash: hash(content) };
}
