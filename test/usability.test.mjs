import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readLines} from '../src/files.mjs';
import {KnowledgeStore} from '../src/knowledge.mjs';
import {chatReadiness} from '../public/readiness.js';
import {createApplication} from '../src/server.mjs';

async function folder(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-usability-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('line excerpts disclose long-line clipping and preserve complete short lines',async t=>{
 const root=await folder(t);await fs.writeFile(path.join(root,'notes.txt'),'x'.repeat(6000)+'\nComplete second line');
 const long=await readLines(root,'notes.txt',1,2);assert.equal(long.truncated,true);assert.ok(long.content.endsWith('2: Complete second line'));assert.ok(!long.content.includes('x'.repeat(4001)));
 const short=await readLines(root,'notes.txt',2,2);assert.equal(short.truncated,false);assert.equal(short.content,'2: Complete second line');
});

test('knowledge polling reuses unchanged indexes, sees external updates, and still checks source freshness',async t=>{
 const root=await folder(t),project=path.join(root,'project');await fs.mkdir(project);const source=path.join(project,'notes.txt');await fs.writeFile(source,'Indigo lighthouse.');const stat=await fs.stat(source);const workspace={id:'p',path:project};
 const writer=new KnowledgeStore(path.join(root,'data'));const index={version:1,documents:[{path:'notes.txt',revision:`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,chunks:[{text:'Indigo lighthouse.',startLine:1,endLine:1}]}]};await writer.save('p',index);
 const reader=new KnowledgeStore(path.join(root,'data'));const actual=fs.readFile;let reads=0;t.mock.method(fs,'readFile',async(...args)=>{if(args[0]===reader.file('p'))reads++;return actual(...args);});
 for(let i=0;i<4;i++){assert.equal((await reader.list(workspace)).documents.length,1);assert.equal((await reader.search(workspace,'lighthouse')).sources.length,1);}assert.equal(reads,1,'unchanged index should be parsed only once');
 await writer.save('p',{...index,documents:[]});assert.equal((await reader.list(workspace)).documents.length,0);assert.equal(reads,2,'external change must invalidate cached index');
 await writer.save('p',index);assert.equal((await reader.search(workspace,'lighthouse')).sources.length,1);await fs.writeFile(source,'Changed source text.');const stale=await reader.search(workspace,'lighthouse');assert.equal(stale.sources.length,0);assert.deepEqual(stale.stale,['notes.txt']);
 await reader.remove(workspace,'notes.txt');assert.equal((await reader.list(workspace)).documents.length,0);
});

test('readiness offers the relevant next action without claiming unsupported vision or memory fit',()=>{
 assert.equal(chatReadiness({status:'stopped'}).button,'Add model');assert.equal(chatReadiness({status:'stopped'},{installed:true}).button,'Choose model');
 assert.equal(chatReadiness({status:'ready',source:'local',vision:false},{hasImages:true}).action,'vision');assert.equal(chatReadiness({status:'ready',source:'remote'},{hasImages:true}).label,'Ready to chat');
 assert.equal(chatReadiness({status:'error',error:'Estimated RAM needed 5 GiB'}).action,'memory');assert.equal(chatReadiness({status:'error',error:'Invalid GGUF header'}).action,'models');
 assert.equal(chatReadiness({status:'ready'},{busy:true}).label,'Model is working');assert.equal(chatReadiness({status:'ready'},{loadingSession:true}).label,'Opening conversation');
});

test('adapter conversion refuses to compete with a loaded model or active training',async t=>{
 const root=await folder(t);const app=await createApplication({appRoot:root,dataDir:path.join(root,'data')});t.after(()=>app.close());
 const request=async()=>{const response=await fetch(app.origin+'/api/adapters/convert',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Desk-Token':app.token},body:'{}'});return response.json();};
 app.runtime.status='ready';assert.match((await request()).error,/Unload/);app.runtime.status='stopped';app.features.trainer.child={};
 try{assert.match((await request()).error,/Stop training/);}finally{app.features.trainer.child=null;}
});
