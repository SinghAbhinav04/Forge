import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { normalizeJson,normalizeText,prepareDataset } from '../src/datasets.mjs';
import { openStore } from '../src/store.mjs';
import { SkillLibrary } from '../src/skills.mjs';
import { fitContext } from '../src/context.mjs';
async function root(t) { const p=await fs.mkdtemp(path.join(os.tmpdir(),'forge-data-')); t.after(() => fs.rm(p,{ recursive:true,force:true })); return p; }
function pdf(lines) {
  const stream=`BT /F1 12 Tf 50 750 Td ${lines.map((line,i) => `${i ? '0 -20 Td ' : ''}(${line.replace(/[()\\]/g,'\\$&')}) Tj`).join('\n')} ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let data='%PDF-1.4\n'; const offsets=[0]; for (let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(data)); data+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`; } const xref=Buffer.byteLength(data); data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return data;
}
test('common structured chat schemas normalize into model-independent roles',() => {
  for (const source of [[{ prompt:'Hi',completion:'Hello' }],[{ instruction:'Translate',input:'Hello',output:'Bonjour' }],[{ question:'Why?',answer:'Because.' }],[{ conversations:[{ from:'human',value:'Hi' },{ from:'gpt',value:'Hello' }] }],[{ role:'User 1',content:'Hi' },{ role:'User 2',content:'Hello' }]]) { const result=normalizeJson(source); assert.equal(result[0].messages[0].role,'user'); assert.equal(result[0].messages[1].role,'assistant'); }
  const exported={ mapping:{ a:{ parent:null,message:{ author:{ role:'user' },content:{ parts:['Hi'] } } },b:{ parent:'a',message:{ author:{ role:'assistant' },content:{ parts:['Hello'] } } } },current_node:'b' }; assert.equal(normalizeJson(exported)[0].messages[1].content,'Hello');
  assert.throws(() => normalizeJson([{ messages:[{ role:'user',content:'No reply' }] }]),/both user and assistant/);
});
test('text chat labels normalize automatically; ordinary documents remain text examples',() => {
  const result=normalizeText('User 1: Hi\nHow are you?\nUser 2: Well, thanks.'); assert.equal(result.mode,'conversation'); assert.equal(result.rows[0].messages[0].content,'Hi\nHow are you?');
  const named=normalizeText('Alice: Hi\nBob: Hello\nAlice: Ready?\nBob: Yes.'); assert.equal(named.rows[0].messages[1].role,'assistant'); assert.equal(named.warnings.length,1);
  const plain=normalizeText('A long reference document about local language models.'); assert.ok(plain.rows[0].text); assert.ok(plain.warnings[0].includes('not invented'));
  assert.throws(() => normalizeText('User: Unanswered'),/both user and assistant/);
});
test('TXT, JSON, JSONL and CSV import into valid canonical JSONL',async t => {
  const dir=await root(t); const fixtures={ 'chat.txt':'User1: Hi\nUser2: Hello','chat.json':JSON.stringify({ messages:[{ role:'user',content:'Hi' },{ role:'assistant',content:'Hello' }] }),'chat.jsonl':'{"prompt":"Hi","completion":"Hello"}\n','chat.csv':'question,answer\n"Hi","Hello"\n' };
  for (const [name,text] of Object.entries(fixtures)) { const file=path.join(dir,name); await fs.writeFile(file,text); const result=await prepareDataset(file,dir); assert.equal(result.examples,1); const row=JSON.parse((await fs.readFile(result.path,'utf8')).trim()); assert.equal(row.messages[1].content,'Hello'); }
  await fs.writeFile(path.join(dir,'bad.jsonl'),'invalid'); await assert.rejects(() => prepareDataset(path.join(dir,'bad.jsonl'),dir),/preprocess/);
});
test('real PDF and DOCX documents extract locally and detect dialogue labels',async t => {
  const dir=await root(t); const file=path.join(dir,'chat.pdf'); await fs.writeFile(file,pdf(['User1: Hi there','User2: Hello from PDF'])); const result=await prepareDataset(file,dir); assert.equal(result.preview[0].messages[1].content,'Hello from PDF');
  const zip=new JSZip(); zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'); zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'); zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>User1: Hi there</w:t></w:r></w:p><w:p><w:r><w:t>User2: Hello from Word</w:t></w:r></w:p></w:body></w:document>');
  const docx=path.join(dir,'chat.docx'); await fs.writeFile(docx,await zip.generateAsync({ type:'nodebuffer' })); const word=await prepareDataset(docx,dir); assert.equal(word.preview[0].messages[1].content,'Hello from Word');
});
test('skill folders import instructions and confined reference files',async t => {
  const dir=await root(t); const store=await openStore(dir); const source=path.join(dir,'custom-skill'); await fs.mkdir(path.join(source,'references'),{ recursive:true }); await fs.writeFile(path.join(source,'SKILL.md'),'---\nname: my-style\n---\nBegin every answer with STYLE_OK.'); await fs.writeFile(path.join(source,'references','guide.md'),'Use short sentences.');
  const skills=new SkillLibrary(store); await skills.initialize(); const imported=await skills.importFolder(source); assert.equal(imported.name,'my-style'); assert.equal(imported.enabled,true); assert.ok((await skills.resource('my-style','references/guide.md')).content.includes('short'));
  await assert.rejects(() => skills.resource('my-style','../../state.json'));
});
test('context budgeting preserves full history in storage while omitting older turns from a request',() => {
  const messages=[{ role:'system',content:'Keep session notes.' },{ role:'user',content:'old '.repeat(600) },{ role:'assistant',content:'old response' },{ role:'user',content:'latest question' }]; const result=fitContext(messages,[],{ contextSize:1024,maxTokens:256 }); assert.equal(result.removed,1); assert.ok(result.messages.some(m => m.content==='latest question')); assert.equal(messages.length,4);
});

test('image context uses its token budget rather than the base64 payload size',() => {
  const messages=[{ role:'system',content:'Describe the image.' },{ role:'user',content:[{ type:'text',text:'What is here?' },{ type:'image_url',image_url:{ url:'data:image/jpeg;base64,'+'A'.repeat(1_000_000) } }] }];
  assert.equal(fitContext(messages,[],{ contextSize:2048,maxTokens:256,imageTokens:1120 }).messages.length,2);
  assert.throws(() => fitContext(messages,[],{ contextSize:1024,maxTokens:256,imageTokens:1120 }),/available context/);
});
