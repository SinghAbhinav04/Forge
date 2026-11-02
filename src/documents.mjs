import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractInWorker } from './document-worker-client.mjs';

const extensions=new Set(['.pdf','.docx','.doc','.txt','.md','.json','.jsonl','.csv','.tsv']);
export function validateDocuments(input=[]) {
  if(!Array.isArray(input) || input.length>3)throw new Error('Attach at most three documents.');
  return input.map(item=>{if(!item || typeof item.name!=='string' || !item.name.trim() || item.name.length>200 || typeof item.text!=='string' || !item.text.trim() || item.text.length>20000)throw new Error('Invalid document attachment.');return {name:item.name,text:item.text,truncated:item.truncated===true};});
}
export async function extractAttachment(dataDir,name,base64,{signal}={}) {
  if(typeof name!=='string' || name.length>200)throw new Error('Invalid file name.');
  const ext=path.extname(name).toLowerCase();if(!extensions.has(ext))throw new Error('Choose a PDF, Word, text, Markdown, JSON, CSV or TSV file.');
  if(typeof base64!=='string' || base64.length>12*1024**2 || !/^[a-zA-Z0-9+/=]+$/.test(base64))throw new Error('Choose a document smaller than 8 MiB.');
  const bytes=Buffer.from(base64,'base64');if(!bytes.length || bytes.length>8*1024**2)throw new Error('Choose a document smaller than 8 MiB.');
  const root=path.join(dataDir,'attachment-temp');await fs.mkdir(root,{recursive:true});const file=path.join(root,`${randomUUID()}${ext}`);
  try{signal?.throwIfAborted();await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});const text=(await extractInWorker(file,{signal})).trim();if(!text)throw new Error('No readable text was found. Scanned documents need OCR first.');return {name:path.basename(name.replaceAll('\\','/')).slice(0,200),text:text.slice(0,20000),truncated:text.length>20000};}
  finally{await fs.rm(file,{force:true});}
}
