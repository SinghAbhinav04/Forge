import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { textChat,jsonChats,prepareChats } from './dataset-chats.mjs';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { parse as csv } from 'csv-parse/sync';
const userRoles=new Set(['user','human','customer','question','prompt','instruction','user1','person1','speaker1']);
const assistantRoles=new Set(['assistant','ai','bot','gpt','chatgpt','answer','response','completion','agent','user2','person2','speaker2']);
const contentText=value => typeof value==='string' ? value : Array.isArray(value) ? value.map(v => typeof v==='string' ? v : v?.type==='text' ? v.text : '').filter(Boolean).join('\n') : '';
export function normalizeMessages(source) {
  if (!Array.isArray(source)) throw new Error('Conversation messages must be an array.');
  const messages=[];
  for (const item of source) {
    if (!item || typeof item!=='object') throw new Error('Invalid message record.');
    const label=String(item.role ?? item.from ?? item.sender ?? item.speaker ?? item.author?.role ?? item.author ?? '').toLowerCase().replace(/[\s_-]/g,'');
    let role=label==='system' ? 'system' : userRoles.has(label) ? 'user' : assistantRoles.has(label) ? 'assistant' : null;
    if (!role && label) throw new Error('Named speakers need participant selection. Use the training preview to choose whose replies to learn.');
    if (!role) throw new Error('A message has no recognizable role/speaker. Preprocess it into user/assistant messages.');
    const content=contentText(item.content?.parts || item.content || item.value || item.text || item.message).trim();
    if (!content || /^<media omitted>$/i.test(content)) continue;
    if (messages.at(-1)?.role===role) messages.at(-1).content+='\n\n'+content; else messages.push({ role,content });
  }
  if (!messages.some(m => m.role==='user') || !messages.some(m => m.role==='assistant')) throw new Error('A conversation needs both user and assistant text. Preprocess incomplete or attachment-only conversations.');
  if (messages.at(-1).role==='user') throw new Error('The conversation ends with an unanswered user message. Add its answer or remove that incomplete turn.');
  return { messages };
}
function exportedChat(source) {
  const mapping=source.mapping; const ordered=[];
  if (source.current_node && mapping[source.current_node]) { let cursor=source.current_node; const seen=new Set(); while (cursor && mapping[cursor] && !seen.has(cursor)) { seen.add(cursor); if (mapping[cursor].message) ordered.unshift(mapping[cursor].message); cursor=mapping[cursor].parent; } }
  else ordered.push(...Object.values(mapping).map(n => n.message).filter(Boolean).sort((a,b) => (a.create_time || 0)-(b.create_time || 0)));
  return normalizeMessages(ordered.filter(m => ['user','assistant','system'].includes(m.author?.role)));
}
export function normalizeRecord(record) {
  if (typeof record==='string') { if (!record.trim()) throw new Error('Empty text example.'); return { text:record.trim() }; }
  if (!record || typeof record!=='object' || Array.isArray(record)) throw new Error('Unrecognized training record.');
  if (record.mapping) return exportedChat(record);
  for (const key of ['messages','conversations','chat_messages','chat']) if (Array.isArray(record[key])) return normalizeMessages(record[key]);
  const pairs=[['prompt','completion'],['question','answer'],['user','assistant'],['input','output'],['instruction','output']];
  for (const [input,output] of pairs) if (typeof record[input]==='string' && typeof record[output]==='string') { const prompt=input==='instruction' && record.input ? `${record.instruction}\n\n${record.input}` : input==='input' && record.instruction ? `${record.instruction}\n\n${record.input}` : record[input]; return normalizeMessages([{ role:'user',content:prompt },{ role:'assistant',content:record[output] }]); }
  if (typeof record.text==='string' && record.text.trim()) return { text:record.text.trim() };
  throw new Error('Unrecognized fields. Use text, messages, ShareGPT conversations, instruction/output, prompt/completion, or question/answer records.');
}
export function normalizeJson(document) {
  let records=document;
  if (!Array.isArray(records)) { if (document?.format==='forge-chat') return [normalizeRecord(document.session)]; const wrapper=['data','train','records','items'].find(k => Array.isArray(document?.[k])); records=wrapper ? document[wrapper] : [document]; }
  if (!records.length) throw new Error('Training data is empty.');
  if (records.every(r => r && typeof r==='object' && (r.role || r.from || r.sender || r.speaker || r.author) && !r.messages && !r.mapping)) return [normalizeMessages(records)];
  return records.map((record,i) => { try { return normalizeRecord(record); } catch (e) { throw new Error(`Record ${i+1}: ${e.message}`); } });
}
export function normalizeText(text) {
  text=text.replaceAll('\r\n','\n').replaceAll('\0','').trim(); if (!text) throw new Error('No extractable text found. Scanned/image-only PDFs need OCR preprocessing.');
  const lines=text.split('\n'); const messages=[]; const labels=[]; let current=null;
  const header=/^(?:#{1,6}\s*)?(?:\[[^\]]{2,40}\]\s*)?\[?([A-Za-z][A-Za-z0-9 _-]{0,24})\]?\s*[:：]\s*(.*)$/;
  for (let line of lines) {
    line=line.replace(/^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s*[-–]\s*/i,'');
    const match=line.match(header) || line.match(/^(?:#{1,6}\s*)?\[?(User\s*1|User\s*2|User|Assistant|Human|AI|Bot|Question|Answer|Prompt|Response)\]?\s*$/i);
    if (match) { const label=match[1].trim(); if (!labels.includes(label)) labels.push(label); current={ role:label,content:match[2] || '' }; messages.push(current); }
    else if (current) current.content+='\n'+line;
  }
  const known=labels.some(l => userRoles.has(l.toLowerCase().replace(/[\s_-]/g,'')) || assistantRoles.has(l.toLowerCase().replace(/[\s_-]/g,'')));
  const looksLikeChat=known || (labels.length===2 && messages.length>=4);
  if (looksLikeChat) return { rows:[normalizeMessages(messages)],mode:'conversation',warnings:labels.some(l => !userRoles.has(l.toLowerCase().replace(/[\s_-]/g,'')) && !assistantRoles.has(l.toLowerCase().replace(/[\s_-]/g,''))) ? ['Unrecognized speaker names were mapped in order: first speaker → user, second → assistant. Review the preview.'] : [] };
  // Documents are valid continued-language examples; no synthetic answers are invented.
  const paragraphs=text.split(/\n\s*\n/); const rows=[]; let chunk='';
  for (const paragraph of paragraphs) { for (let start=0;start<paragraph.length;start+=6000) { const piece=paragraph.slice(start,start+6000); if (chunk.length+piece.length>6000 && chunk) { rows.push({ text:chunk.trim() }); chunk=''; } chunk+=piece+'\n\n'; } }
  if (chunk.trim()) rows.push({ text:chunk.trim() });
  return { rows,mode:'document text',warnings:['No reliable dialogue structure found. Imported as text for continued language training; question/answer pairs were not invented.'] };
}
function decode(buffer) { if (buffer[0]===0xff && buffer[1]===0xfe) return buffer.subarray(2).toString('utf16le'); if (buffer[0]===0xfe && buffer[1]===0xff) { const copy=Buffer.from(buffer.subarray(2)); copy.swap16(); return copy.toString('utf16le'); } try { return new TextDecoder('utf-8',{ fatal:true }).decode(buffer).replace(/^\uFEFF/,''); } catch { return new TextDecoder('windows-1252').decode(buffer); } }
const extractionCache=new Map();
export async function extractDocument(file) {
  const info=await fs.stat(file); const key=`${file}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  if(extractionCache.has(key)) return extractionCache.get(key);
  const text=await extractDocumentUncached(file);
  if(text.length<=2_000_000) { extractionCache.set(key,text); while(extractionCache.size>4)extractionCache.delete(extractionCache.keys().next().value); }
  return text;
}
async function extractDocumentUncached(file) {
  const extension=path.extname(file).toLowerCase(); const info=await fs.stat(file); if (!info.isFile() || info.size>32*1024**2) throw new Error('Choose a document smaller than 32 MiB, or split/preprocess it first.');
  if (extension==='.pdf') {
    if (!globalThis.DOMMatrix) { const module=await import('@thednp/dommatrix'); globalThis.DOMMatrix=module.default || module.DOMMatrix; }
    const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Electron utility processes have Node APIs but PDF.js detects them as a browser.
    // Load the trusted local worker module explicitly, including from app.asar.
    globalThis.pdfjsWorker ||= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdf.GlobalWorkerOptions.workerSrc=import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const task=pdf.getDocument({ data:new Uint8Array(await fs.readFile(file)),isEvalSupported:false,disableFontFace:true,useSystemFonts:true });
    let document;
    try { document=await task.promise; const pages=[]; for (let page=1;page<=document.numPages;page++) { if (page>1000) throw new Error('Split PDFs longer than 1,000 pages before importing.'); const content=await (await document.getPage(page)).getTextContent(); pages.push(content.items.map(item => item.str+(item.hasEOL ? '\n' : ' ')).join('')); } return pages.join('\n\n'); }
    finally { await task.destroy(); }
  }
  if (extension==='.docx') return (await mammoth.extractRawText({ path:file })).value;
  if (extension==='.doc') return (await new WordExtractor().extract(file)).getBody();
  if (['.txt','.md','.json','.jsonl','.csv','.tsv'].includes(extension)) return decode(await fs.readFile(file));
  throw new Error('Supported imports: PDF, DOCX, DOC, TXT, Markdown, JSON, JSONL, CSV and TSV. Preprocess other formats.');
}
const digest=bytes => createHash('sha256').update(bytes).digest('hex');
export async function prepareDataset(file,dataDir,options={}) {
  if (typeof file!=='string' || !path.isAbsolute(file)) throw new Error('Choose an absolute local dataset/document path.');
  const extension=path.extname(file).toLowerCase();
  const info=await fs.stat(file); if (!info.isFile() || info.size>32*1024**2) throw new Error('Choose a document smaller than 32 MiB.');
  const sourceHash=digest(await fs.readFile(file)); const text=await extractDocument(file); let rows; let mode; let warnings=[]; let review={}; let chat;
  try {
    let document;
    if (extension==='.json') { document=JSON.parse(text); mode='structured JSON'; }
    else if (extension==='.jsonl') { document=text.split(/\r?\n/).filter(l => l.trim()).map((line,i) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${i+1}.`); } }); mode='JSONL'; }
    else if (['.csv','.tsv'].includes(extension)) { document=csv(text,{ columns:headers => headers.map(h => h.trim().toLowerCase()),delimiter:extension==='.tsv' ? '\t' : ',',skip_empty_lines:true,bom:true }); mode='tabular records'; }
    chat=document ? jsonChats(document) : textChat(text);
    review=chat ? prepareChats(chat,options.selectedSpeaker) : null;
    if (review?.needsSelection) return { ...review,source:file,originalSample:text.slice(0,5000),examples:0,preview:[] };
    if (review) ({ rows,mode,warnings }=review);
    else if (document) rows=normalizeJson(document);
    else ({rows,mode,warnings}=normalizeText(text));
  } catch (error) { throw new Error(`Import rejected: ${error.message} Please preprocess ambiguous or invalid records and try again.`); }
  if (!rows?.length) throw new Error('No usable training examples. Please preprocess the source.');
  // Prepared chat rows always mask incoming turns. Documents deliberately use text loss.
  rows=rows.map(row=>row.messages ? {...row,assistant_only:true} : row);
  if (digest(await fs.readFile(file))!==sourceHash) throw new Error('Source changed during import. Preview the file again.');
  const directory=path.join(dataDir,'datasets'); await fs.mkdir(directory,{ recursive:true }); const reviewId=randomUUID(); const output=path.join(directory,`${reviewId}.jsonl`); const prepared=rows.map(r=>JSON.stringify(r)).join('\n')+'\n'; await fs.writeFile(output,prepared);
  const result={ path:output,reviewId,source:file,mode,examples:rows.length,warnings,preview:rows.slice(0,3),originalSample:text.slice(0,5000),samples:review?.samples || [],participants:review?.participants || [],selectedSpeaker:review?.selectedSpeaker || null,requiresSpeaker:!!review?.requiresSpeaker,needsSelection:false,lossMode:review?.lossMode || (rows.some(r=>r.messages) ? 'assistant replies only' : 'all document text'),bytes:Buffer.byteLength(text),messages:rows.reduce((n,r)=>n+(r.messages?.length || 0),0) };
  await fs.writeFile(path.join(directory,`${reviewId}.review.json`),JSON.stringify({ source:file,sourceHash,preparedHash:digest(prepared),mode,examples:rows.length,selectedSpeaker:result.selectedSpeaker,lossMode:result.lossMode }));
  return result;
}

export async function reviewedDataset(reviewId,source,dataDir) {
  if (typeof reviewId!=='string' || !/^[a-f0-9-]{36}$/.test(reviewId)) throw new Error('Preview the training source and confirm the prepared examples before starting.');
  const directory=path.join(dataDir,'datasets'); const output=path.join(directory,`${reviewId}.jsonl`);
  let review; try { review=JSON.parse(await fs.readFile(path.join(directory,`${reviewId}.review.json`),'utf8')); } catch { throw new Error('Training preview is missing. Preview and confirm the source again.'); }
  if (review.source!==source || digest(await fs.readFile(source))!==review.sourceHash || digest(await fs.readFile(output))!==review.preparedHash) throw new Error('Training source or prepared data changed after preview. Preview and confirm it again.');
  return { ...review,path:output };
}
