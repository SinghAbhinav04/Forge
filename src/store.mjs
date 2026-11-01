import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';

const defaults = root => ({ modelDir: path.resolve(root, '../models'), runtimePath: '', contextSize: 2048, gpuLayers: 8, threads: Math.max(1, Math.min(2, os.availableParallelism() - 2)), temperature: 0.7, maxTokens: 768, systemPrompt: 'You are a helpful local assistant. Be clear, accurate, and honest about limitations.', executionMode:'hybrid', performanceMode:'responsive', batchSize:128, microBatchSize:64, reserveRamGiB:2, kvOnGpu:false, theme:'dark', fontSize:13, enterToSend:true, restoreSession:true, renameAfterFork:true, maxAgentSteps:12, allowReadTools:true, allowWriteTools:true, showReasoning:true, thinking:'auto', runInBackground:true, voiceRuntimePath:'', voiceModelPath:'', voiceLanguage:'en', apiHost:'127.0.0.1', apiPort:12345 });
export const sessionSummary = s => { const { messages, ...meta } = s; return { ...meta, messageCount: messages?.length || 0 }; };
const digest = text => createHash('sha256').update(text).digest('hex');
async function atomic(file, text) { const temp = `${file}.${randomUUID()}.tmp`; try { await fs.writeFile(temp, text, { encoding:'utf8', mode:0o600 }); await fs.rename(temp, file); } finally { await fs.rm(temp, { force:true }); } }
export async function openStore(appRoot, dataDir = path.join(appRoot, '.data'), workspaceDir, defaultModelDir) {
  await fs.mkdir(dataDir, { recursive:true }); const file = path.join(dataDir, 'state.json'); let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read saved workspace data: ${error.message}`);
    const workspace = workspaceDir || path.join(appRoot, 'workspace'); await fs.mkdir(workspace, { recursive:true });
    if (workspaceDir) { try { await fs.copyFile(path.join(appRoot,'workspace','Welcome.md'), path.join(workspace,'Welcome.md'), (await import('node:fs')).constants.COPYFILE_EXCL); } catch (e) { if (!['EEXIST','ENOENT'].includes(e.code)) throw e; } }
    state = { version:2, settings:{ ...defaults(appRoot), ...(defaultModelDir ? { modelDir:defaultModelDir } : {}) }, workspaces:[{ id:randomUUID(), name:'My workspace', path:workspace }], sessions:[] };
  }
  const old = state.settings || {}; state.settings = { ...defaults(appRoot), ...old };
  if (!old.performanceMode) { state.settings.threads = Math.min(2,state.settings.threads); state.settings.kvOnGpu = false; state.settings.executionMode = old.gpuLayers > 0 ? 'hybrid' : 'cpu'; }
  state.settings.sessionDir ||= path.join(dataDir,'sessions','chats');
  state.usage ||= []; state.skills ||= []; state.mcpServers ||= []; state.connections ||= []; state.modelDefaults ||= {}; state.selection ||= {};
  const sourceVersion = state.version; state.version = 2; await fs.mkdir(state.settings.sessionDir, { recursive:true });
  const warnings = [];
  if (sourceVersion === 2) {
    const loaded = [];
    for (const meta of state.sessions || []) {
      if (!/^[a-zA-Z0-9_-]+$/.test(meta.id)) continue;
      try { const s = JSON.parse(await fs.readFile(path.join(state.settings.sessionDir,`${meta.id}.json`),'utf8')); if (s.id !== meta.id || !Array.isArray(s.messages)) throw new Error('Invalid chat file'); loaded.push(s); }
      catch (error) { warnings.push(`Could not open chat ${meta.id}: ${error.message}`); loaded.push({ ...meta, messages:[], recoveryError:error.message }); }
    }
    state.sessions = loaded;
  }
  const revisions = new Map(); let queue = Promise.resolve();
  const save = () => {
    const chatDir = state.settings.sessionDir;
    const chats = state.sessions.filter(s => !s.recoveryError).map(s => ({ id:s.id, json:JSON.stringify(s,null,2) }));
    const snapshot = JSON.stringify({ ...state, sessions:state.sessions.map(sessionSummary) },null,2);
    const task = queue.catch(() => {}).then(async () => {
      await fs.mkdir(chatDir,{ recursive:true });
      for (const chat of chats) { if (!/^[a-zA-Z0-9_-]+$/.test(chat.id)) throw new Error('Invalid session ID.'); const revision = digest(chat.json); const key = path.join(chatDir,`${chat.id}.json`); if (revisions.get(key) !== revision) { await atomic(key,chat.json); revisions.set(key,revision); } }
      await atomic(file,snapshot);
    }); queue = task; return task;
  };
  await save();
  return { state, save, dataDir, warnings,
    async moveChats(directory) {
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Choose an absolute chat folder.');
      await queue.catch(() => {}); await fs.mkdir(directory,{ recursive:true }); const previous = state.settings.sessionDir;
      for (const s of state.sessions) { try { const existing = JSON.parse(await fs.readFile(path.join(directory,`${s.id}.json`),'utf8')); if (JSON.stringify(existing) !== JSON.stringify(s)) throw new Error(`Destination already contains a different chat: ${s.id}`); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      state.settings.sessionDir = directory; try { await save(); } catch (error) { state.settings.sessionDir = previous; throw error; } return directory;
    },
    async deleteSession(id) { await queue.catch(() => {}); state.sessions = state.sessions.filter(s => s.id !== id); await save(); await fs.rm(path.join(state.settings.sessionDir,`${id}.json`),{ force:true }); }
  };
}
