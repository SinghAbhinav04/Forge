import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { parse } from 'parse5';
import { openPromise } from 'yauzl';

const maxPageBytes=8*1024**2;
const maxThreadBytes=32*1024**2;
const catalogPrefixBytes=24*1024;
const catalogPreviewLimit=256;
const pageName=/^message_([1-9]\d{0,5})\.html$/i;
const archivePage=/(?:^|\/)your_instagram_activity\/messages\/[a-z_]+\/([^/]+)\/(message_[1-9]\d{0,5}\.html)$/i;
const months='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const elements=node=>node?.childNodes?.filter(child=>child.tagName) || [];
const hasClass=(node,name)=>node.attrs?.some(attr=>attr.name==='class' && attr.value.split(/\s+/).includes(name));

function firstElement(node,tag) {
  const queue=[node];
  while (queue.length) {
    const current=queue.pop();
    if (current.tagName===tag) return current;
    for (const child of elements(current).reverse()) queue.push(child);
  }
}

function plainText(node) {
  if (!node) return '';
  const pending=[node];
  const parts=[];
  while (pending.length) {
    const current=pending.pop();
    if (current.nodeName==='#text') parts.push(current.value);
    else if (current.tagName==='br') parts.push('\n');
    else if (!['script','style','template','audio','video','iframe'].includes(current.tagName)) {
      for (const child of [...(current.childNodes || [])].reverse()) pending.push(child);
    }
  }
  return parts.join('').trim();
}

function timestamp(text) {
  const match=/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (am|pm)$/i.exec(text.replace(/\s+/g,' '));
  if (match) {
    const [,month,day,year,hour,minute,second='0',period]=match;
    const monthIndex=months.findIndex(value=>value.toLowerCase()===month.toLowerCase());
    const date=new Date(Date.UTC(+year,monthIndex,+day,+hour%12+(period.toLowerCase()==='pm' ? 12 : 0),+minute,+second));
    if (monthIndex>=0 && date.getUTCMonth()===monthIndex && date.getUTCDate()===+day && +hour>=1 && +hour<=12 && +minute<60 && +second<60) return date.getTime();
  }
  throw new Error('An Instagram timestamp could not be read. Export the chat as JSON or export HTML in English.');
}

function messageRecords(bytes) {
  const main=firstElement(parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),'main');
  const cards=elements(main).filter(card=>hasClass(card,'_a6-g'));
  if (!cards.length) throw new Error('Unrecognized Instagram message HTML. Select an exported message_1.html page or use Instagram JSON.');
  const records=[];
  let skipped=0;
  for (const card of cards) {
    const children=elements(card);
    const body=children.find(node=>hasClass(node,'_a6-p'));
    const date=children.find(node=>hasClass(node,'_a6-o'));
    if (!body && !date) continue;
    const heading=children.find(node=>node.tagName==='h2' && hasClass(node,'_a6-i'));
    const bodyElements=elements(body);
    const wrapper=bodyElements[0];
    // Group exports include a link card outside the timestamped conversation.
    if (!date && bodyElements.length===1 && wrapper.tagName==='a') { skipped++; continue; }
    const slots=elements(wrapper);
    if (!heading || !date || wrapper?.tagName!=='div' || slots.length<4 || slots.slice(0,4).some(node=>node.tagName!=='div')) {
      throw new Error('Unrecognized Instagram message block. Export the chat as JSON to preserve sender and message boundaries.');
    }
    const speaker=plainText(heading);
    const time=plainText(date);
    if (!speaker) throw new Error('An Instagram message has no sender. Export the chat as JSON or preprocess this page.');
    // Instagram keeps reactions and attachments in separate slots from the sender's text.
    const content=plainText(slots[1]);
    const notice=/^(?:you (?:sent an attachment|unsent a message)|this message (?:is unavailable|was unsent)|liked a message|reacted .+ to (?:your|a) message)\.?$/i.test(content);
    records.push({ speaker,content:notice ? '' : content,original:`${time} · ${speaker}: ${content}`,time:timestamp(time) });
  }
  return {records,skipped};
}

async function readPage(file) {
  const handle=await fs.open(file,'r');
  try {
    const info=await handle.stat();
    if (!info.isFile() || info.size>maxPageBytes) throw new Error('Each Instagram HTML page must be a file of at most 8 MiB.');
    // Read at most one extra byte to detect a page that grew during the read.
    const bytes=await buffer(handle.createReadStream({end:info.size,autoClose:false}));
    if (bytes.length!==info.size) throw new Error('An Instagram HTML page changed during import.');
    return bytes;
  } finally { await handle.close(); }
}

async function archiveThreads(zip) {
  if (zip.entryCount>100_000) throw new Error('This ZIP has too many entries. Extract it and select the individual Instagram chat folder.');
  const threads=new Map();
  for await (const entry of zip.eachEntry()) {
    const match=archivePage.exec(entry.fileName);
    if (!match) continue;
    const id=entry.fileName.slice(0,-match[2].length-1);
    if (!threads.has(id)) threads.set(id,{id,label:match[1],pages:[]});
    const open=()=>zip.openReadStreamPromise(entry);
    threads.get(id).pages.push({number:Number(pageName.exec(match[2])[1]),size:entry.uncompressedSize,open,read:async ()=>buffer(await open())});
  }
  return threads;
}

async function threadLabel(pages) {
  const page=pages.reduce((first,current)=>current.number<first.number ? current : first);
  const decoder=new TextDecoder();
  const chunks=[];
  let remaining=catalogPrefixBytes;
  try {
    for await (const chunk of await page.open()) {
      const prefix=chunk.subarray(0,remaining);
      chunks.push(decoder.decode(prefix,{stream:true}));
      remaining-=prefix.length;
      if (!remaining) break;
    }
  } catch { return {}; } // Keep the folder label when a page preview is unreadable.
  const dom=parse(chunks.join(''));
  const title=plainText(firstElement(dom,'title')).replace(/\s+/g,' ').slice(0,80);
  const senders=new Set();
  for (const card of elements(firstElement(dom,'main'))) {
    const children=elements(card);
    if (!children.some(node=>hasClass(node,'_a6-o'))) continue;
    const name=plainText(children.find(node=>hasClass(node,'_a6-i'))).replace(/\s+/g,' ').slice(0,48);
    if (name) senders.add(name);
    if (senders.size===4) break;
  }
  return {title:/[\p{L}\p{N}]/u.test(title) ? title : '',recentSenders:[...senders]};
}

async function threadCatalog(threads) {
  const catalog=[];
  for (const {id,label,pages} of threads.values()) {
    const details=catalog.length<catalogPreviewLimit ? await threadLabel(pages) : {};
    catalog.push({id,label,pages:pages.length,...details});
  }
  return catalog.sort((a,b)=>(a.title || a.label).localeCompare(b.title || b.label) || a.id.localeCompare(b.id));
}

async function readThread(pages,parseMessages) {
  if (!pages.length) throw new Error('Select an Instagram chat folder containing message_1.html, or browse to the export ZIP.');
  const sorted=[...pages].sort((a,b)=>b.number-a.number);
  if (new Set(sorted.map(page=>page.number)).size!==sorted.length) throw new Error('This thread has duplicate numbered HTML pages.');
  const hash=createHash('sha256');
  const records=[];
  let size=0;
  let skipped=0;
  for (const page of sorted) {
    if (page.size>maxPageBytes || size+page.size>maxThreadBytes) throw new Error('Instagram imports support up to 8 MiB per page and 32 MiB per chat. Import a smaller export.');
    const bytes=await page.read();
    size+=bytes.length;
    if (size>maxThreadBytes) throw new Error('This Instagram chat grew beyond the 32 MiB import limit.');
    hash.update(`${page.number}:${bytes.length}:`).update(bytes);
    // Pages and cards are newest first in the export. Reverse before sorting for equal timestamps.
    if (parseMessages) {
      const page=messageRecords(bytes);
      skipped+=page.skipped;
      for (const record of page.records.reverse()) records.push(record);
    }
  }
  const sourceHash=hash.digest('hex');
  if (!parseMessages) return {sourceHash};
  records.sort((a,b)=>a.time-b.time);
  return {
    sourceHash,bytes:size,
    chat:{ conversations:[records],named:true,format:'Instagram HTML chat',skipped },
    text:records.slice(0,20).map(record=>record.original).join('\n').slice(0,5000)
  };
}

export async function readInstagramSource(file,info,threadId,parseMessages=true) {
  if (info.isDirectory()) {
    const entries=await fs.readdir(file,{withFileTypes:true});
    const pages=await Promise.all(entries.filter(entry=>entry.isFile() && pageName.test(entry.name)).map(async entry=>{
      const page=path.join(file,entry.name);
      return {number:Number(pageName.exec(entry.name)[1]),size:(await fs.stat(page)).size,read:()=>readPage(page)};
    }));
    return readThread(pages,parseMessages);
  }
  if (path.extname(file).toLowerCase()==='.html') return readThread([{number:1,size:info.size,read:()=>readPage(file)}],parseMessages);

  const zip=await openPromise(file,{autoClose:false});
  try {
    const threads=await archiveThreads(zip);
    if (!threads.size) throw new Error('No Instagram message HTML pages were found in this ZIP. For JSON exports, extract the archive and select a message JSON file.');
    const thread=threads.get(threadId) || (!threadId && threads.size===1 ? threads.values().next().value : null);
    if (!thread) {
      if (threadId) throw new Error('The selected Instagram thread is missing from this ZIP.');
      return { threads:await threadCatalog(threads) };
    }
    return {...await readThread(thread.pages,parseMessages),threadId:thread.id};
  } finally { zip.close(); }
}
