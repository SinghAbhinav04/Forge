import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const blocked = new Set(['.git', '.codex', '.agents', '.aws', '.ssh', 'node_modules', '.data', 'runtime']);
const extensions = new Set(['.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.csv', '.yaml', '.yml', '.toml', '.py', '.rs', '.xml', '.svg', '.sql', '.log', '.ini']);
export const MAX_FILE = 512 * 1024;
export const hash = text => createHash('sha256').update(text).digest('hex');
export const isText = name => extensions.has(path.extname(name).toLowerCase());
const isDocument=name => ['.pdf','.docx','.doc'].includes(path.extname(name).toLowerCase());
const searchIndex=new Map(); let searchIndexBytes=0;
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

// Ranges are bounded so large files can be inspected without putting the whole file in context.
export async function readLines(root,relative,start=1,end=start+99) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start<1 || end<start || end-start>199 || end>100000) throw new Error('Choose a range of at most 200 lines, within the first 100,000 lines.');
  const target=await confined(root,relative);
  if (!isText(target)) throw new Error('Line ranges are available for text and code files.');
  const info=await fs.stat(target); if(!info.isFile() || info.size>32*1024**2) throw new Error('Choose a text file smaller than 32 MiB.');
  const stream=createReadStream(target,{encoding:'utf8'}); const lines=createInterface({input:stream,crlfDelay:Infinity});
  const selected=[]; let number=0,chars=0,truncated=false;
  try { for await (const line of lines) { number++; if(line.includes('\0')) throw new Error('Binary files cannot be read as text.'); if(number<start) continue; if(number>end) break; const item=line.slice(0,4000); if(chars+item.length>30000) { truncated=true; break; } selected.push(`${number}: ${item}`); chars+=item.length; } }
  finally { lines.close(); stream.destroy(); }
  return {path:relative,startLine:start,endLine:start+selected.length-1,content:selected.join('\n'),truncated};
}

// Search is intentionally bounded and uses the same workspace confinement as file tools.
export async function searchFiles(root,query,relative='.') {
  if(typeof query!=='string' || !query.trim() || query.length>200) throw new Error('Enter a search phrase of up to 200 characters.');
  const terms=query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu)?.slice(0,12) || [];
  if(!terms.length) throw new Error('Enter words to search for.');
  const queue=[relative],buckets=new Map(); let visited=0,documents=0,matchCount=0;
  while(queue.length && visited<1000 && documents<40) {
    const folder=queue.shift(); let entries; try { entries=await listFiles(root,folder); } catch { continue; }
    for(const entry of entries) {
      if(entry.directory) { if(queue.length<200) queue.push(entry.path); continue; }
      if(++visited>1000) break;
      try {
        if(isDocument(entry.path) && ++documents>40) break;
        const target=await confined(root,entry.path);const info=await fs.stat(target);const key=`${target}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
        let file=searchIndex.get(key);
        if(!file){const raw=await readFile(root,entry.path);file={lines:raw.content.split(/\r?\n/),extracted:Boolean(raw.extracted),bytes:Buffer.byteLength(raw.content)};if(file.bytes<2*1024**2){searchIndex.set(key,file);searchIndexBytes+=file.bytes;while(searchIndex.size>50 || searchIndexBytes>20*1024**2){const oldest=searchIndex.keys().next().value;searchIndexBytes-=searchIndex.get(oldest).bytes;searchIndex.delete(oldest);}}}
        const lines=file.lines;
        for(let i=0;i<lines.length;i++) { const text=lines[i].toLocaleLowerCase(); const score=terms.reduce((n,t)=>n+(text.includes(t)?1:0),0); if(score) {matchCount++;const bucket=buckets.get(score) || [];if(bucket.length<40)bucket.push({path:entry.path,line:i+1,text:lines[i].slice(0,500),score,extracted:file.extracted});buckets.set(score,bucket);} }
      } catch { /* Unreadable and oversized files are skipped. */ }
    }
  }
  const matches=[...buckets.values()].flat().sort((a,b)=>b.score-a.score || a.path.localeCompare(b.path) || a.line-b.line);
  return {query,results:matches.slice(0,40),filesSearched:visited,truncated:matchCount>40 || queue.length>0};
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
