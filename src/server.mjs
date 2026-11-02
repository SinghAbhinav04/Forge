import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openStore,sessionSummary } from './store.mjs';
import { Runtime, scanModels } from './runtime.mjs';
import { Agent } from './agent.mjs';
import { listFiles, readFile, writeFile } from './files.mjs';
import { installRuntime } from '../scripts/install-runtime.mjs';
import { validateSettings } from './settings.mjs';
import { createFeatures } from './features.mjs';
import { hardware,recommendedRuntime } from './hardware.mjs';
import { validateImages } from './images.mjs';
import { validateDocuments,extractAttachment } from './documents.mjs';
import { conversationKind,validateSessionPrompt } from './conversations.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
async function jsonBody(req,limit = 2*1024*1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const sameToken = (actual, expected) => typeof actual === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));

export async function createApplication(options = {}) {
  const appRoot = options.appRoot || APP_ROOT;
  const store = await openStore(appRoot, options.dataDir, options.workspaceDir, options.defaultModelDir,{lazySessions:true});
  const runtime = options.runtime || new Runtime(appRoot, options.runtimeDir);
  const agent = new Agent(runtime, store);
  store.protectedSession=()=>agent.active?.sessionId;
  const token = randomBytes(32).toString('hex');
  let origin;
  let installing = false;
  let changingModel = false;
  const workspaceById = id => { const w = store.state.workspaces.find(w => w.id === id); if (!w) throw new Error('Workspace not found.'); return w; };
  const models = async () => { try { return { models: await scanModels(store.state.settings.modelDir), modelError: '' }; } catch (error) { return { models: [], modelError: `Cannot scan model folder: ${error.message}` }; } };
  const features = createFeatures({ appRoot,store,runtime,agent,models,workspaceById,modelOperation:()=>changingModel || installing });
  await features.initialize();
  let modelCache=null; let modelCacheUntil=0;
  let conversionRevision;
  const cachedModels=async () => { const revision=features.modelConverter.job?.completed; if (!modelCache || Date.now()>modelCacheUntil || revision!==conversionRevision) { modelCache=await models(); modelCacheUntil=Date.now()+5000; conversionRevision=revision; } return modelCache; };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { json(res, 403, { error: 'Local origin required.' }); return; }
      const url = new URL(req.url, origin);
      const route = url.pathname;
      if (route.startsWith('/api/')) {
        if (!sameToken(req.headers['x-local-desk-token'], token)) { json(res, 401, { error: 'Open the complete Local Desk launch URL, including the #token fragment.' }); return; }
        if (route === '/api/bootstrap' && req.method === 'GET') {
          let executable = ''; try { executable = await runtime.executable(store.state.settings); } catch { /* Setup is optional until loading. */ }
          const { apiKey,connections,mcpServers,sessions,drafts,queuedMessage,...publicState }=store.state;
          let runtimeDevices=null;if(executable)try{runtimeDevices=await runtime.devices(store.state.settings);}catch{}
          json(res,200,{ ...publicState,sessions:sessions.map(sessionSummary),...features.snapshot(),runtime:runtime.snapshot(),runtimeInstalled:Boolean(executable),runtimeDevices,executable,...(await cachedModels()),hardware:await hardware(),active:agent.active?.sessionId || null }); return;
        }
        if (route === '/api/runtime' && req.method === 'GET') { json(res, 200, { ...runtime.snapshot(), active: agent.active?.sessionId || null }); return; }
        if (route === '/api/drafts' && req.method === 'GET') { json(res,200,store.state.drafts); return; }
        if (route === '/api/attachments/text' && req.method === 'POST') {const input=await jsonBody(req,12*1024**2);json(res,200,await extractAttachment(store.dataDir,input.name,input.base64));return;}
        if (route === '/api/queue' && req.method === 'GET') { json(res,200,{message:store.state.queuedMessage || null});return; }
        if (route === '/api/queue' && req.method === 'POST') {
          const input=await jsonBody(req,4*1024**2);
          if(input.clear===true){if(store.state.queuedMessage && input.id!==store.state.queuedMessage.id)throw new Error('The queued message changed.');store.state.queuedMessage=null;}
          else {if(store.state.queuedMessage)throw new Error('A message is already queued.');const session=await store.loadSession(input.sessionId);if(session.recoveryError)throw new Error('Recover this chat before queueing a message.');if(typeof input.text!=='string' || !input.text.trim() || input.text.length>100000)throw new Error('Enter a message of at most 100,000 characters.');store.state.queuedMessage={id:randomUUID(),sessionId:session.id,text:input.text.trim(),images:validateImages(input.images),documents:validateDocuments(input.documents),created:Date.now()};}
          await store.save({sessionIds:[]});json(res,200,{message:store.state.queuedMessage});return;
        }
        if (route === '/api/drafts' && req.method === 'POST') {
          const input=await jsonBody(req,4*1024**2);
          if(typeof input.key!=='string' || input.key.length>150 || !/^(?:[a-zA-Z0-9_-]+|new:(?:chat|workspace):[a-zA-Z0-9_-]*)$/.test(input.key)) throw new Error('Invalid draft.');
          let value=null;
          if(input.draft===null) value=null;
          else {
            const draft=input.draft; if(!draft || typeof draft.text!=='string' || draft.text.length>100000) throw new Error('Invalid draft text.');
            const images=validateImages(draft.images);const documents=validateDocuments(draft.documents); const systemPrompt=validateSessionPrompt(draft.systemPrompt);
            if(!draft.text && !images.length && !documents.length && systemPrompt===null) value=null;
            else { if(!store.state.drafts[input.key] && Object.keys(store.state.drafts).length>=100) throw new Error('Too many saved drafts. Send or clear an existing draft first.'); value={text:draft.text,images,documents,systemPrompt}; }
          }
          await store.saveDraft(input.key,value); json(res,200,{saved:true}); return;
        }
        if (route === '/api/search/chats' && req.method === 'GET') {
          const query=(url.searchParams.get('q') || '').trim().toLocaleLowerCase();
          if(query.length>200) throw new Error('Search text is too long.');
          const ids=[]; if(query) for(const meta of store.state.sessions) { if(ids.length>=200)break; if(String(meta.title || '').toLocaleLowerCase().includes(query)) {ids.push(meta.id);continue;} const s=await store.readSession(meta.id); if(!s.recoveryError && s.messages.some(m=>['user','assistant'].includes(m.role) && String(m.content || '').toLocaleLowerCase().includes(query))) ids.push(s.id); }
          json(res,200,{ids}); return;
        }
        if (await features.route(req,res,url,{ json,body:jsonBody })) return;
        if (route === '/api/runtime/install' && req.method === 'POST') {
          if (features.modelConverter.active || features.startingHeavyTask) throw new Error('Wait for model conversion or setup to finish, or cancel it first.');
          if (installing || changingModel || agent.active || ['loading', 'ready', 'stopping'].includes(runtime.status)) throw new Error('Stop inference and any other installation first.');
          installing = true;
          try { const input=await jsonBody(req); const automatic=!input.backend || input.backend==='auto'; let backend=automatic ? recommendedRuntime(await hardware({fresh:true})) : input.backend; let executable=await installRuntime({ directory:runtime.runtimeDir,backend,log:message => runtime.log(message) });
            if(automatic && backend==='cuda'){let devices=[];try{devices=await runtime.devices({...store.state.settings,runtimePath:executable});}catch{}if(!devices.length){runtime.log('CUDA runtime could not use a GPU. Installing the CPU runtime instead.');backend='cpu';executable=await installRuntime({directory:runtime.runtimeDir,backend,log:message=>runtime.log(message)});}}
            store.state.settings.runtimePath=executable; await store.save(); options.onSettings?.(store.state.settings); json(res,200,{ executable,backend }); }
          finally { installing = false; }
          return;
        }
        if (route === '/api/settings' && req.method === 'PATCH') {
          const input=await jsonBody(req); const settings=validateSettings(input,store.state.settings);
          if (features.modelConverter.active && input.modelDir!==undefined && settings.modelDir!==store.state.settings.modelDir) throw new Error('Wait for conversion to finish before changing the model folder.');
          if (input.modelDir!==undefined) { try { if (!(await fs.stat(settings.modelDir)).isDirectory()) throw new Error('Not a directory'); } catch { throw new Error('Choose an existing folder containing your GGUF files.'); } }
          if (runtime.sampling) for (const key of ['temperature','maxTokens','topP','topK','minP','repeatPenalty','seed']) if (input[key]!==undefined) runtime.sampling[key]=settings[key];
          store.state.settings = settings; modelCache=null; await store.save(); options.onSettings?.(settings); json(res,200,settings); return;
        }
        if (route === '/api/model/load' && req.method === 'POST') {
          if (features.modelConverter.active || features.startingHeavyTask) throw new Error('Wait for model conversion or setup to finish, or cancel it first.');
          if (agent.active || changingModel || installing) throw new Error('Another task or model operation is active.');
          if (features.trainer.child) throw new Error('Stop training before loading an inference model.');
          changingModel = true;
          try {
            const input = await jsonBody(req);
            const model = (await models()).models.find(m => m.path === input.path);
            if (!model) throw new Error('Select a model from the configured model folder.');
            json(res,200,await runtime.load(model,{ ...validateSettings(store.state.modelDefaults[model.path] || {},store.state.settings),loraAdapters:await features.adapters.forModel(model) }));
          } finally { changingModel = false; }
          return;
        }
        if (route === '/api/model/unload' && req.method === 'POST') {
          if (agent.active || changingModel || installing) throw new Error('Another task or model operation is active.');
          changingModel = true;
          try { await runtime.stop(); json(res, 200, runtime.snapshot()); } finally { changingModel = false; }
          return;
        }
        if (route === '/api/workspaces' && req.method === 'POST') {
          const input = await jsonBody(req);
          if (typeof input.path !== 'string' || !path.isAbsolute(input.path)) throw new Error('Enter an absolute folder path.');
          const folder = await fs.realpath(input.path);
          if (!(await fs.stat(folder)).isDirectory()) throw new Error('Choose an existing folder.');
          let workspace = store.state.workspaces.find(w => w.path === folder);
          if (!workspace) { workspace = { id: randomUUID(), path: folder, name: path.basename(folder) || folder }; store.state.workspaces.push(workspace); await store.save(); }
          json(res, 200, workspace); return;
        }
        if (route === '/api/sessions' && req.method === 'POST') {
          const input = await jsonBody(req); const kind=input.kind ?? 'workspace'; if (!['chat','workspace'].includes(kind)) throw new Error('Choose Chat or Workspace.'); if (kind==='workspace') workspaceById(input.workspaceId);
          const session = { id: randomUUID(),kind,systemPrompt:validateSessionPrompt(input.systemPrompt), workspaceId:kind==='workspace' ? input.workspaceId : null, title: 'New session', messages: [], created: Date.now(), updated: Date.now() };
          store.state.sessions.unshift(session); await store.save(); json(res, 200, session); return;
        }
        if (route === '/api/session/delete' && req.method === 'POST') {
          const input = await jsonBody(req); if (agent.active?.sessionId === input.id) throw new Error('Stop the active session first.');
          if(store.state.queuedMessage?.sessionId===input.id) throw new Error('Remove the queued message before deleting this conversation.');
          if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) throw new Error('Invalid session ID.');
          await store.deleteSession(input.id);await store.saveDraft(input.id,null); json(res,200,{ deleted:true }); return;
        }
        if (route === '/api/files' && req.method === 'GET') { json(res, 200, await listFiles(workspaceById(url.searchParams.get('workspaceId')).path, url.searchParams.get('path') || '.')); return; }
        if (route === '/api/file' && req.method === 'GET') { json(res, 200, await readFile(workspaceById(url.searchParams.get('workspaceId')).path, url.searchParams.get('path'))); return; }
        if (route === '/api/file' && req.method === 'PUT') {
          const input = await jsonBody(req); json(res, 200, await writeFile(workspaceById(input.workspaceId).path, input.path, input.content, input.hash)); return;
        }
        if (route === '/api/approval' && req.method === 'POST') { const input = await jsonBody(req); agent.approve(input.id, input.accept); json(res, 200, { accepted: input.accept === true }); return; }
        if (route === '/api/stop' && req.method === 'POST') { agent.cancel(); json(res, 200, { stopped: true }); return; }
        if (route === '/api/chat' && req.method === 'POST') {
          const input = await jsonBody(req,4*1024**2);
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100000) throw new Error('Enter a message of at most 100,000 characters.');
          const images=validateImages(input.images);
          const documents=validateDocuments(input.documents);
          const session = await store.loadSession(input.sessionId);
          if (session.recoveryError) throw new Error('The saved chat needs recovery. Open a new session to avoid overwriting it.');
          if ((images.length || session.messages.some(m => m.images?.length)) && !runtime.remote && !runtime.configuration?.vision) throw new Error('This conversation includes images. Load a vision-capable model with its matching projector, or start a text-only session.');
          if (agent.active || changingModel || installing) throw new Error('Another task or model operation is active.');
          if (runtime.status !== 'ready') throw new Error('Load a model first.');
          const controller = new AbortController();
          const disconnect = () => { if (!res.writableEnded) controller.abort(new Error('Connection closed.')); };
          res.once('close', disconnect);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
          const emit = event => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
          const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
          try { const generalChat=conversationKind(session)==='chat'; await agent.run({ session,workspace:generalChat ? null : workspaceById(session.workspaceId),text:input.text.trim(),images,documents,mode:generalChat ? 'chat' : input.mode==='agent' ? 'agent' : 'chat',emit,signal:controller.signal }); }
          catch (error) { emit({ type: 'error', message: error.message }); }
          finally { clearInterval(heartbeat); res.end(); res.off('close', disconnect); }
          return;
        }
        json(res, 404, { error: 'API route not found.' }); return;
      }
      const staticFiles = { '/':'index.html','/app.js':'app.js','/help.js':'help.js','/journey.js':'journey.js','/documents.js':'documents.js','/features.js':'features.js','/model-conversion.js':'model-conversion.js','/training-data.js':'training-data.js','/composer.js':'composer.js','/themes.js':'themes.js','/themes.css':'themes.css','/styles.css':'styles.css','/features.css':'features.css','/icon.svg':'icon.svg' };
      if (req.method !== 'GET' || !staticFiles[route]) { json(res, 404, { error: 'Not found.' }); return; }
      const file = path.join(APP_ROOT, 'public', staticFiles[route]);
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)], 'Cache-Control': 'no-store' }); res.end(await fs.readFile(file));
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: error.message }); else res.end();
    }
  });
  server.requestTimeout = 0;
  await new Promise((resolve, reject) => server.once('error', reject).listen(options.port ?? 0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url:`${origin}/#${token}`,origin,token,server,store,runtime,agent,features,
    async close() {
      agent.cancel();
      await features.close();
      for (let i = 0; agent.active && i < 100; i++) await new Promise(r => setTimeout(r, 50));
      runtime.busy = false; await runtime.stop();
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.flushDrafts(); await store.save();
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApplication({ port: Number(process.env.LOCAL_DESK_PORT || 0) });
  console.log(`\nLocal Desk is running. Open this full address:\n\n${app.url}\n\nKeep this terminal open. Press Ctrl+C to stop.\n`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
