import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { readLines,searchFiles,writeFile,hash } from '../src/files.mjs';
import { FileHistory } from '../src/file-history.mjs';
import { extractAttachment,validateDocuments } from '../src/documents.mjs';
import { maintenancePreview,cleanupArtifacts } from '../src/maintenance.mjs';
import { createApplication } from '../src/server.mjs';
import { Agent } from '../src/agent.mjs';
import { fitContext } from '../src/context.mjs';
import { runtimeGpuMemory,memoryPlan,recommendedRuntime } from '../src/hardware.mjs';
import { Trainer,discoverTrainingBases,modelWeightBytes } from '../src/trainer.mjs';
import { prepareDataset } from '../src/datasets.mjs';
import { diagnostics } from '../src/diagnostics.mjs';
import { localOllamaModels } from '../src/ollama.mjs';
import { activityJobs } from '../src/activity.mjs';
import { estimateDownload } from '../src/model-advisor.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-journey-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=await openStore(root);return {root,store};}
const apiFor=app=>async(route,body)=>{const response=await fetch(app.origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Local-Desk-Token':app.token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,value:await response.json()};};

test('shareable diagnostics report the actual version and do not leak local paths, logs or credentials',async t=>{
 const {store}=await fixture(t);store.state.settings.runtimePath='/secret/model/path';store.state.apiKey='secret-api-key';
 const runtime={status:'error',logs:['secret-log'],error:'secret-error',busy:false,executable:async()=>'/secret/model/path'};
 const device={platform:'test',arch:'test',ramGiB:8,freeGiB:4,cores:4,cpu:'test',gpu:null,unifiedMemory:false};
 const result=await diagnostics({runtime,hardware:async()=>device,store,trainer:{job:{status:'error',error:'secret-trainer-error'}}});
 assert.equal(result.version,JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version);
 assert.equal(result.runtime.installed,true);assert.equal(result.training.status,'error');assert.doesNotMatch(JSON.stringify(result),/secret/);
});

test('local Ollama discovery reports supplied model metadata without guessing capabilities',async()=>{
 let requested;const models=await localOllamaModels({fetchImpl:async url=>{requested=url;return new Response(JSON.stringify({models:[{name:'model:latest',size:1024,details:{format:'gguf',quantization_level:'Q4_K_M'}},{name:3}]}));}});
 assert.equal(requested,'http://127.0.0.1:11434/api/tags');assert.deepEqual(models,[{id:'model:latest',bytes:1024,format:'gguf',quantization:'Q4_K_M'}]);
 await assert.rejects(()=>localOllamaModels({fetchImpl:async()=>new Response('{}')}),/invalid model list/);
});

test('activity exposes consistent states without leaking job contents',()=>{
 const jobs=activityJobs({downloads:[{id:'a',status:'downloading',bytes:100,received:25,name:'private filename'},{id:'b',status:'error'}],training:{job:{id:'c',status:'paused',config:{dataset:'private path'}}},conversion:{job:{id:'d',status:'interrupted'}},runtime:{status:'loading',phase:'Reading model'}});
 assert.equal(jobs.find(j=>j.id==='download:a').status,'running');assert.equal(jobs.find(j=>j.id==='download:b').status,'failed');assert.equal(jobs.find(j=>j.kind==='training').status,'paused');assert.equal(jobs.find(j=>j.kind==='conversion').status,'interrupted');assert.equal(jobs.find(j=>j.kind==='runtime').status,'running');assert.equal(jobs[0].progress,.25);assert.equal(jobs[1].progress,null);assert.doesNotMatch(JSON.stringify(jobs),/private/);
});

test('newer storage versions are not silently downgraded or overwritten',async t=>{
 const {root,store}=await fixture(t);const file=path.join(store.dataDir,'state.json');const state=JSON.parse(await fs.readFile(file,'utf8'));state.version=999;const original=JSON.stringify(state);await fs.writeFile(file,original);
 await assert.rejects(()=>openStore(root,store.dataDir),/unsupported format version/);assert.equal(await fs.readFile(file,'utf8'),original);
});

test('automatic execution chooses CPU without a GPU and keeps manual choices',async()=>{
 const runtime=new Runtime('.');runtime.devices=async()=>[];
 assert.equal((await runtime.resolveExecution({executionMode:'auto'})).executionMode,'cpu');
 assert.equal((await runtime.resolveExecution({executionMode:'gpu'})).executionMode,'gpu');
 runtime.devices=async()=>['GPU0: Example (8192 MiB, 4096 MiB free)'];assert.equal((await runtime.resolveExecution({executionMode:'auto'})).executionMode,'hybrid');
 assert.deepEqual(runtimeGpuMemory(await runtime.devices()),{name:'Example',totalGiB:8,freeGiB:4,source:'runtime'});
});

test('automatic runtime selection requires a compatible reported NVIDIA driver and GPU',()=>{
 const nvidia={platform:'linux',arch:'x64',gpu:{cudaVersion:'12.8',computeCapability:'8.6'}};
 assert.equal(recommendedRuntime(nvidia),'cuda');
 assert.equal(recommendedRuntime({...nvidia,gpu:{...nvidia.gpu,cudaVersion:'12.4'}}),'cpu');
 assert.equal(recommendedRuntime({...nvidia,gpu:{...nvidia.gpu,computeCapability:'3.5'}}),'cpu');
 assert.equal(recommendedRuntime({...nvidia,gpu:null}),'cpu');
 assert.equal(recommendedRuntime({...nvidia,platform:'darwin',arch:'arm64'}),'cpu');
 assert.equal(recommendedRuntime({...nvidia,platform:'win32',gpu:{...nvidia.gpu,cudaVersion:'12.4'}}),'cuda');
});

test('pre-download fit advice remains CPU-only and refuses incomplete file estimates',()=>{
 const settings={contextSize:2048,reserveRamGiB:2};const device={freeGiB:12,unifiedMemory:false};const model={name:'example.gguf',kind:'model',bytes:2*1024**3};
 const result=estimateDownload(model,settings,device);assert.equal(result.status,'possible');assert.match(result.reason,/CPU-only/);assert.match(result.reason,/GPU offload is not included/);
 assert.equal(estimateDownload({...model,bytes:32*1024**3},settings,device).status,'unlikely');assert.equal(estimateDownload({...model,name:'example-00001-of-00003.gguf'},settings,device).status,'unknown');assert.equal(estimateDownload({...model,kind:'projector'},settings,device).status,'unknown');
});

test('automatic planning falls back to CPU when GPU memory is unknown or too small',async()=>{
 const runtime=new Runtime('.');runtime.devices=async()=>['GPU0: Example'];
 const model={bytes:2*1024**3,layers:32};const settings={executionMode:'auto',gpuLayers:8,contextSize:2048,reserveRamGiB:2};
 runtime.hardware=async()=>({freeGiB:16,unifiedMemory:false,gpu:null});assert.equal((await runtime.planModel(model,settings)).mode,'cpu');
 runtime.hardware=async()=>({freeGiB:16,unifiedMemory:false,gpu:{freeGiB:.1}});assert.equal((await runtime.planModel(model,settings)).mode,'cpu');
 runtime.hardware=async()=>({freeGiB:16,unifiedMemory:false,gpu:{freeGiB:8}});assert.equal((await runtime.planModel(model,settings)).mode,'hybrid');
});

test('model speed is saved only from completed local runtime timing reports',async t=>{
 const {store}=await fixture(t);let complete=true;const runtime={status:'ready',busy:false,model:{path:'/model.gguf',bytes:123},plan:{mode:'cpu',gpuLayers:0},async completion(){return new Response(`data: ${JSON.stringify({timings:{predicted_per_second:12.5},choices:[{delta:{content:'Answer'},...(complete?{finish_reason:'stop'}:{})}]})}\n\ndata: [DONE]\n\n`);}};
 const agent=new Agent(runtime,store),session={id:'speed',kind:'chat',title:'New session',messages:[]};store.state.sessions.push(session);
 await agent.run({session,workspace:null,text:'Hi',mode:'chat',emit:()=>{}});assert.equal(store.state.modelPerformance['/model.gguf'].tokensPerSecond,12.5);
 delete store.state.modelPerformance['/model.gguf'];complete=false;const events=[];await agent.run({session,workspace:null,text:'Again',mode:'chat',emit:event=>events.push(event)});assert.ok(events.some(event=>event.type==='error'));assert.equal(store.state.modelPerformance['/model.gguf'],undefined);
});

test('training memory preflight counts symlinked Hugging Face weights',async t=>{const {root}=await fixture(t);const model=path.join(root,'snapshot');await fs.mkdir(model);const weights=path.join(root,'weights');await fs.writeFile(weights,Buffer.alloc(1024));try{await fs.symlink(weights,path.join(model,'model.safetensors'));}catch(error){if(process.platform==='win32' && error.code==='EPERM'){t.skip('Windows symlink privileges unavailable');return;}throw error;}assert.equal(await modelWeightBytes(model),1024);});

test('trainer explains why a GGUF library folder cannot be selected as a training base',async t=>{
 const {root,store}=await fixture(t);
 const baseModel=path.join(root,'models');await fs.mkdir(baseModel);
 await fs.writeFile(path.join(baseModel,'chat.gguf'),'GGUF');
 const dataset=path.join(root,'dataset.txt');await fs.writeFile(dataset,'A sample training document.');
 const {reviewId}=await prepareDataset(dataset,store.dataDir);
 const trainer=new Trainer(root,store,{status:'stopped'});
 await assert.rejects(()=>trainer.start({baseModel,dataset,reviewId,confirmedPreview:true}),/Hugging Face model folder.*GGUF files belong in Models/);
 await assert.rejects(()=>trainer.install('unknown'),/Choose a CPU or NVIDIA CUDA/);
 assert.equal(trainer.job,null);
});

test('trainer finds complete Hugging Face bases beside the GGUF library and skips incomplete downloads',async t=>{
 const {root,store}=await fixture(t);
 const modelDir=path.join(root,'models');
 const complete=path.join(root,'training-models','Small-Instruct');
 const incomplete=path.join(root,'training-models','Incomplete');
 for (const directory of [modelDir,complete,incomplete]) await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(path.join(modelDir,'chat.gguf'),'GGUF');
 for (const folder of [complete,incomplete]) {
  await fs.writeFile(path.join(folder,'config.json'),JSON.stringify({architectures:['LlamaForCausalLM']}));
  await fs.writeFile(path.join(folder,'tokenizer.json'),'{}');
 }
 await fs.writeFile(path.join(complete,'model.safetensors'),Buffer.alloc(16));
 await fs.writeFile(path.join(incomplete,'model-00001-of-00002.safetensors'),Buffer.alloc(16));
 await fs.writeFile(path.join(incomplete,'model.safetensors.index.json'),JSON.stringify({weight_map:{a:'model-00001-of-00002.safetensors',b:'model-00002-of-00002.safetensors'}}));
 assert.deepEqual(await discoverTrainingBases(store.dataDir,modelDir),[{path:complete,name:'Small-Instruct',bytes:16}]);
});

test('context fitting handles long histories and preserves complete tool turns',()=>{
 const messages=[{role:'system',content:'Keep this'},...Array.from({length:600},(_,i)=>[{role:'user',content:`Question ${i} `+'x'.repeat(500)},{role:'assistant',content:`Answer ${i} `+'y'.repeat(500)}]).flat(),{role:'user',content:'Current question'},{role:'assistant',content:'',tool_calls:[{id:'tool-1'}]},{role:'tool',tool_call_id:'tool-1',content:'Result'}];
 const before=structuredClone(messages);const fitted=fitContext(messages,[],{contextSize:2048,maxTokens:768});
 assert.ok(fitted.removed>590);assert.equal(fitted.messages[0].content,'Keep this');assert.equal(fitted.messages.at(-1).tool_call_id,'tool-1');assert.equal(fitted.messages.at(-2).tool_calls[0].id,'tool-1');assert.deepEqual(messages,before);
});

test('lazy sessions load on demand, retain dirty data and move safely',async t=>{
 const {root,store}=await fixture(t);for(let i=0;i<25;i++)store.state.sessions.push({id:`chat-${i}`,kind:'chat',title:`Chat ${i}`,messages:[{role:'user',content:`Message ${i}`}],created:i});await store.save();
 const lazy=await openStore(root,store.dataDir,undefined,undefined,{lazySessions:true});assert.equal(lazy.state.sessions.filter(s=>s.messages).length,0);
 const first=await lazy.loadSession('chat-0');first.title='Changed without saving';for(let i=1;i<25;i++)await lazy.loadSession(`chat-${i}`);
 assert.ok(lazy.state.sessions.find(s=>s.id==='chat-0').messages,'dirty sessions must not be evicted');assert.equal((await lazy.readSession('chat-0')).title,'Changed without saving');
 await lazy.save();const destination=path.join(root,'moved');await lazy.moveChats(destination);const reopened=await openStore(root,store.dataDir);assert.equal(reopened.state.sessions.find(s=>s.id==='chat-0').title,'Changed without saving');assert.equal((await fs.readdir(destination)).filter(n=>n.endsWith('.json')).length,25);
});

test('focused search and line reads stay within the workspace and update after changes',async t=>{
 const {root}=await fixture(t);await fs.writeFile(path.join(root,'notes.txt'),'first\nblue lantern\nthird\n');await fs.mkdir(path.join(root,'.git'));await fs.writeFile(path.join(root,'.git','secret.txt'),'blue lantern');
 const found=await searchFiles(root,'blue lantern');assert.equal(found.results[0].path,'notes.txt');assert.equal(found.results[0].line,2);assert.ok(!found.results.some(r=>r.path.includes('.git')));
 assert.match((await readLines(root,'notes.txt',2,2)).content,/2: blue lantern/);await assert.rejects(()=>readLines(root,'../outside',1,2),/protected|outside/);
 await fs.writeFile(path.join(root,'notes.txt'),'new content');assert.equal((await searchFiles(root,'blue lantern')).results.length,0);
});

test('assistant file history restores edits and refuses to overwrite later changes',async t=>{
 const {root,store}=await fixture(t);const history=new FileHistory(store);const workspace={id:'project',path:root};await fs.writeFile(path.join(root,'test.md'),'old');
 const item=await history.record('project','test.md','old','new',true);await writeFile(root,'test.md','new',hash('old'));
 await fs.writeFile(path.join(root,'test.md'),'external');await assert.rejects(()=>history.undo(item.id,workspace),/changed since/);assert.equal(await fs.readFile(path.join(root,'test.md'),'utf8'),'external');
 await fs.writeFile(path.join(root,'test.md'),'new');await history.undo(item.id,workspace);assert.equal(await fs.readFile(path.join(root,'test.md'),'utf8'),'old');await assert.rejects(()=>history.undo(item.id,workspace),/already/);
 const created=await history.record('project','created.md','','created',false);await writeFile(root,'created.md','created',null);await history.undo(created.id,workspace);await assert.rejects(()=>fs.access(path.join(root,'created.md')));
});

test('document attachments are extracted locally and included in model context',async t=>{
 const {root,store}=await fixture(t);const doc=await extractAttachment(store.dataDir,'notes.txt',Buffer.from('The lighthouse is blue.').toString('base64'));assert.equal(doc.text,'The lighthouse is blue.');
 await assert.rejects(()=>extractAttachment(store.dataDir,'bad.exe','YQ=='),/Choose a PDF/);assert.throws(()=>validateDocuments([{name:'x',text:'x'.repeat(20001)}]),/Invalid/);
 let request;const runtime={status:'ready',busy:false,async completion(body){request=body;return new Response('data: {"choices":[{"delta":{"content":"Blue"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');}};
 const agent=new Agent(runtime,store),session={id:'document-chat',kind:'chat',title:'New session',messages:[]};store.state.sessions.push(session);
 await agent.run({session,workspace:null,text:'What color?',documents:[doc],mode:'chat',emit:()=>{}});
 assert.match(request.messages.at(-1).content,/notes.txt[\s\S]*lighthouse is blue/);assert.equal(session.messages[0].documents[0].name,'notes.txt');
});

test('draft and queue APIs persist, protect queued conversations, and permit explicit clearing',async t=>{
 const {root}=await fixture(t);const app=await createApplication({appRoot:root});t.after(()=>app.close());const api=apiFor(app);
 const created=(await api('/api/sessions',{kind:'chat'})).value;
 assert.equal((await api('/api/drafts',{key:created.id,draft:{text:'unfinished',images:[],documents:[],systemPrompt:null}})).status,200);
 const queued=(await api('/api/queue',{sessionId:created.id,text:'later',images:[],documents:[]})).value.message;
 assert.equal((await api('/api/session/delete',{id:created.id})).status,400);assert.equal((await api('/api/queue')).value.message.text,'later');
 assert.equal((await api('/api/queue',{clear:true,id:'wrong'})).status,400);assert.equal((await api('/api/queue',{clear:true,id:queued.id})).status,200);
 assert.equal((await api('/api/drafts')).value[created.id].text,'unfinished');assert.equal((await api('/api/session/delete',{id:created.id})).status,200);
});

test('conversation pins persist and can be changed while a model is busy',async t=>{
 const {root}=await fixture(t);const app=await createApplication({appRoot:root});t.after(()=>app.close());const api=apiFor(app);const created=(await api('/api/sessions',{kind:'chat'})).value;
 app.runtime.busy=true;assert.equal((await api('/api/session/update',{id:created.id,pinned:true})).status,200);assert.equal((await api('/api/session/update',{id:created.id,title:'Blocked'})).status,400);app.runtime.busy=false;
 const reopened=await openStore(root,app.store.dataDir);assert.equal(reopened.state.sessions.find(s=>s.id===created.id).pinned,true);
});

test('storage preview protects current datasets and latest checkpoints',async t=>{
 const {store}=await fixture(t);const data=store.dataDir,id='12345678-1234-1234-1234-123456789abc',dataset='12345678-1234-1234-1234-123456789aaa';const directory=path.join(data,'datasets');await fs.mkdir(directory,{recursive:true});
 const review=path.join(directory,`${dataset}.review.json`),prepared=path.join(directory,`${dataset}.jsonl`);await fs.writeFile(review,'{}');await fs.writeFile(prepared,'{}');const old=new Date(Date.now()-9*86400000);await fs.utimes(review,old,old);await fs.utimes(prepared,old,old);
 const folder=path.join(data,'training',id);for(const name of ['checkpoint-000001','checkpoint-000002']){await fs.mkdir(path.join(folder,name),{recursive:true});await fs.writeFile(path.join(folder,name,'state'),'weights');await fs.utimes(path.join(folder,name),old,old);}await fs.writeFile(path.join(folder,'latest.json'),JSON.stringify({path:path.join(folder,'checkpoint-000002')}));
 const runtime={executable:async()=>{throw new Error('missing');}},trainer={job:null,child:null},converter={active:false};let preview=await maintenancePreview(store,runtime,trainer,converter);
 assert.deepEqual(preview.items.map(i=>i.kind).sort(),['checkpoint','dataset']);assert.ok(!preview.items.some(i=>i.name.includes('000002')));
 const selected=preview.items.map(({id,revision})=>({id,revision}));await assert.rejects(()=>cleanupArtifacts(store,runtime,trainer,converter,[{...selected[0],revision:'changed'}]),/preview changed/);
 const result=await cleanupArtifacts(store,runtime,trainer,converter,selected);assert.equal(result.removed,2);await fs.access(path.join(folder,'checkpoint-000002'));
});

test('metadata-based cache estimation accounts for model dimensions',()=>{
 const settings={executionMode:'cpu',contextSize:8192,gpuLayers:0,reserveRamGiB:2,kvOnGpu:false};const device={freeGiB:100};const base={bytes:1024**3,layers:32};
 const small=memoryPlan({...base,embeddingLength:4096,heads:32,kvHeads:4},settings,device);
 const large=memoryPlan({...base,embeddingLength:4096,heads:32,kvHeads:32},settings,device);assert.ok(large.ramGiB>small.ramGiB);
});
