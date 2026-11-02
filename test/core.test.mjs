import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listFiles, readFile, writeFile, hash, MAX_FILE } from '../src/files.mjs';
import { openStore } from '../src/store.mjs';
import { Agent } from '../src/agent.mjs';
import { sseData, scanModels } from '../src/runtime.mjs';
import { createApplication } from '../src/server.mjs';
import { chooseAsset } from '../scripts/install-runtime.mjs';
import { validateImages } from '../src/images.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-desk-test-'));
  const beforeCleanup = [];
  t.after(async () => { for (const cleanup of beforeCleanup) await cleanup(); await fs.rm(root, { recursive: true, force: true }); });
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  return { root, workspace, beforeCleanup };
}
test('workspace files reject escapes and protected locations; writes detect stale revisions', async t => {
  const { workspace } = await fixture(t);
  await fs.writeFile(path.join(workspace, 'Notes.md'), 'Original');
  for (const unsafe of ['../outside.md', '..\\outside.md', '.env', '.git/config', 'x/../../outside.md', 'C:\\Windows\\file.txt', '/etc/passwd', 'NUL.txt', 'file.md:stream', 'space /file.md']) await assert.rejects(() => readFile(workspace, unsafe));
  const initial = await readFile(workspace, 'Notes.md');
  const updated = await writeFile(workspace, 'Notes.md', 'Updated', initial.hash);
  assert.equal(updated.content, 'Updated');
  await assert.rejects(() => writeFile(workspace, 'Notes.md', 'Overwrite', initial.hash), /changed/);
  await assert.rejects(() => writeFile(workspace, 'Notes.md', 'Overwrite', null), /changed/);
  const created = await writeFile(workspace, 'New.md', 'New content', null);
  assert.equal(created.hash, hash('New content'));
  assert.equal(await fs.readFile(path.join(workspace, 'Notes.md'), 'utf8'), 'Updated');
  await fs.writeFile(path.join(workspace, 'binary.txt'), Buffer.from([0, 65]));
  await assert.rejects(() => readFile(workspace, 'binary.txt'), /Binary/);
  await fs.writeFile(path.join(workspace, 'large.txt'), 'a'.repeat(MAX_FILE + 1));
  await assert.rejects(() => readFile(workspace, 'large.txt'), /512/);
  await fs.mkdir(path.join(workspace, '.git')); await fs.writeFile(path.join(workspace, '.env'), 'SECRET=private');
  assert.ok(!(await listFiles(workspace)).some(f => f.name.startsWith('.')));
  assert.ok(!(await fs.readdir(workspace)).some(f => f.endsWith('.tmp')));
});
test('directory symlinks cannot escape the workspace', async t => {
  const { root, workspace } = await fixture(t);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.md'), 'private');
  await fs.symlink(outside, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => readFile(workspace, 'linked/secret.md'), /Linked/);
  await assert.rejects(() => writeFile(workspace, 'linked/new.md', 'escape', null), /Linked/);
  assert.ok(!(await listFiles(workspace)).some(f => f.name === 'linked'));
});
test('saved state survives queued concurrent saves and reloads', async t => {
  const { root } = await fixture(t); const store = await openStore(root);
  store.state.sessions.push({ id: 'first', messages: [] }); const first = store.save();
  store.state.sessions.push({ id: 'second', messages: [] }); await Promise.all([first, store.save()]);
  const reopened = await openStore(root); assert.equal(reopened.state.sessions.length, 2);
});
test('model scan omits projectors and continuation shards', async t => {
  const { root } = await fixture(t);
  for (const name of ['model.gguf', 'split-00001-of-00002.gguf', 'split-00002-of-00002.gguf', 'mmproj-model.gguf']) await fs.writeFile(path.join(root, name), 'GGUF');
  assert.deepEqual((await scanModels(root)).map(m => m.name), ['model', 'split-00001-of-00002']);
});
test('runtime selection matches CPU/Metal/Vulkan for each supported OS without selecting accelerator-specific builds', () => {
  const names = ['linux-arm64-snapdragon', 'ubuntu-openvino-2026.4.1-x64', 'win-cuda-12.4-x64', 'win-openvino-2026.4.1-x64', 'win-cpu-x64', 'win-cpu-arm64', 'win-vulkan-x64', 'macos-arm64', 'macos-x64', 'ubuntu-arm64', 'ubuntu-x64', 'ubuntu-vulkan-x64'];
  const assets = names.map(n => ({ name: `llama-b11960-bin-${n}.${n.startsWith('win') ? 'zip' : 'tar.gz'}` }));
  for (const [platform, arch, backend, expected] of [['win32', 'x64', 'cpu', 'win-cpu-x64'], ['win32', 'arm64', 'cpu', 'win-cpu-arm64'], ['darwin', 'arm64', 'cpu', 'macos-arm64'], ['darwin', 'x64', 'cpu', 'macos-x64'], ['linux', 'x64', 'cpu', 'ubuntu-x64'], ['linux', 'arm64', 'cpu', 'ubuntu-arm64'], ['linux', 'x64', 'vulkan', 'ubuntu-vulkan-x64'], ['win32', 'x64', 'vulkan', 'win-vulkan-x64']]) assert.ok(chooseAsset(assets, platform, arch, backend).name.includes(`${expected}.`));
  assert.throws(() => chooseAsset(assets, 'freebsd', 'x64', 'cpu'), /unavailable/);
});

const stream = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
const completion = text => stream([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const toolCall = (name, args, id = 'call-1') => stream([
  { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args).slice(0, 5) } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(5) } }] }, finish_reason: 'tool_calls' }] }
]);
async function agentFixture(t, responses) {
  const { root, workspace } = await fixture(t); const store = await openStore(root);
  const requests = [];
  const runtime = { status: 'ready', busy: false, async completion(body, signal) { signal.throwIfAborted(); requests.push(structuredClone(body)); const next = responses.shift(); if (!next) throw new Error('Unexpected model request'); return next; } };
  const agent = new Agent(runtime, store); const session = { id: 'session', workspaceId: 'workspace', title: 'New session', messages: [] }; store.state.sessions.push(session);
  return { agent, runtime, store, session, requests, workspace: { id: 'workspace', path: workspace } };
}
test('agent reads real files and applies a write only after approval', async t => {
  const f = await agentFixture(t, [toolCall('read_file', { path: 'Source.md' }, 'read-1'), toolCall('write_file', { path: 'Draft.md', content: '# Draft\n\nHello 🌍' }, 'write-1'), completion('Draft saved.')]);
  await fs.writeFile(path.join(f.workspace.path, 'Source.md'), 'Source content');
  const events = []; let beforeApproval;
  await f.agent.run({ ...f, text: 'Read Source.md and draft a document', mode: 'agent', emit: event => {
    events.push(event);
    if (event.type === 'approval') {
      beforeApproval = fs.access(path.join(f.workspace.path, 'Draft.md')).then(() => true, () => false);
      queueMicrotask(async () => { assert.equal(await beforeApproval, false); f.agent.approve(event.id, true); });
    }
  } });
  assert.equal(await fs.readFile(path.join(f.workspace.path, 'Draft.md'), 'utf8'), '# Draft\n\nHello 🌍');
  assert.ok(f.requests[1].messages.some(m => m.role === 'tool' && m.content.includes('Source content')));
  assert.ok(events.some(e => e.type === 'done')); assert.equal(f.runtime.busy, false); assert.equal(f.agent.active, null);
  assert.equal(f.agent.approvals.size, 0);
});
test('declining a proposal leaves the document unchanged', async t => {
  const f = await agentFixture(t, [toolCall('write_file', { path: 'Draft.md', content: 'replacement' }), completion('Write declined.')]);
  await fs.writeFile(path.join(f.workspace.path, 'Draft.md'), 'original');
  await f.agent.run({ ...f, text: 'Replace document', mode: 'agent', emit: e => { if (e.type === 'approval') queueMicrotask(() => f.agent.approve(e.id, false)); } });
  assert.equal(await fs.readFile(path.join(f.workspace.path, 'Draft.md'), 'utf8'), 'original');
  assert.ok(f.session.messages.some(m => m.role === 'tool' && m.content.includes('User declined')));
});

test('vision attachments reach the model as image content and persist in the chat',async t => {
  const image={ name:'shape.png',url:'data:image/png;base64,iVBORw0KGgo=' };
  const f=await agentFixture(t,[completion('A shape.')]); f.runtime.configuration={ contextSize:4096,imageTokens:1120,vision:true };
  await f.agent.run({ ...f,text:'Describe this',images:validateImages([image]),mode:'chat',emit:() => {} });
  const user=f.requests[0].messages.find(m => m.role==='user'); assert.equal(user.content[1].image_url.url,image.url);
  const reopened=await openStore(f.store.appRoot || path.dirname(f.store.dataDir),f.store.dataDir);
  assert.equal(reopened.state.sessions[0].messages[0].images[0].url,image.url);
  const saved=JSON.parse(await fs.readFile(path.join(f.store.state.settings.sessionDir,`${f.session.id}.json`),'utf8'));
  assert.equal(saved.messages[0].images[0].url,undefined);
  assert.match(saved.messages[0].images[0].ref,/^[a-f0-9]{64}\.png$/);
  for (const input of [[null],[{ url:'https://example.com/image.png' }],[{ url:'data:image/svg+xml;base64,PHN2Zz4=' }],[image,image,image]]) assert.throws(() => validateImages(input));
});

test('general chat uses its own prompt and cannot acquire workspace tools through the requested mode',async t => {
  const f=await agentFixture(t,[completion('Paris.')]); f.session.kind='chat'; f.session.workspaceId=null; f.session.memory='Keep answers short.';
  f.store.state.settings.systemPrompt='WORKSPACE_ONLY: discuss Welcome.md and project files.';
  f.store.state.settings.chatSystemPrompt='You are a general assistant. Answer everyday questions directly.';
  await f.agent.run({ ...f,workspace:null,text:'What is the capital of France?',mode:'agent',emit:()=>{} });
  assert.equal(f.requests[0].tools,undefined); assert.equal(f.requests[0].tool_choice,undefined);
  const input=JSON.stringify(f.requests[0].messages); assert.ok(!input.includes('Welcome.md')); assert.ok(!input.includes('WORKSPACE_ONLY')); assert.ok(input.includes('Keep answers short.')); assert.ok(input.includes('general assistant'));
});

test('each chat can override its system prompt without changing other chats or the defaults',async t=>{
 const f=await agentFixture(t,[completion('First.'),completion('Second.')]);f.session.kind='chat';f.session.systemPrompt='Use a friendly, concise voice.';
 const original=f.store.state.settings.chatSystemPrompt;await f.agent.run({...f,text:'Hello',mode:'chat',emit:()=>{}});assert.ok(f.requests[0].messages[0].content.startsWith(f.session.systemPrompt));
 f.session.systemPrompt=null;await f.agent.run({...f,text:'Hello again',mode:'chat',emit:()=>{}});assert.ok(f.requests[1].messages[0].content.startsWith(original));assert.equal(f.store.state.settings.chatSystemPrompt,original);
});
test('editing a file while a proposal is pending rejects the stale proposal', async t => {
  const f = await agentFixture(t, [toolCall('write_file', { path: 'Draft.md', content: 'agent version' }), completion('The file changed; please review again.')]);
  await fs.writeFile(path.join(f.workspace.path, 'Draft.md'), 'original');
  await f.agent.run({ ...f, text: 'Replace document', mode: 'agent', emit: e => { if (e.type === 'approval') void fs.writeFile(path.join(f.workspace.path, 'Draft.md'), 'your edit').then(() => f.agent.approve(e.id, true)); } });
  assert.equal(await fs.readFile(path.join(f.workspace.path, 'Draft.md'), 'utf8'), 'your edit');
  assert.ok(f.session.messages.some(m => m.role === 'tool' && m.content.includes('File changed')));
});
test('stopping a task cancels pending approvals and preserves valid tool history', async t => {
  const f = await agentFixture(t, [toolCall('write_file', { path: 'Draft.md', content: 'must not be written' })]);
  const events = [];
  await f.agent.run({ ...f, text: 'Write document', mode: 'agent', emit: e => { events.push(e); if (e.type === 'approval') queueMicrotask(() => f.agent.cancel()); } });
  await assert.rejects(() => fs.access(path.join(f.workspace.path, 'Draft.md')));
  assert.equal(f.agent.approvals.size, 0); assert.equal(f.runtime.busy, false);
  assert.ok(events.some(e => e.type === 'error' && e.message === 'Task stopped.'));
  assert.ok(f.session.messages.some(m => m.role === 'tool' && m.tool_call_id === 'call-1'));
});
test('incomplete inference streams report an error and exclude partial text from future context', async t => {
  const f = await agentFixture(t, [stream([{ choices: [{ delta: { content: 'partial' } }] }])]); const events = [];
  await f.agent.run({ ...f, text: 'Hi', mode: 'chat', emit: e => events.push(e) });
  assert.ok(events.some(e => e.type === 'error' && /ended before completion/.test(e.message)));
  assert.equal(f.session.messages.at(-1).interrupted, true);
});
test('SSE parsing handles fragmented UTF-8 and multiple frames', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"hello 🌍"}\n\ndata: {"done":true}\n\ndata: [DONE]\n\n');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const events = []; for await (const e of sseData(body)) events.push(e);
  assert.deepEqual(events, [{ text: 'hello 🌍' }, { done: true }]);
});
test('local API enforces authentication/origin, validates settings, saves files and persists sessions', async t => {
  const { root, beforeCleanup } = await fixture(t);
  const app = await createApplication({ appRoot: root }); beforeCleanup.push(() => app.close());
  const request = (route, method = 'GET', body, extra = {}) => fetch(app.origin + route, { method, headers: { 'X-Local-Desk-Token': app.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await fetch(app.origin + '/api/bootstrap')).status, 401);
  assert.equal((await request('/api/bootstrap', 'GET', undefined, { Origin: 'https://foreign.example' })).status, 403);
  const bootstrap = await (await request('/api/bootstrap')).json();
  assert.equal(bootstrap.workspaces.length, 1);
  assert.equal((await request('/api/settings', 'PATCH', { gpuLayers: -1 })).status, 400);
  assert.equal((await request('/api/settings', 'PATCH', { temperature: 0.5 })).status, 200);
  assert.equal((await request('/api/settings','PATCH',{ modelDir:path.join(root,'missing-model-folder') })).status,400);
  assert.equal((await request('/api/settings','PATCH',{ modelDir:root })).status,200);
  const workspaceId = bootstrap.workspaces[0].id;
  const saved = await request('/api/file', 'PUT', { workspaceId, path: 'Test.md', content: '# Test', hash: null }); assert.equal(saved.status, 200);
  const conflict = await request('/api/file', 'PUT', { workspaceId, path: 'Test.md', content: '# Changed', hash: null }); assert.equal(conflict.status, 400);
  const session = await (await request('/api/sessions', 'POST', { workspaceId })).json(); assert.ok(session.id);
  const notLoaded = await request('/api/chat', 'POST', { sessionId: session.id, text: 'Hello' }); assert.equal(notLoaded.status, 400);
  const encoded = new URLSearchParams({ workspaceId, path: '../outside.md' }); assert.equal((await request(`/api/file?${encoded}`)).status, 400);
  const final = await (await request('/api/bootstrap')).json(); assert.equal(final.settings.temperature, 0.5); assert.equal(final.sessions.length, 1);
});

test('first launch creates its default model folder rather than returning a scan error',async t => {
  const { root,beforeCleanup }=await fixture(t); const folder=path.join(root,'Documents','Models');
  const app=await createApplication({ appRoot:root,defaultModelDir:folder }); beforeCleanup.push(() => app.close());
  assert.ok((await fs.stat(folder)).isDirectory());
  const data=await (await fetch(app.origin+'/api/bootstrap',{ headers:{ 'X-Local-Desk-Token':app.token } })).json();
  assert.equal(data.modelError,''); assert.equal(data.settings.modelDir,folder); assert.deepEqual(data.models,[]);
});
