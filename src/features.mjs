import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpManager,endpoint,remoteModels } from './integrations.mjs';
import { Downloads,searchModels,modelFiles } from './hub.mjs';
import { LocalApi } from './local-api.mjs';
import { Trainer,trainingEnvironment } from './trainer.mjs';
import { transcribe } from './voice.mjs';
import { hardware,ggufMetadata,memoryPlan } from './hardware.mjs';
import { validateSettings } from './settings.mjs';
import { installVoice } from '../scripts/install-voice.mjs';
import { SkillLibrary } from './skills.mjs';
import { prepareDataset } from './datasets.mjs';
import { AdapterLibrary } from './adapters.mjs';
import { AdapterConverter } from './converter.mjs';
import { validateImages } from './images.mjs';
const publicConnection=({ key,...c }) => ({ ...c,hasKey:Boolean(key) });
export function createFeatures({ appRoot,store,runtime,agent,models,workspaceById }) {
  const mcp=new McpManager(); const downloads=new Downloads(store); const localApi=new LocalApi(runtime,store); const trainer=new Trainer(appRoot,store,runtime); agent.mcp=mcp;
  const skills=new SkillLibrary(store); agent.skillLibrary=skills;
  const adapters=new AdapterLibrary(store); trainer.adapterLibrary=adapters;
  const converter=new AdapterConverter(store,adapters);
  const voiceControllers=new Set();
  let voiceInstalling=false;
  const idle=() => { if (agent.active || runtime.busy) throw new Error('Stop the active task first.'); };
  const findSession=id => { const s=store.state.sessions.find(s => s.id===id); if (!s) throw new Error('Session not found.'); return s; };
  return {
    mcp,downloads,localApi,trainer,skills,adapters,
    async initialize() { await skills.initialize(); await skills.scan(); if (trainer.job?.status==='completed' && !store.state.adapters.some(a => a.sourceJobId===trainer.job.id)) { try { await adapters.registerJob(trainer.job); } catch (error) { trainer.job.error=`Adapter recovery: ${error.message}`; await store.save(); } } },
    snapshot() { return { mcp:mcp.snapshot(store.state.mcpServers),connections:store.state.connections.map(publicConnection),downloads:downloads.snapshot(),localApi:localApi.snapshot(),trainer:trainer.snapshot(),loras:adapters.snapshot(),storage:{ dataDir:store.dataDir,sessionDir:store.state.settings.sessionDir,skillsDir:skills.directory,trainedDir:adapters.directory },storageWarnings:store.warnings }; },
    async route(req,res,url,{ json,body }) {
      const route=url.pathname; const method=req.method;
      const post=async handler => { json(res,200,await handler(await body(req,route==='/api/session/import' ? 32*1024**2 : undefined))); return true; };
      if (route==='/api/hardware' && method==='GET') { json(res,200,await hardware()); return true; }
      if (route==='/api/runtime/builds' && method==='GET') { json(res,200,await runtime.installed()); return true; }
      if (route==='/api/runtime/activate' && method==='POST') return post(async input => { idle(); if (['loading','ready','stopping'].includes(runtime.status)) throw new Error('Unload the model before changing runtime builds.'); const build=(await runtime.installed()).find(b => b.executable===input.executable); if (!build) throw new Error('Choose an installed runtime.'); store.state.settings.runtimePath=build.executable; await store.save(); return build; });
      if (route==='/api/model/plan' && method==='POST') return post(async input => { const model=(await models()).models.find(m => m.path===input.path); if (!model) throw new Error('Model not found.'); const metadata=await ggufMetadata(model.path); const settings=validateSettings({ ...store.state.modelDefaults[model.path],...input.settings },store.state.settings); return memoryPlan({ ...model,...metadata },settings,await hardware()); });
      if (route==='/api/model/defaults' && method==='POST') return post(async input => { if (!(await models()).models.some(m => m.path===input.path)) throw new Error('Model not found.'); const settings=validateSettings(input.settings,store.state.settings); const keys=['contextSize','executionMode','gpuLayers','threads','temperature','maxTokens','batchSize','microBatchSize','kvOnGpu','thinking','topP','topK','minP','repeatPenalty','seed','projectorPath','imageTokens','loadStrategy','chatTemplate']; store.state.modelDefaults[input.path]=Object.fromEntries(keys.filter(k => settings[k]!==undefined).map(k => [k,settings[k]])); await store.save(); return { saved:true }; });
      if (route==='/api/session' && method==='GET') { json(res,200,findSession(url.searchParams.get('id'))); return true; }
      if (route==='/api/session/select' && method==='POST') return post(async input => { workspaceById(input.workspaceId); if (input.sessionId) { const s=findSession(input.sessionId); if (s.workspaceId!==input.workspaceId) throw new Error('Session belongs to another project.'); } store.state.selection={ workspaceId:input.workspaceId,sessionId:input.sessionId || null }; await store.save(); return store.state.selection; });
      if (route==='/api/session/update' && method==='POST') return post(async input => { idle(); const s=findSession(input.id); if (typeof input.title==='string' && input.title.trim()) s.title=input.title.trim().slice(0,100); if (typeof input.archived==='boolean') s.archived=input.archived; if (typeof input.memory==='string' && input.memory.length<=12000) s.memory=input.memory; s.updated=Date.now(); await store.save(); return s; });
      if (route==='/api/session/fork' && method==='POST') return post(async input => { idle(); const source=findSession(input.id); const s={ ...structuredClone(source),id:randomUUID(),title:`${source.title} (fork)`,parentId:source.id,renameForkPending:store.state.settings.renameAfterFork,archived:false,created:Date.now(),updated:Date.now() }; store.state.sessions.unshift(s); await store.save(); return s; });
      if (route==='/api/session/export' && method==='GET') {
        const s=findSession(url.searchParams.get('id')); const markdown=url.searchParams.get('format')==='markdown';
        const content=markdown ? `# ${s.title}\n\n`+s.messages.map(m => `## ${m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Forge' : `Tool: ${m.name || ''}`}\n\n${m.content || ''}`).join('\n\n') : JSON.stringify({ format:'forge-chat',version:1,session:s },null,2);
        json(res,200,{ filename:`${s.title.replace(/[^a-zA-Z0-9_-]/g,'_')}.${markdown ? 'md' : 'json'}`,content }); return true;
      }
      if (route==='/api/session/import' && method==='POST') return post(async input => { idle(); workspaceById(input.workspaceId); const source=input.document?.session; if (input.document?.format!=='forge-chat' || !source || !Array.isArray(source.messages) || source.messages.length>5000) throw new Error('Choose a Forge chat JSON export.'); for (const m of source.messages) { if (!m || !['user','assistant','tool'].includes(m.role) || typeof m.content!=='string') throw new Error('Invalid chat message.'); if (m.images!==undefined) m.images=validateImages(m.images); } const s={ id:randomUUID(),workspaceId:input.workspaceId,title:String(source.title || 'Imported session').slice(0,100),messages:source.messages,memory:typeof source.memory==='string' ? source.memory.slice(0,12000) : '',created:Date.now(),updated:Date.now() }; store.state.sessions.unshift(s); await store.save(); return s; });
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
      if (route==='/api/hub/files' && method==='GET') { json(res,200,await modelFiles(url.searchParams.get('repo'))); return true; }
      if (route==='/api/downloads' && method==='GET') { json(res,200,downloads.snapshot()); return true; }
      if (route==='/api/downloads/start' && method==='POST') return post(async input => downloads.create(input.repo,input.file));
      if (route==='/api/downloads/control' && method==='POST') return post(async input => downloads.control(input.id,input.action));
      if (route==='/api/local-api' && method==='GET') { json(res,200,localApi.snapshot()); return true; }
      if (route==='/api/local-api/key' && method==='GET') { json(res,200,{ key:store.state.apiKey }); return true; }
      if (route==='/api/local-api/control' && method==='POST') return post(async input => { if (input.action==='start') return localApi.start(store.state.settings.apiHost,store.state.settings.apiPort); if (input.action==='stop') { await localApi.stop(); return localApi.snapshot(); } throw new Error('Unknown API action.'); });
      if (route==='/api/trainer' && method==='GET') { json(res,200,{ ...trainer.snapshot(),loras:adapters.snapshot() }); return true; }
      if (route==='/api/trainer/environment' && method==='GET') { json(res,200,await trainingEnvironment(store.dataDir)); return true; }
      if (route==='/api/trainer/prepare' && method==='POST') return post(async input => prepareDataset(input.path,store.dataDir));
      if (route==='/api/trainer/install' && method==='POST') return post(async () => trainer.install());
      if (route==='/api/trainer/start' && method==='POST') return post(async input => trainer.start(input));
      if (route==='/api/trainer/control' && method==='POST') return post(async input => trainer.control(input.action));
      if (route==='/api/adapters' && method==='GET') { json(res,200,adapters.snapshot()); return true; }
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
      if (route==='/api/diagnostics' && method==='GET') { json(res,200,{ app:'Forge',version:'0.2.0',node:process.versions.node,platform:process.platform,hardware:await hardware(),runtime:runtime.snapshot(),storage:{ dataDir:store.dataDir,sessionDir:store.state.settings.sessionDir },mcp:mcp.snapshot(store.state.mcpServers),localApi:localApi.snapshot(),trainer:trainer.snapshot() }); return true; }
      return false;
    },
    async close() { for (const c of voiceControllers) c.abort(); await Promise.allSettled([mcp.close(),downloads.close(),localApi.stop(),trainer.close(),converter.close()]); }
  };
}
