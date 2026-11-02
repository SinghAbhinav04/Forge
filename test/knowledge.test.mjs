import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeStore,splitKnowledge,sourceExcerpt } from '../src/knowledge.mjs';
import { createApplication } from '../src/server.mjs';
import { Agent } from '../src/agent.mjs';
import { openStore } from '../src/store.mjs';
import { extractAttachment } from '../src/documents.mjs';

test('knowledge indexes full documents locally and refuses stale or protected sources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-knowledge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const project=path.join(root,'project');await fs.mkdir(project);const workspace={id:'project-1',path:project};const file=path.join(project,'notes.txt');
 await fs.writeFile(file,`${'ordinary text\n'.repeat(300)}The lighthouse is indigo.\n`);const store=new KnowledgeStore(path.join(root,'data'));t.after(()=>store.close());
 await store.start(workspace,'notes.txt');await store.jobs.get(workspace.id).task;assert.equal(store.snapshot(workspace.id).status,'completed');
 const found=await store.search(workspace,'What color is the lighthouse?');assert.equal(found.sources[0].path,'notes.txt');assert.match(found.sources[0].text,/lighthouse is indigo/);assert.ok(found.sources[0].startLine>1);
 const reopened=new KnowledgeStore(path.join(root,'data'));assert.equal((await reopened.list(workspace)).documents.length,1);
 await fs.writeFile(file,'The lighthouse is amber.');const stale=await reopened.search(workspace,'lighthouse');assert.equal(stale.sources.length,0);assert.deepEqual(stale.stale,['notes.txt']);
 await reopened.start(workspace,'notes.txt');await reopened.jobs.get(workspace.id).task;assert.match((await reopened.search(workspace,'lighthouse')).sources[0].text,/amber/);
 await assert.rejects(()=>store.start(workspace,'../secret.txt'),/outside|protected/);await reopened.remove(workspace,'notes.txt');assert.equal((await reopened.list(workspace)).documents.length,0);assert.equal(await fs.readFile(file,'utf8'),'The lighthouse is amber.');
});

test('knowledge chunks preserve line references',()=>{const chunks=splitKnowledge(`${'a'.repeat(1400)}\nsecond line\n${'b'.repeat(1400)}`);assert.ok(chunks.length>1);assert.equal(chunks[0].startLine,1);assert.ok(chunks.some(chunk=>chunk.text.includes('second line') && chunk.startLine<=2 && chunk.endLine>=2));});

test('PDF attachments extract in the document worker and clean temporary files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-worker-pdf-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const stream='BT /F1 12 Tf 50 750 Td (Lantern is turquoise) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let pdf='%PDF-1.4\n';const offsets=[];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 const result=await extractAttachment(root,'notes.pdf',Buffer.from(pdf).toString('base64'));assert.match(result.text,/Lantern is turquoise/);assert.deepEqual(await fs.readdir(path.join(root,'attachment-temp')),[]);
 const controller=new AbortController();controller.abort(new Error('cancelled'));await assert.rejects(()=>extractAttachment(root,'notes.pdf',Buffer.from(pdf).toString('base64'),{signal:controller.signal}),/cancelled/);assert.deepEqual(await fs.readdir(path.join(root,'attachment-temp')),[]);
});

test('source excerpts include the match and identify the lines shown',()=>{const text=`${'filler\n'.repeat(100)}The harbor lantern is turquoise.\n`;const excerpt=sourceExcerpt({path:'notes.txt',text,startLine:1,endLine:101},'What color is the harbor lantern?',150);assert.match(excerpt.text,/harbor lantern is turquoise/);assert.ok(excerpt.startLine>1);assert.ok(excerpt.endLine<=101);assert.ok(excerpt.text.length<=150);});

test('indexing is exclusive per project and cancellation leaves no partial index',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-knowledge-cancel-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'a.txt'),'A useful document.');await fs.writeFile(path.join(root,'b.txt'),'Another document.');const workspace={id:'p',path:root},store=new KnowledgeStore(path.join(root,'data'));t.after(()=>store.close());
 const attempts=await Promise.allSettled([store.start(workspace,'a.txt'),store.start(workspace,'b.txt')]);assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);assert.equal(attempts.filter(result=>result.status==='rejected').length,1);await store.cancel(workspace.id);assert.equal(store.snapshot(workspace.id).status,'cancelled');assert.equal((await store.list(workspace)).documents.length,0);
});

test('folder indexing includes supported nested files and skips protected and app-data folders',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-knowledge-folder-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'nested'));await fs.mkdir(path.join(root,'.git'));await fs.mkdir(path.join(root,'data'));await fs.writeFile(path.join(root,'nested','a.txt'),'A violet lantern.');await fs.writeFile(path.join(root,'nested','b.jsonl'),'{"note":"amber lantern"}');await fs.writeFile(path.join(root,'.git','hidden.txt'),'secret');await fs.writeFile(path.join(root,'data','state.json'),'private application data');const workspace={id:'folder',path:root},store=new KnowledgeStore(path.join(root,'data'));t.after(()=>store.close());
 await store.startFolder(workspace,'.');await store.jobs.get(workspace.id).task;const listing=await store.list(workspace);assert.equal(listing.job.status,'completed');assert.equal(listing.job.processed,2);assert.equal(listing.job.failed,0);assert.deepEqual(listing.documents.map(doc=>doc.path).sort(),['nested/a.txt','nested/b.jsonl']);assert.ok((await store.search(workspace,'lantern')).sources.length>=1);await assert.rejects(()=>store.start(workspace,'data/state.json'),/application data/);
});

test('an interrupted indexing job is reported after restart without changing saved sources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-knowledge-recovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const workspace={id:'p',path:root},store=new KnowledgeStore(path.join(root,'data'));await fs.mkdir(store.directory,{recursive:true});await fs.writeFile(store.jobFile('p'),JSON.stringify({id:'job',status:'running',path:'notes.txt'}));const result=await store.list(workspace);assert.equal(result.job.status,'interrupted');assert.equal(result.documents.length,0);assert.match(result.job.error,/Start indexing again/);
});

test('workspace questions send real retrieved passages and preserve source details',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-knowledge-api-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const project=path.join(root,'project');await fs.mkdir(project);await fs.writeFile(path.join(project,'notes.txt'),'A private experiment.\nThe lantern is turquoise.');let sent;
 const runtime={status:'ready',busy:false,snapshot(){return {status:this.status,busy:this.busy,source:'local'};},async completion(body){sent=body;return new Response('data: {"choices":[{"delta":{"content":"Turquoise, from notes.txt."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');},async stop(){}};
 const app=await createApplication({appRoot:root,runtime});t.after(()=>app.close());const request=async(route,body)=>{const response=await fetch(app.origin+route,{method:body===undefined?'GET':'POST',headers:{'X-Local-Desk-Token':app.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(response.status,200,await response.clone().text());return response;};
 const workspace=await (await request('/api/workspaces',{path:project})).json();await request('/api/workspace/instructions',{workspaceId:workspace.id,instructions:'Use short answers for this project.'});await request('/api/knowledge/start',{workspaceId:workspace.id,path:'notes.txt'});
 let index;for(let i=0;i<100;i++){index=await (await request(`/api/knowledge?workspaceId=${workspace.id}`)).json();if(!['running','saving'].includes(index.job?.status))break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(index.job.status,'completed');
 const session=await (await request('/api/sessions',{kind:'workspace',workspaceId:workspace.id})).json();const response=await request('/api/chat',{sessionId:session.id,text:'What color is the lantern?',mode:'chat'});await response.text();
 assert.match(JSON.stringify(sent.messages),/lantern is turquoise/);assert.match(sent.messages[0].content,/Use short answers for this project/);const saved=await (await request(`/api/session?id=${session.id}`)).json();assert.equal(saved.messages[0].sources[0].path,'notes.txt');assert.equal(saved.messages[0].sources[0].startLine,1);
});

test('knowledge passages are dropped when needed to keep a message within context',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-knowledge-budget-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=await openStore(root);store.state.settings.contextSize=512;store.state.settings.maxTokens=128;let sent;
 const runtime={status:'ready',busy:false,async completion(body){sent=body;return new Response('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');}};
 const agent=new Agent(runtime,store);agent.knowledge={async search(){return {indexedCount:1,stale:[],sources:Array.from({length:5},(_,i)=>({path:`file${i}.txt`,startLine:1,endLine:1,text:'lighthouse '+('x'.repeat(690))}))};}};const session={id:'small-context',kind:'workspace',title:'New session',messages:[]};store.state.sessions.push(session);const events=[];
 await agent.run({session,workspace:{id:'p',path:root},text:'Explain the lighthouse.',mode:'chat',emit:event=>events.push(event)});assert.ok(sent);assert.ok(events.some(event=>event.type==='done'));assert.ok(events.some(event=>event.type==='notice' && /Context space allowed/.test(event.message)));assert.ok((session.messages[0].sources?.length || 0)<5);
});
