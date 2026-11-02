import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import { atomicJson as atomic,readJson } from './storage.mjs';
import { DEFAULT_CHAT_PROMPT,conversationKind } from './conversations.mjs';
import { THEMES,normalizeTheme } from '../public/themes.js';
import { prepareImages,hydrateSessionImages,serializeSession } from './attachments.mjs';

const defaults = root => ({ modelDir: path.resolve(root, '../models'), runtimePath: '', contextSize: 2048, gpuLayers: 8, threads: Math.max(1, Math.min(2, os.availableParallelism() - 2)), temperature: 0.7, maxTokens: 768, systemPrompt: 'You are a helpful local assistant. Be clear, accurate, and honest about limitations.', executionMode:'auto', performanceMode:'responsive', batchSize:128, microBatchSize:64, reserveRamGiB:2, kvOnGpu:false, theme:'dark', fontSize:13, enterToSend:true, restoreSession:true, renameAfterFork:true, maxAgentSteps:12, allowReadTools:true, allowWriteTools:true, showReasoning:true, thinking:'auto', runInBackground:true, voiceRuntimePath:'', voiceModelPath:'', voiceLanguage:'en', apiHost:'127.0.0.1', apiPort:12345 });
export const sessionSummary = s => { const { messages, ...meta } = s; return { ...meta, messageCount: messages?.length ?? s.messageCount ?? 0 }; };
const digest = text => createHash('sha256').update(text).digest('hex');
export async function openStore(appRoot, dataDir = path.join(appRoot, '.data'), workspaceDir, defaultModelDir, options={}) {
  await fs.mkdir(dataDir, { recursive:true }); const file = path.join(dataDir, 'state.json'); let state;
  const warnings=[]; const recovered=file => warnings.push(`Recovered saved data from its completed recovery copy: ${file}. The damaged original was preserved.`);
  try { state = await readJson(file,recovered); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read saved workspace data: ${error.message}`);
    const workspace = workspaceDir || path.join(appRoot, 'workspace'); await fs.mkdir(workspace, { recursive:true });
    if (defaultModelDir) await fs.mkdir(defaultModelDir,{ recursive:true });
    if (workspaceDir) { try { await fs.copyFile(path.join(appRoot,'workspace','Welcome.md'), path.join(workspace,'Welcome.md'), (await import('node:fs')).constants.COPYFILE_EXCL); } catch (e) { if (!['EEXIST','ENOENT'].includes(e.code)) throw e; } }
    state = { version:2, settings:{ ...defaults(appRoot), ...(defaultModelDir ? { modelDir:defaultModelDir } : {}) }, workspaces:[{ id:randomUUID(), name:'My workspace', path:workspace }], sessions:[] };
  }
  const old = state.settings || {}; state.settings = { autoGpuLayers:true,chatSystemPrompt:DEFAULT_CHAT_PROMPT,...defaults(appRoot), ...old };
  state.settings.theme=normalizeTheme(state.settings.theme);
  if (!old.themeStyleVersion) { state.settings.fontSize=THEMES.find(theme => theme.id===state.settings.theme).fontSize; state.settings.themeStyleVersion=1; }
  if (!old.performanceMode) { state.settings.threads = Math.min(2,state.settings.threads); state.settings.kvOnGpu = false; state.settings.executionMode = old.gpuLayers > 0 ? 'hybrid' : 'cpu'; }
  state.settings.sessionDir ||= path.join(dataDir,'sessions','chats');
  state.usage ||= []; state.skills ||= []; state.mcpServers ||= []; state.connections ||= []; state.modelDefaults ||= {}; state.selection ||= {}; state.drafts ||= {};
  const legacyDrafts=state.drafts;const draftsDir=path.join(dataDir,'drafts');await fs.mkdir(draftsDir,{recursive:true});
  for(const [key,draft] of Object.entries(legacyDrafts)){const destination=path.join(draftsDir,`${encodeURIComponent(key)}.json`);try{await readJson(destination);}catch(error){if(error.code!=='ENOENT' && !(error instanceof SyntaxError))throw error;await atomic(destination,JSON.stringify(draft));}}
  state.drafts={};
  for(const entry of await fs.readdir(draftsDir,{withFileTypes:true})){if(!entry.isFile() || !entry.name.endsWith('.json'))continue;try{const key=decodeURIComponent(entry.name.slice(0,-5));state.drafts[key]=await readJson(path.join(draftsDir,entry.name),recovered);}catch(error){warnings.push(`Could not open a saved draft: ${error.message}`);}}
  const sourceVersion = state.version; state.version = 2; await fs.mkdir(state.settings.sessionDir, { recursive:true });
  if (sourceVersion === 2 && !options.lazySessions) {
    const loaded = [];
    for (const meta of state.sessions || []) {
      if (!/^[a-zA-Z0-9_-]+$/.test(meta.id)) continue;
      try { const s = await readJson(path.join(state.settings.sessionDir,`${meta.id}.json`),recovered); if (s.id !== meta.id || !Array.isArray(s.messages)) throw new Error('Invalid chat file'); await hydrateSessionImages(dataDir,s);loaded.push(s); }
      catch (error) { warnings.push(`Could not open chat ${meta.id}: ${error.message}`); loaded.push({ ...meta, messages:[], recoveryError:error.message }); }
    }
    state.sessions = loaded;
  }
  for (const session of state.sessions || []) session.kind=conversationKind(session);
  const revisions = new Map(); let queue = Promise.resolve();
  const save = ({ sessionIds } = {}) => {
    const chatDir = state.settings.sessionDir;
    const selected=sessionIds ? new Set(sessionIds) : null;
    const chats = state.sessions.filter(s => Array.isArray(s.messages) && !s.recoveryError && (!selected || selected.has(s.id))).map(s => ({ id:s.id, json:serializeSession(s) }));
    const {drafts,...indexState}=state;
    const snapshot = JSON.stringify({ ...indexState, sessions:state.sessions.map(sessionSummary) },null,2);
    const task = queue.catch(() => {}).then(async () => {
      await fs.mkdir(chatDir,{ recursive:true });
      for (const chat of chats) { if (!/^[a-zA-Z0-9_-]+$/.test(chat.id)) throw new Error('Invalid session ID.'); const revision = digest(chat.json); const key = path.join(chatDir,`${chat.id}.json`); if (revisions.get(key) !== revision) { await atomic(key,chat.json); revisions.set(key,revision); } }
      await atomic(file,snapshot);
    }); queue = task; return task;
  };
  await save();
  const recent=new Map(),loading=new Map(); let store;let draftQueue=Promise.resolve();
  const readSession=async id=>{
    if(!/^[a-zA-Z0-9_-]+$/.test(id || '')) throw new Error('Invalid session ID.');
    const meta=state.sessions.find(s=>s.id===id); if(!meta) throw new Error('Session not found.');
    if(Array.isArray(meta.messages)) return meta;
    try { const value=await readJson(path.join(state.settings.sessionDir,`${id}.json`),recovered); if(value.id!==id || !Array.isArray(value.messages)) throw new Error('Invalid chat file'); return value; }
    catch(error) { warnings.push(`Could not open chat ${id}: ${error.message}`); return {...meta,messages:[],recoveryError:error.message}; }
  };
  const touchSession=id=>{recent.delete(id);recent.set(id,true);for(const candidate of recent.keys()){if(recent.size<=20)break;const item=state.sessions.find(s=>s.id===candidate);if(candidate===id || candidate===store?.protectedSession?.() || !item || item.recoveryError)continue;const saved=revisions.get(path.join(state.settings.sessionDir,`${candidate}.json`));if(!saved || saved!==digest(serializeSession(item)))continue;const position=state.sessions.indexOf(item);state.sessions[position]=sessionSummary(item);recent.delete(candidate);}};
  const loadSession=async id=>{
    const existing=state.sessions.find(s=>s.id===id); if(!existing) throw new Error('Session not found.');
    if(Array.isArray(existing.messages)) { touchSession(id);return existing; }
    if(loading.has(id))return loading.get(id);
    const pending=(async()=>{ await queue.catch(()=>{});let session=await readSession(id);const baseline=!session.recoveryError ? digest(serializeSession(session)) : null;
      if(!session.recoveryError)try{await hydrateSessionImages(dataDir,session);}catch(error){warnings.push(`Could not open chat ${id}: ${error.message}`);session={...sessionSummary(session),messages:[],recoveryError:error.message};}
      const index=state.sessions.findIndex(s=>s.id===id);if(index<0)throw new Error('Session not found.');if(Array.isArray(state.sessions[index].messages))return state.sessions[index];state.sessions[index]=session;
      if(!session.recoveryError)revisions.set(path.join(state.settings.sessionDir,`${id}.json`),baseline);
      touchSession(id);
      return session;
    })(); loading.set(id,pending);try{return await pending;}finally{loading.delete(id);}
  };
  store={ state, save, dataDir, warnings,loadSession,readSession,prepareImages:images=>prepareImages(dataDir,images),
    saveDraft(key,draft){const value=draft===null ? null : structuredClone(draft);const task=draftQueue.catch(()=>{}).then(async()=>{const file=path.join(draftsDir,`${encodeURIComponent(key)}.json`);if(value===null){await fs.rm(file,{force:true});await fs.rm(`${file}.recovery`,{force:true});delete state.drafts[key];}else{await atomic(file,JSON.stringify(value));state.drafts[key]=value;}});draftQueue=task;return task;},
    async flushDrafts(){await draftQueue;},
    async moveChats(directory) {
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Choose an absolute chat folder.');
      await queue.catch(() => {}); await fs.mkdir(directory,{ recursive:true }); const previous = state.settings.sessionDir;
      const copies=[]; for (const meta of state.sessions) { const s=await readSession(meta.id);if(s.recoveryError)throw new Error(`Recover chat ${meta.id} before moving storage.`);copies.push(s);try { const existing = JSON.parse(await fs.readFile(path.join(directory,`${s.id}.json`),'utf8')); if (serializeSession(existing) !== serializeSession(s)) throw new Error(`Destination already contains a different chat: ${s.id}`); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      for(const s of copies)await atomic(path.join(directory,`${s.id}.json`),serializeSession(s));
      state.settings.sessionDir = directory; try { await save(); } catch (error) { state.settings.sessionDir = previous; throw error; } return directory;
    },
    async deleteSession(id) { await queue.catch(() => {}); state.sessions = state.sessions.filter(s => s.id !== id); await save(); const file=path.join(state.settings.sessionDir,`${id}.json`); await fs.rm(file,{ force:true }); await fs.rm(`${file}.recovery`,{ force:true }); }
  };
  return store;
}
