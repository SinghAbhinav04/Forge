import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { openStore } from '../src/store.mjs';
import { createApplication } from '../src/server.mjs';
import { McpManager,endpoint,remoteModels } from '../src/integrations.mjs';
import { LocalApi } from '../src/local-api.mjs';
import { Runtime } from '../src/runtime.mjs';
import { memoryPlan } from '../src/hardware.mjs';
import { validateSettings } from '../src/settings.mjs';
import { Downloads,searchModels } from '../src/hub.mjs';
async function temp(t) { const dir=await fs.mkdtemp(path.join(os.tmpdir(),'forge-test-')); const cleanup=[]; t.after(async () => { for (const task of cleanup) await task(); await fs.rm(dir,{ recursive:true,force:true }); }); return { dir,cleanup }; }
const sleep=ms => new Promise(r => setTimeout(r,ms));
async function wait(predicate) { const end=Date.now()+5000; while (!await predicate()) { if (Date.now()>end) throw new Error('Timed out'); await sleep(10); } }
test('v1 chats migrate to individual files; notes, archives and selected session survive a restart',async t => {
  const { dir }=await temp(t); const data=path.join(dir,'.data'); await fs.mkdir(data); const workspace=path.join(dir,'workspace'); await fs.mkdir(workspace);
  await fs.writeFile(path.join(data,'state.json'),JSON.stringify({ version:1,settings:{ modelDir:dir,threads:6,gpuLayers:16 },workspaces:[{ id:'workspace',path:workspace }],sessions:[{ id:'chat-1',title:'Existing',messages:[{ role:'user',content:'Remember this fact' }],memory:'Project note',archived:true }] }));
  const store=await openStore(dir); const chat=JSON.parse(await fs.readFile(path.join(data,'sessions','chats','chat-1.json'),'utf8'));
  assert.equal(chat.messages[0].content,'Remember this fact'); assert.equal(chat.memory,'Project note');
  const index=JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8')); assert.equal(index.sessions[0].messages,undefined); assert.equal(store.state.settings.threads,2);
  store.state.selection={ workspaceId:'workspace',sessionId:'chat-1' }; await store.save();
  const reopened=await openStore(dir); assert.equal(reopened.state.sessions[0].archived,true); assert.equal(reopened.state.selection.sessionId,'chat-1');
  const moved=path.join(dir,'saved','sessions','chats'); await reopened.moveChats(moved); await fs.access(path.join(moved,'chat-1.json')); await fs.access(path.join(data,'sessions','chats','chat-1.json'));
  const third=await openStore(dir); assert.equal(third.state.settings.sessionDir,moved); assert.equal(third.state.sessions[0].messages.length,1);
});
test('corrupt chat files are reported and never overwritten by normal saves',async t => {
  const { dir }=await temp(t); let store=await openStore(dir); store.state.sessions.push({ id:'broken',title:'Broken',messages:[] }); await store.save();
  const file=path.join(store.state.settings.sessionDir,'broken.json'); await fs.writeFile(file,'broken JSON'); store=await openStore(dir); assert.equal(store.warnings.length,1); await store.save(); assert.equal(await fs.readFile(file,'utf8'),'broken JSON');
});
test('runtime modes plan CPU, full GPU and hybrid with headroom guards',() => {
  const model={ bytes:6*1024**3,layers:40 }; const device={ freeGiB:12,gpu:{ freeGiB:8 } }; const base={ contextSize:2048,gpuLayers:16,kvOnGpu:false,reserveRamGiB:2 };
  const cpu=memoryPlan(model,{ ...base,executionMode:'cpu' },device); const gpu=memoryPlan(model,{ ...base,executionMode:'gpu' },device); const hybrid=memoryPlan(model,{ ...base,executionMode:'hybrid' },device);
  assert.equal(cpu.gpuLayers,0); assert.equal(cpu.vramGiB,0); assert.equal(gpu.gpuLayers,41); assert.ok(hybrid.ramGiB>gpu.ramGiB && hybrid.ramGiB<cpu.ramGiB); assert.ok(hybrid.vramGiB>0);
  assert.ok(memoryPlan(model,{ ...base,executionMode:'gpu' },{ freeGiB:12,gpu:{ freeGiB:4 } }).errors.some(e => e.includes('VRAM')));
  assert.ok(memoryPlan(model,{ ...base,executionMode:'cpu' },{ freeGiB:3 }).errors.some(e => e.includes('RAM')));
  assert.ok(memoryPlan(model,{ ...base,executionMode:'gpu' },{ freeGiB:12,unifiedMemory:true }).ramGiB>6);
});
test('advanced sampling and resource settings reject invalid values',async t => {
  const { dir }=await temp(t); const { state }=await openStore(dir); const current=state.settings;
  assert.equal(validateSettings({ topP:.9,executionMode:'gpu',runInBackground:false },current).topP,.9);
  for (const input of [{ topP:2 },{ minP:-1 },{ seed:1.5 },{ microBatchSize:512,batchSize:16 },{ executionMode:'magic' },{ reserveRamGiB:0 },{ runInBackground:'yes' }]) assert.throws(() => validateSettings(input,current));
});
test('MCP connects a real stdio server, discovers tools, invokes them and disconnects',async t => {
  const manager=new McpManager(); t.after(() => manager.close()); await manager.connect({ id:'server',name:'Fixture',transport:'stdio',command:process.execPath,args:[path.resolve('test/mcp-fixture.mjs')] });
  const tool=manager.definitions()[0]; assert.ok(tool.function.name.startsWith('mcp_')); const result=await manager.call(tool.function.name,{ text:'hello' }); assert.equal(result.content[0].text,'echo:hello'); await manager.disconnect('server'); assert.equal(manager.definitions().length,0);
});
test('remote device model discovery and inference use the supplied endpoint and key',async t => {
  const server=http.createServer((req,res) => { assert.equal(req.headers.authorization,'Bearer test-key'); res.setHeader('Content-Type','application/json'); if (req.url==='/v1/models') res.end(JSON.stringify({ data:[{ id:'remote-model' }] })); else res.end(JSON.stringify({ choices:[{ message:{ content:'remote reply' } }] })); });
  await new Promise(r => server.listen(0,'127.0.0.1',r)); t.after(() => new Promise(r => server.close(r))); const base=endpoint(`http://127.0.0.1:${server.address().port}`); const c={ id:'device',name:'Other PC',base,key:'test-key' };
  assert.equal((await remoteModels(c))[0].id,'remote-model'); const runtime=new Runtime('.'); await runtime.useRemote(c,'remote-model'); const result=await (await runtime.completion({ messages:[{ role:'user',content:'hi' }] })).json(); assert.equal(result.choices[0].message.content,'remote reply'); await runtime.stop(); assert.equal(runtime.status,'stopped');
});
test('local model API enforces API keys, serves models, and supports JSON and streaming responses',async t => {
  const { dir,cleanup }=await temp(t); const store=await openStore(dir);
  const runtime={ status:'ready',busy:false,model:{ name:'fixture' },async completion(body) { return body.stream ? new Response('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') : Response.json({ choices:[{ message:{ content:'hello' } }],usage:{ prompt_tokens:3,completion_tokens:2 } }); } };
  const api=new LocalApi(runtime,store); cleanup.push(() => api.stop()); const info=await api.start('127.0.0.1',0); const url=`http://127.0.0.1:${info.port}/v1`; const headers={ Authorization:`Bearer ${store.state.apiKey}`,'Content-Type':'application/json' };
  assert.equal((await fetch(`${url}/models`)).status,401); assert.equal((await (await fetch(`${url}/models`,{ headers })).json()).data[0].id,'fixture');
  const json=await (await fetch(`${url}/chat/completions`,{ method:'POST',headers,body:JSON.stringify({ messages:[{ role:'user',content:'hello' }] }) })).json(); assert.equal(json.choices[0].message.content,'hello');
  const streaming=await fetch(`${url}/chat/completions`,{ method:'POST',headers,body:JSON.stringify({ messages:[{ role:'user',content:'hi' }],stream:true }) }); assert.ok((await streaming.text()).includes('[DONE]')); assert.equal(runtime.busy,false);
  runtime.busy=true; assert.equal((await fetch(`${url}/chat/completions`,{ method:'POST',headers,body:'{}' })).status,409); runtime.busy=false;
});
test('settings features support archive/fork/import, skills, device secrets and API state',async t => {
  const { dir,cleanup }=await temp(t); const app=await createApplication({ appRoot:dir }); cleanup.push(() => app.close());
  const request=async (route,body,method=body===undefined ? 'GET' : 'POST') => { const response=await fetch(app.origin+route,{ method,headers:{ 'X-Local-Desk-Token':app.token,'Content-Type':'application/json' },...(body===undefined ? {} : { body:JSON.stringify(body) }) }); const result=await response.json(); assert.equal(response.status,200,JSON.stringify(result)); return result; };
  const initial=await request('/api/bootstrap'); const s=await request('/api/sessions',{ workspaceId:initial.workspaces[0].id });
  await request('/api/session/update',{ id:s.id,title:'Persistent',memory:'My notes',archived:true }); const fork=await request('/api/session/fork',{ id:s.id }); assert.equal(fork.parentId,s.id); assert.equal(fork.memory,'My notes'); assert.equal(fork.archived,false);
  const exported=await request(`/api/session/export?id=${s.id}`); const imported=await request('/api/session/import',{ workspaceId:initial.workspaces[0].id,document:JSON.parse(exported.content) }); assert.notEqual(imported.id,s.id);
  await request('/api/skills',{ name:'Concise',instructions:'Use concise prose.',enabled:true }); await request('/api/connections',{ name:'Other PC',base:'http://127.0.0.1:45678/v1',key:'do-not-return' });
  const final=await request('/api/bootstrap'); assert.equal(final.skills[0].enabled,true); assert.equal(final.connections[0].key,undefined); assert.equal(final.apiKey,undefined); assert.ok(!JSON.stringify(final).includes('do-not-return')); assert.equal(final.sessions[0].messages,undefined);
});
test('model downloads pause, resume with Range, and verify the final GGUF checksum',async t => {
  const { dir,cleanup }=await temp(t); const store=await openStore(dir); store.state.settings.modelDir=dir; const data=Buffer.alloc(128*1024,4); data.write('GGUF'); const sha=createHash('sha256').update(data).digest('hex');
  const originalFetch=globalThis.fetch; let rangeSeen=false;
  globalThis.fetch=async (url,options={}) => {
    if (String(url).includes('/api/models/owner/model')) return Response.json({ siblings:[{ rfilename:'model.gguf',size:data.length,lfs:{ sha256:sha,size:data.length } }] });
    if (String(url).includes('/api/models?')) return Response.json([{ id:'owner/model',downloads:10 }]);
    const offset=options.headers?.Range ? Number(options.headers.Range.match(/\d+/)[0]) : 0; if (offset) rangeSeen=true; let cursor=offset; let timer;
    const stream=new ReadableStream({ async pull(controller) { await new Promise(r => { timer=setTimeout(r,10); }); if (options.signal?.aborted) { controller.error(new Error('aborted')); return; } if (cursor>=data.length) { controller.close(); return; } const end=Math.min(cursor+4096,data.length); controller.enqueue(data.subarray(cursor,end)); cursor=end; },cancel() { clearTimeout(timer); } });
    return new Response(stream,{ status:offset ? 206 : 200,headers:offset ? { 'Content-Range':`bytes ${offset}-${data.length-1}/${data.length}` } : {} });
  };
  const downloads=new Downloads(store); cleanup.push(async () => { await downloads.close(); globalThis.fetch=originalFetch; });
  assert.equal((await searchModels('test'))[0].id,'owner/model'); const job=await downloads.create('owner/model','model.gguf'); await wait(async () => { try { return (await fs.stat(`${downloads.jobs.get(job.id).destination}.part`)).size>0; } catch { return false; } }); await downloads.control(job.id,'pause'); assert.equal(downloads.jobs.get(job.id).status,'paused'); await downloads.control(job.id,'resume'); await wait(() => ['completed','error'].includes(downloads.jobs.get(job.id).status)); assert.equal(downloads.jobs.get(job.id).status,'completed',downloads.jobs.get(job.id).error); assert.equal(rangeSeen,true); assert.equal(createHash('sha256').update(await fs.readFile(downloads.jobs.get(job.id).destination)).digest('hex'),sha);
});
