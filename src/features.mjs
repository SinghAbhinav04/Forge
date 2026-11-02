import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpManager,endpoint,remoteModels } from './integrations.mjs';
import { Downloads,searchModels,modelFiles } from './hub.mjs';
import { LocalApi } from './local-api.mjs';
import { Trainer,trainingEnvironment } from './trainer.mjs';
import { transcribe } from './voice.mjs';
import { hardware,ggufMetadata,chooseMemoryPlan } from './hardware.mjs';
import { validateSettings } from './settings.mjs';
import { installVoice } from '../scripts/install-voice.mjs';
import { SkillLibrary } from './skills.mjs';
import { prepareDataset } from './datasets.mjs';
import { AdapterLibrary } from './adapters.mjs';
import { AdapterConverter } from './converter.mjs';
import { ModelConverter,inspectConversionInput } from './model-converter.mjs';
import { FileHistory } from './file-history.mjs';
import { maintenancePreview,cleanupArtifacts } from './maintenance.mjs';
import { validateImages } from './images.mjs';
import { validateDocuments } from './documents.mjs';
import { conversationKind,validateSessionPrompt } from './conversations.mjs';
import { findProjectors } from './vision.mjs';
import { diagnostics } from './diagnostics.mjs';
import { localOllamaModels,ollamaConnection } from './ollama.mjs';
import { activityJobs } from './activity.mjs';
import { KnowledgeStore,validateSources } from './knowledge.mjs';
import { estimateDownload } from './model-advisor.mjs';
import { projectGitStatus } from './project-git.mjs';
import { listPromptPresets,savePromptPreset,removePromptPreset } from './prompt-presets.mjs';
import { checkForUpdate } from './updates.mjs';
import { searchWeb } from './web-search.mjs';
import { benchmarkModel } from './model-benchmark.mjs';
const publicConnection=({ key,...c }) => ({ ...c,hasKey:Boolean(key) });
export function createFeatures({ appRoot,store,runtime,agent,models,workspaceById,modelOperation=()=>false }) {
  const mcp=new McpManager(); const downloads=new Downloads(store); const localApi=new LocalApi(runtime,store); const trainer=new Trainer(appRoot,store,runtime); agent.mcp=mcp;
  const skills=new SkillLibrary(store); agent.skillLibrary=skills;
  const adapters=new AdapterLibrary(store); trainer.adapterLibrary=adapters;
  const converter=new AdapterConverter(store,adapters);
  const modelConverter=new ModelConverter(store,runtime);
  const fileHistory=new FileHistory(store); agent.fileHistory=fileHistory;
  const knowledge=new KnowledgeStore(store.dataDir);agent.knowledge=knowledge;
  const voiceControllers=new Set();
  let voiceInstalling=false;
  let comparisonController=null; let comparisonTask=null;
  let benchmarkController=null;let benchmarkTask=null;
  let startingHeavyTask=false;
  const exclusiveStarts=['/api/model/convert','/api/connections/use','/api/ollama/use','/api/trainer/install','/api/trainer/start','/api/trainer/control','/api/adapters/convert'];
  const idle=() => { if (agent.active || runtime.busy) throw new Error('Stop the active task first.'); };
  const findSession=id => store.loadSession(id);
  return {
    mcp,downloads,localApi,trainer,skills,adapters,modelConverter,
    get startingHeavyTask() { return startingHeavyTask; },
    async initialize() { await modelConverter.initialize(); await skills.initialize(); await skills.scan(); if (trainer.job?.status==='completed' && !store.state.adapters.some(a => a.sourceJobId===trainer.job.id)) { try { await adapters.registerJob(trainer.job); } catch (error) { trainer.job.error=`Adapter recovery: ${error.message}`; await store.save(); } } },
    snapshot() { return { modelConversion:modelConverter.snapshot(),mcp:mcp.snapshot(store.state.mcpServers),connections:store.state.connections.map(publicConnection),downloads:downloads.snapshot(),localApi:localApi.snapshot(),trainer:trainer.snapshot(),loras:adapters.snapshot(),storage:{ dataDir:store.dataDir,sessionDir:store.state.settings.sessionDir,skillsDir:skills.directory,trainedDir:adapters.directory },storageWarnings:store.warnings }; },
    async route(req,res,url,{ json,body }) {
      const route=url.pathname; const method=req.method;
      const post=async handler => {
        const input=await body(req,route==='/api/session/import' ? 32*1024**2 : undefined);
        const exclusive=exclusiveStarts.includes(route);
        if (exclusive && (startingHeavyTask || modelOperation())) throw new Error('Another model operation is starting. Wait for it to finish.');
        if (exclusive && route!=='/api/model/convert' && modelConverter.active) throw new Error('Wait for model conversion to finish, or cancel it first.');
        if (exclusive) startingHeavyTask=true;
        try { json(res,200,await handler(input)); return true; } finally { if (exclusive) startingHeavyTask=false; }
      };
      const conversionIdle=() => { if (modelConverter.active) throw new Error('Wait for model conversion to finish, or cancel it first.'); };
      if (route==='/api/activity' && method==='GET') { const activity={downloads:downloads.snapshot(),conversion:modelConverter.snapshot(),training:trainer.snapshot(),runtime:runtime.snapshot(),knowledge:knowledge.snapshots()};json(res,200,{...activity,jobs:activityJobs(activity)}); return true; }
      if (route==='/api/maintenance' && method==='GET') { const {_items,...preview}=await maintenancePreview(store,runtime,trainer,modelConverter);json(res,200,preview);return true; }
      if (route==='/api/maintenance/cleanup' && method==='POST') return post(async input=>{idle();return cleanupArtifacts(store,runtime,trainer,modelConverter,input.items);});
      if (route==='/api/file/history' && method==='GET') { const workspace=workspaceById(url.searchParams.get('workspaceId'));json(res,200,await fileHistory.list(workspace.id));return true; }
      if (route==='/api/file/undo' && method==='POST') return post(async input=>{idle();return fileHistory.undo(input.id,workspaceById(input.workspaceId));});
      if (route==='/api/model/conversion' && method==='GET') { json(res,200,modelConverter.snapshot()); return true; }
      if (route==='/api/model/conversion/preview' && method==='POST') return post(async input=>{const config=await inspectConversionInput(input,store.state.settings.modelDir);const device=await hardware();const available=Math.max(0,device.freeGiB-(store.state.settings.reserveRamGiB || 2));const roughQ8=config.sourceBytes/1024**3*.6;return {sourceBytes:config.sourceBytes,temporaryBytes:config.requiredBytes,availableRamGiB:available,recommended:roughQ8+0.5>available?'Q4_K_M':'q8_0',note:'The recommendation assumes common 16-bit source weights and is only a rough estimate. Architecture, context, and GPU memory affect actual fit.'};});
      if (route==='/api/model/convert' && method==='POST') return post(async input => { idle(); if (trainer.child || converter.tasks.size) throw new Error('Stop training and adapter conversion before converting a model.'); return modelConverter.start(input); });
      if (route==='/api/model/cancel-conversion' && method==='POST') return post(async () => modelConverter.cancel());
      if (method==='POST' && ['/api/runtime/activate','/api/connections/use','/api/trainer/install','/api/trainer/start','/api/trainer/control','/api/adapters/convert'].includes(route)) conversionIdle();
      if (route==='/api/hardware' && method==='GET') { json(res,200,runtime.hardware ? await runtime.hardware(store.state.settings) : await hardware()); return true; }
      if (route==='/api/update-check' && method==='POST') return post(async()=>checkForUpdate());
      if (route==='/api/web-search' && method==='POST') return post(async input=>searchWeb(input.query,input.key));
      if (route==='/api/prompt-presets' && method==='GET') { json(res,200,listPromptPresets(store)); return true; }
      if (route==='/api/prompt-presets' && method==='POST') return post(async input=>input.remove ? removePromptPreset(store,input.id) : savePromptPreset(store,input));
      if (route==='/api/project/git' && method==='GET') { json(res,200,await projectGitStatus(workspaceById(url.searchParams.get('workspaceId')).path)); return true; }
      if (route==='/api/knowledge' && method==='GET') { json(res,200,await knowledge.list(workspaceById(url.searchParams.get('workspaceId')))); return true; }
      if (route==='/api/knowledge/start' && method==='POST') return post(async input=>knowledge.start(workspaceById(input.workspaceId),input.path));
      if (route==='/api/knowledge/folder' && method==='POST') return post(async input=>knowledge.startFolder(workspaceById(input.workspaceId),input.path));
      if (route==='/api/knowledge/cancel' && method==='POST') return post(async input=>{workspaceById(input.workspaceId);return knowledge.cancel(input.workspaceId);});
      if (route==='/api/knowledge/remove' && method==='POST') return post(async input=>knowledge.remove(workspaceById(input.workspaceId),input.path));
      if (route==='/api/knowledge/search' && method==='POST') return post(async input=>knowledge.search(workspaceById(input.workspaceId),input.query));
      if (route==='/api/ollama/models' && method==='GET') { try{json(res,200,{available:true,models:await localOllamaModels()});}catch{json(res,200,{available:false,models:[]});} return true; }
      if (route==='/api/ollama/use' && method==='POST') return post(async input=>{idle();if(trainer.child || modelConverter.active || modelOperation())throw new Error('Stop the active model operation before switching models.');const available=await localOllamaModels();if(!available.some(m=>m.id===input.model))throw new Error('This model is no longer available in local Ollama.');let connection=store.state.connections.find(c=>c.base===ollamaConnection.base);if(!connection){connection={id:randomUUID(),...ollamaConnection};store.state.connections.push(connection);await store.save();}return runtime.useRemote(connection,input.model);});
      if (route==='/api/vision/projectors' && method==='GET') { json(res,200,await findProjectors(store.state.settings.modelDir)); return true; }
      if (route==='/api/session/prompt' && method==='POST') return post(async input => { const s=await findSession(input.id); if(s.recoveryError) throw new Error('Recover this chat before changing its prompt.'); s.systemPrompt=validateSessionPrompt(input.systemPrompt); await store.save(); return {id:s.id,systemPrompt:s.systemPrompt}; });
      if (route==='/api/runtime/builds' && method==='GET') { json(res,200,await runtime.installed()); return true; }
      if (route==='/api/runtime/activate' && method==='POST') return post(async input => { idle(); if (['loading','ready','stopping'].includes(runtime.status)) throw new Error('Unload the model before changing runtime builds.'); const build=(await runtime.installed()).find(b => b.executable===input.executable); if (!build) throw new Error('Choose an installed runtime.'); store.state.settings.runtimePath=build.executable; await store.save(); return build; });
      if (route==='/api/model/plan' && method==='POST') return post(async input => { const model=(await models()).models.find(m => m.path===input.path); if (!model) throw new Error('Model not found.'); const metadata=await ggufMetadata(model.path); let settings=validateSettings({ ...store.state.modelDefaults[model.path],...input.settings },store.state.settings); const projectorBytes=settings.projectorPath ? (await fs.stat(settings.projectorPath)).size : 0; const loraAdapters=await adapters.forModel(model); if(runtime.planModel) return runtime.planModel({ ...model,...metadata },{ ...settings,projectorBytes,loraAdapters }); const device=runtime.hardware ? await runtime.hardware(settings) : await hardware(); return chooseMemoryPlan({ ...model,...metadata },{ ...settings,projectorBytes,loraAdapters },device); });
      if (route==='/api/model/benchmark/cancel' && method==='POST') return post(async()=>{if(!benchmarkController)throw new Error('No model benchmark is running.');benchmarkController.abort(new Error('Benchmark cancelled.'));return {stopping:true};});
      if (route==='/api/model/benchmark' && method==='POST') return post(async()=>{idle();if(modelOperation() || trainer.child || modelConverter.active)throw new Error('Wait for the active model operation to finish.');if(runtime.status!=='ready' || runtime.remote || !runtime.model)throw new Error('Load a local model before benchmarking.');const modelPath=runtime.model.path;const controller=new AbortController();benchmarkController=controller;runtime.busy=true;
        const disconnected=()=>{if(!res.writableEnded)controller.abort(new Error('Benchmark cancelled.'));};res.once('close',disconnected);
        benchmarkTask=(async()=>{try{const result=await benchmarkModel(runtime,{signal:controller.signal});const device=runtime.hardware ? await runtime.hardware(store.state.settings) : await hardware();controller.signal.throwIfAborted();result.hardware={cpu:device.cpu || null,reportedGpu:device.gpu?.name || null,unifiedMemory:Boolean(device.unifiedMemory)};store.state.modelBenchmarks ||= {};store.state.modelBenchmarks[modelPath]=result;const entries=Object.entries(store.state.modelBenchmarks).sort((a,b)=>b[1].measuredAt-a[1].measuredAt);store.state.modelBenchmarks=Object.fromEntries(entries.slice(0,100));await store.save({sessionIds:[]});return result;}finally{runtime.busy=false;benchmarkController=null;res.off('close',disconnected);}})();try{return await benchmarkTask;}finally{benchmarkTask=null;}});
      if (route==='/api/model/defaults' && method==='POST') return post(async input => { if (!(await models()).models.some(m => m.path===input.path)) throw new Error('Model not found.'); const settings=validateSettings(input.settings,store.state.settings); const keys=['contextSize','executionMode','gpuLayers','autoGpuLayers','threads','temperature','maxTokens','batchSize','microBatchSize','kvOnGpu','thinking','topP','topK','minP','repeatPenalty','seed','projectorPath','imageTokens','loadStrategy','chatTemplate']; store.state.modelDefaults[input.path]=Object.fromEntries(keys.filter(k => settings[k]!==undefined).map(k => [k,settings[k]])); await store.save(); return { saved:true }; });
      if (route==='/api/session' && method==='GET') { json(res,200,await findSession(url.searchParams.get('id'))); return true; }
      if (route==='/api/session/select' && method==='POST') return post(async input => { const workspaceId=input.workspaceId || store.state.selection.workspaceId || store.state.workspaces[0]?.id; workspaceById(workspaceId); const s=input.sessionId ? await findSession(input.sessionId) : null; const view=input.view || (s ? conversationKind(s) : 'workspace'); if (!['chat','workspace'].includes(view)) throw new Error('Choose Chat or Workspace.'); if (s && conversationKind(s)!==view) throw new Error('Chat and Workspace sessions stay in their own tabs.'); if (s && view==='workspace' && s.workspaceId!==workspaceId) throw new Error('Session belongs to another project.'); store.state.selection={ ...store.state.selection,workspaceId,sessionId:input.sessionId || null,view,[`${view}SessionId`]:input.sessionId || null }; await store.save(); return store.state.selection; });
      if (route==='/api/session/update' && method==='POST') return post(async input => { if(input.title!==undefined || input.archived!==undefined || input.memory!==undefined)idle(); if(input.pinned!==undefined && typeof input.pinned!=='boolean')throw new Error('Invalid pinned state.'); const s=await findSession(input.id); if (typeof input.title==='string' && input.title.trim()) s.title=input.title.trim().slice(0,100); if (typeof input.archived==='boolean') s.archived=input.archived; if(typeof input.pinned==='boolean')s.pinned=input.pinned; if (typeof input.memory==='string' && input.memory.length<=12000) s.memory=input.memory; s.updated=Date.now(); await store.save(); return s; });
      if (route==='/api/session/fork' && method==='POST') return post(async input => { idle(); const source=await findSession(input.id); const s={ ...structuredClone(source),id:randomUUID(),title:`${source.title} (fork)`,parentId:source.id,renameForkPending:store.state.settings.renameAfterFork,archived:false,created:Date.now(),updated:Date.now() }; store.state.sessions.unshift(s); await store.save(); return s; });
      if (route==='/api/session/branch-at' && method==='POST') return post(async input => { idle(); const source=await findSession(input.id); if(source.recoveryError) throw new Error('Recover this chat before branching.'); const index=source.messages.findIndex(m=>m.id===input.messageId && m.role==='user'); if(index<0) throw new Error('Message not found.'); const original=structuredClone(source.messages[index]); const s={...structuredClone(source),id:randomUUID(),title:`${source.title} (copy)`,messages:structuredClone(source.messages.slice(0,index)),parentId:source.id,renameForkPending:false,archived:false,created:Date.now(),updated:Date.now()}; store.state.sessions.unshift(s); await store.save(); return {session:s,message:original}; });
      if (route==='/api/session/export' && method==='GET') {
        const s=await findSession(url.searchParams.get('id')); const markdown=url.searchParams.get('format')==='markdown';
        const content=markdown ? `# ${s.title}\n\n`+s.messages.map(m => `## ${m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Forge' : `Tool: ${m.name || ''}`}\n\n${m.content || ''}`).join('\n\n') : JSON.stringify({ format:'forge-chat',version:1,session:s },null,2);
        json(res,200,{ filename:`${s.title.replace(/[^a-zA-Z0-9_-]/g,'_')}.${markdown ? 'md' : 'json'}`,content }); return true;
      }
      if (route==='/api/session/import' && method==='POST') return post(async input => { idle(); const source=input.document?.session; if (input.document?.format!=='forge-chat' || !source || !Array.isArray(source.messages) || source.messages.length>5000) throw new Error('Choose a Forge chat JSON export.'); const kind=conversationKind(source); if (kind==='workspace') workspaceById(input.workspaceId); for (const m of source.messages) { if (!m || !['user','assistant','tool'].includes(m.role) || typeof m.content!=='string') throw new Error('Invalid chat message.'); if (kind==='chat' && (m.role==='tool' || m.tool_calls)) throw new Error('Import tool history as a Workspace session.'); if (m.images!==undefined) { m.images=validateImages(m.images); await store.prepareImages(m.images); } if(m.documents!==undefined) m.documents=validateDocuments(m.documents); if(m.sources!==undefined) m.sources=validateSources(m.sources); } const s={ id:randomUUID(),kind,systemPrompt:validateSessionPrompt(source.systemPrompt),workspaceId:kind==='workspace' ? input.workspaceId : null,title:String(source.title || 'Imported session').slice(0,100),messages:source.messages,memory:typeof source.memory==='string' ? source.memory.slice(0,12000) : '',created:Date.now(),updated:Date.now() }; store.state.sessions.unshift(s); await store.save(); return s; });
      if (route==='/api/storage/chats' && method==='POST') return post(async input => { idle(); return { directory:await store.moveChats(input.path) }; });
      if (route==='/api/skills' && method==='POST') return post(async input => { idle(); if (input.remove) await skills.remove(input.id); else await skills.save(input); return store.state.skills; });
      if (route==='/api/skills/import-folder' && method==='POST') return post(async input => { idle(); return skills.importFolder(input.path); });
      if (route==='/api/skills/scan' && method==='POST') return post(async () => { idle(); return skills.scan(); });
      if (route==='/api/mcp/save' && method==='POST') return post(async input => { idle(); if (!input.name?.trim() || !['stdio','http'].includes(input.transport)) throw new Error('Provide an MCP name and transport.'); const config={ id:input.id || randomUUID(),name:input.name.trim().slice(0,80),transport:input.transport }; if (input.transport==='stdio') { if (typeof input.command!=='string' || !input.command.trim() || !Array.isArray(input.args) || input.args.some(a => typeof a!=='string')) throw new Error('Specify a command and a JSON array of arguments.'); Object.assign(config,{ command:input.command,args:input.args }); } else { const u=new URL(input.url); if (!['http:','https:'].includes(u.protocol)) throw new Error('Use HTTP(S).'); Object.assign(config,{ url:u.href,key:typeof input.key==='string' ? input.key : '' }); } const old=store.state.mcpServers.find(s => s.id===config.id); if (old) Object.assign(old,config); else store.state.mcpServers.push(config); await store.save(); return mcp.snapshot(store.state.mcpServers); });
      if (route==='/api/mcp/control' && method==='POST') return post(async input => { idle(); const config=store.state.mcpServers.find(s => s.id===input.id); if (!config) throw new Error('MCP server not found.'); if (input.action==='connect') await mcp.connect(config); else if (['disconnect','remove'].includes(input.action)) { await mcp.disconnect(input.id); if (input.action==='remove') { store.state.mcpServers=store.state.mcpServers.filter(c => c.id!==input.id); await store.save(); } } else throw new Error('Unknown MCP action.'); return mcp.snapshot(store.state.mcpServers); });
      if (route==='/api/connections' && method==='POST') return post(async input => { idle(); if (input.remove) store.state.connections=store.state.connections.filter(c => c.id!==input.id); else { if (!input.name?.trim()) throw new Error('Provide a device name.'); const c={ id:input.id || randomUUID(),name:input.name.trim().slice(0,80),base:endpoint(input.base),key:typeof input.key==='string' ? input.key : '' }; const old=store.state.connections.find(c => c.id===input.id); if (old) Object.assign(old,c); else store.state.connections.push(c); } await store.save(); return store.state.connections.map(publicConnection); });
      if (route==='/api/connections/models' && method==='POST') return post(async input => { const c=store.state.connections.find(c => c.id===input.id); if (!c) throw new Error('Device not found.'); return remoteModels(c); });
      if (route==='/api/connections/use' && method==='POST') return post(async input => { idle(); if (trainer.child) throw new Error('Stop training before connecting a model.'); const c=store.state.connections.find(c => c.id===input.id); if (!c || !(await remoteModels(c)).some(m => m.id===input.model)) throw new Error('Choose an available device model.'); return runtime.useRemote(c,input.model); });
      if (route==='/api/hub/search' && method==='GET') { json(res,200,await searchModels(url.searchParams.get('q') || '')); return true; }
      if (route==='/api/hub/files' && method==='GET') { const files=await modelFiles(url.searchParams.get('repo'));const device=await hardware();json(res,200,files.map(file=>({...file,cpuEstimate:estimateDownload(file,store.state.settings,device)}))); return true; }
      if (route==='/api/downloads' && method==='GET') { json(res,200,downloads.snapshot()); return true; }
      if (route==='/api/downloads/start' && method==='POST') return post(async input => downloads.create(input.repo,input.file));
      if (route==='/api/downloads/control' && method==='POST') return post(async input => downloads.control(input.id,input.action));
      if (route==='/api/local-api' && method==='GET') { json(res,200,localApi.snapshot()); return true; }
      if (route==='/api/local-api/key' && method==='GET') { json(res,200,{ key:store.state.apiKey }); return true; }
      if (route==='/api/local-api/control' && method==='POST') return post(async input => { if (input.action==='start') return localApi.start(store.state.settings.apiHost,store.state.settings.apiPort); if (input.action==='stop') { await localApi.stop(); return localApi.snapshot(); } throw new Error('Unknown API action.'); });
      if (route==='/api/trainer' && method==='GET') { json(res,200,{ ...trainer.snapshot(),loras:adapters.snapshot() }); return true; }
      if (route==='/api/trainer/environment' && method==='GET') { json(res,200,await trainingEnvironment(store.dataDir)); return true; }
      if (route==='/api/trainer/prepare' && method==='POST') return post(async input => prepareDataset(input.path,store.dataDir,{selectedSpeaker:input.selectedSpeaker}));
      if (route==='/api/trainer/install' && method==='POST') return post(async () => trainer.install());
      if (route==='/api/trainer/start' && method==='POST') return post(async input => trainer.start(input));
      if (route==='/api/trainer/control' && method==='POST') return post(async input => trainer.control(input.action));
      if (route==='/api/adapters' && method==='GET') { json(res,200,adapters.snapshot()); return true; }
      if (route==='/api/adapters/compare/cancel' && method==='POST') return post(async()=>{if(!comparisonController)throw new Error('No comparison is running.');comparisonController.abort(new Error('Comparison cancelled.'));return {stopping:true};});
      if (route==='/api/adapters/compare' && method==='POST') return post(async input=>{
        idle();if(runtime.status!=='ready' || runtime.remote || !runtime.loadedAdapters?.some(a=>a.scale>0))throw new Error('Load a local model with an active adapter first.');
        if(!Array.isArray(input.prompts) || !input.prompts.length || input.prompts.length>3 || input.prompts.some(p=>typeof p!=='string' || !p.trim() || p.length>2000))throw new Error('Enter one to three prompts, each under 2,000 characters.');
        const selected=runtime.loadedAdapters.map(({id,scale})=>({id,scale}));const controller=new AbortController();comparisonController=controller;runtime.busy=true;
        const disconnected=()=>{if(!res.writableEnded)controller.abort(new Error('Comparison cancelled.'));};res.once('close',disconnected);
        comparisonTask=(async()=>{const replies=[];let failure;
          try{for(const prompt of input.prompts){const record={prompt:prompt.trim()};for(const [key,stack] of [['base',[]],['adapted',selected]]){controller.signal.throwIfAborted();await runtime.applyAdapterStack(stack,{allowBusy:true});const response=await runtime.completion({messages:[{role:'user',content:record.prompt}],temperature:0,max_tokens:256,stream:false},controller.signal);const data=await response.json();record[key]=data.choices?.[0]?.message?.content || ''; }replies.push(record);}}
          catch(error){failure=error;}
          finally{try{await runtime.applyAdapterStack(selected,{allowBusy:true});}catch(error){failure=new Error(`Could not restore the adapter stack. Reload the model. ${error.message}`);}runtime.busy=false;comparisonController=null;res.off('close',disconnected);}
          if(failure)throw failure;return {replies};
        })();
        try{return await comparisonTask;}finally{comparisonTask=null;}
      });
      if (route==='/api/adapters/rename' && method==='POST') return post(async input => { if (converter.tasks.has(input.id)) throw new Error('Wait for conversion before renaming.'); return adapters.rename(input.id,input.name); });
      if (route==='/api/adapters/remove' && method==='POST') return post(async input => { idle(); if (converter.tasks.has(input.id)) await converter.cancel(input.id); const result=await adapters.remove(input.id); if (runtime.status==='ready' && !runtime.remote) await runtime.applyAdapterStack(store.state.loraStack.filter(item => runtime.loadedAdapters?.some(a => a.id===item.id))); return result; });
      if (route==='/api/adapters/import' && method==='POST') return post(async input => { idle(); const base=(await models()).models.find(m => m.path===input.baseGguf); if (!base) throw new Error('Select a GGUF base from your model library. It must be the exact base weights the adapter was trained for.'); return adapters.importGguf(input.path,input.name,base.path); });
      if (route==='/api/adapters/stack' && method==='POST') return post(async input => { idle(); if (['loading','stopping'].includes(runtime.status)) throw new Error('Wait for loading to finish.'); await adapters.stack(input.items); const relevant=runtime.model ? input.items.filter(i => store.state.adapters.find(a => a.id===i.id)?.baseGguf===runtime.model.path) : input.items; return { items:input.items,...await runtime.applyAdapterStack(relevant) }; });
      if (route==='/api/adapters/convert' && method==='POST') return post(async input => { idle(); const base=(await models()).models.find(m => m.path===input.baseGguf); if (!base) throw new Error('Select the exact GGUF base from your library.'); return converter.start(input.id,base.path); });
      if (route==='/api/adapters/cancel-convert' && method==='POST') return post(async input => converter.cancel(input.id));
      if (route==='/api/voice/install' && method==='POST') return post(async () => { if (voiceInstalling) throw new Error('Voice installation is already running.'); voiceInstalling=true; try { const result=await installVoice({ directory:path.join(store.dataDir,'voice-runtime') }); store.state.settings.voiceRuntimePath=result.executable; store.state.settings.voiceModelPath=result.model; await store.save(); return result; } finally { voiceInstalling=false; } });
      if (route==='/api/voice/transcribe' && method==='POST') {
        const input=await body(req,12*1024**2); const controller=new AbortController(); voiceControllers.add(controller);
        const disconnect=() => { if (!res.writableEnded) controller.abort(); }; res.once('close',disconnect);
        try { json(res,200,await transcribe(store.state.settings,store.dataDir,input.wav,controller.signal)); } finally { voiceControllers.delete(controller); res.off('close',disconnect); }
        return true;
      }
      if (route==='/api/diagnostics' && method==='GET') { json(res,200,await diagnostics({runtime,hardware,store,trainer})); return true; }
      return false;
    },
    async close() { for (const c of voiceControllers) c.abort();comparisonController?.abort(new Error('Forge is closing.'));benchmarkController?.abort(new Error('Forge is closing.')); await Promise.allSettled([mcp.close(),downloads.close(),localApi.stop(),trainer.close(),converter.close(),modelConverter.close(),knowledge.close(),comparisonTask,benchmarkTask]); }
  };
}
