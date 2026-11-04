import { initFeatures } from './features.js';
import { initHelp } from './help.js';
import { initJourney } from './journey.js';
import { initKnowledge } from './knowledge.js';
import { initProjectGit } from './project-git.js';
import { initProjectInstructions } from './project-instructions.js';
import { initWebSearch } from './web-search.js';
import { updateStreamText } from './stream-text.js';
import { initAttachmentMenu } from './attachment-menu.js';
import { chatReadiness } from './readiness.js';
const $ = id => document.getElementById(id);
const node = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
const token = location.hash.slice(1) || sessionStorage.getItem('local-desk-token') || '';
if (token) { sessionStorage.setItem('local-desk-token', token); history.replaceState(null, '', location.pathname); }
const state={ data:null,workspaceId:null,sessionId:null,view:'chat',scope:'chat',lastSessions:{chat:null,workspace:null},drafts:new Map(),sessionPrompt:null,navVersion:0,loadingSession:null,run:null,notices:new Map(),folder:'.',file:null,dirty:false,preview:false,sending:false,installing:false,filesVisible:innerWidth>=1000,images:[],documents:[] };
let searchMatches=null; let searchTicket=0; let searchTimer; let modelRenderKey=''; let historyLimit=100; let streamFrame=0; const streamUpdates=new Map(); let queuedMessage=null; let queueStarting=false; let queueAdding=false; let queuePaused=false;let benchmarkActive=false;
let fileRequest=0;
const welcome = $('welcome');
const setupHint = $('setup-hint');
const workspaceIntro=node('div'); while(welcome.firstChild) workspaceIntro.append(welcome.firstChild);
const chatIntro=node('div'); chatIntro.innerHTML='<div class="eyebrow"><span class="dot"></span> YOUR MODELS. YOUR CONVERSATION.</div><h1>What’s on<br><em>your mind?</em></h1><p>Ask a question, explore an idea, or just talk.<br>Your conversation stays on this computer.</p><div class="suggestions"><button data-prompt="Explain something interesting about the night sky."><span>✧</span><strong>Learn something</strong><small>Follow your curiosity ↗</small></button><button data-prompt="Help me brainstorm a creative weekend project."><span>✎</span><strong>Explore an idea</strong><small>Find a fresh perspective ↗</small></button><button data-prompt="Let’s have a casual conversation."><span>◌</span><strong>Just chat</strong><small>Start a conversation ↗</small></button></div>';
welcome.append(chatIntro,workspaceIntro,setupHint); $('mode').hidden=true;
const conversationType=node('span','conversation-type','Chat'); conversationType.id='conversation-type'; $('mode').before(conversationType);
const generationBanner=node('div','generation-banner');generationBanner.id='generation-banner';generationBanner.hidden=true;const generationLabel=node('span');const viewGeneration=node('button','text-button','View reply');viewGeneration.id='view-generating';const stopGeneration=node('button','text-button','Stop');stopGeneration.id='stop-generating';generationBanner.append(generationLabel,viewGeneration,stopGeneration);document.querySelector('.topbar').after(generationBanner);
const queueBanner=node('div','generation-banner');queueBanner.id='queue-banner';queueBanner.hidden=true;const queueLabel=node('span');const queueNow=node('button','text-button','Send queued');queueNow.type='button';const queueRemove=node('button','text-button','Remove');queueRemove.type='button';queueBanner.append(queueLabel,queueNow,queueRemove);generationBanner.after(queueBanner);
const queueButton=node('button','secondary-button','Queue message');queueButton.id='queue-message';queueButton.type='button';queueButton.hidden=true;$('send').before(queueButton);
const readiness=node('div','chat-readiness');readiness.id='chat-readiness';readiness.setAttribute('role','status');readiness.setAttribute('aria-live','polite');$('chat-form').before(readiness);let readinessKey='';
viewGeneration.onclick=()=>{const id=state.run?.current?.id||state.data?.active;if(id)selectSession(id).catch(fail);};stopGeneration.onclick=()=>$('stop-task').click();
let features; let journey; let projectGit; let projectInstructions;
let toastTimer;
function toast(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 12000 : 4500); }
function fail(error) { toast(error.message || String(error), true); }
async function api(route, { method = 'GET', body } = {}) {
  const response = await fetch(route, { method, headers: { 'X-Local-Desk-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) { let value; try { value = await response.json(); } catch { /* Fall back to status. */ } throw new Error(value?.error || `Request failed (${response.status}).`); }
  return response.json();
}
const project = () => state.data?.workspaces.find(w => w.id === state.workspaceId);
const session = () => state.run?.current?.id===state.sessionId ? state.run.current : state.data?.sessions.find(s => s.id === state.sessionId);
const kind = s => s?.kind==='chat' ? 'chat' : 'workspace';
const busy = () => state.sending || Boolean(state.data?.active) || Boolean(state.data?.runtime?.busy);
const generatingId=()=>state.run?.current?.id||state.data?.active;
const visibleRun=()=>Boolean(state.run?.current && state.run.current.id===state.sessionId && ['chat','workspace'].includes(state.view));
const draftKey=()=>state.sessionId || `new:${state.scope}:${state.scope==='workspace'?state.workspaceId:''}`;
const pendingDrafts=new Map(); let draftTimer; let draftQueue=Promise.resolve();
function queueDraft(key,draft){pendingDrafts.set(key,draft);clearTimeout(draftTimer);draftTimer=setTimeout(flushDrafts,300);}
function flushDrafts(){const pending=[...pendingDrafts];pendingDrafts.clear();draftQueue=draftQueue.then(async()=>{for(const [key,draft] of pending)try{await api('/api/drafts',{method:'POST',body:{key,draft}});}catch(error){if(!pendingDrafts.has(key))pendingDrafts.set(key,draft);toast(`Could not save draft: ${error.message}`,true);}});return draftQueue;}
function saveDraft(){const key=draftKey();const draft={text:$('prompt').value,images:state.images,documents:state.documents,systemPrompt:state.sessionPrompt};state.drafts.set(key,draft);if(state.data)queueDraft(key,draft);}
function deleteDraft(key){state.drafts.delete(key);if(state.data)queueDraft(key,null);}
function renderQueue(){queueBanner.hidden=!queuedMessage;if(!queuedMessage)return;const name=state.data?.sessions.find(s=>s.id===queuedMessage.sessionId)?.title || 'conversation';queueLabel.textContent=`${queuePaused?'Paused':'Queued'} for “${name}”: ${queuedMessage.text.slice(0,100)}`;queueNow.hidden=!queuePaused || busy() || state.data?.runtime.status!=='ready';queueRemove.disabled=queueStarting;}
queueRemove.onclick=async()=>{if(!queuedMessage)return;try{await api('/api/queue',{method:'POST',body:{clear:true,id:queuedMessage.id}});queuedMessage=null;queuePaused=false;renderQueue();renderRuntime();}catch(error){fail(error);}};
queueNow.onclick=()=>{queuePaused=false;void startQueue();};
async function startQueue(){if(queueStarting || queuePaused || !queuedMessage || busy() || state.data?.runtime.status!=='ready')return;queueStarting=true;renderQueue();const item=queuedMessage;try{await send({preventDefault(){}},item);}catch(error){queuePaused=true;fail(error);}finally{queueStarting=false;renderQueue();}}
queueButton.onclick=async()=>{if(queuedMessage || queueAdding || !busy())return;const ticket=state.navVersion,scope=state.scope,workspaceId=state.workspaceId,oldKey=draftKey(),text=$('prompt').value.trim() || (state.images.length ? 'Describe the attached image.' : state.documents.length ? 'Summarize the attached files.' : ''),images=state.images,documents=state.documents,systemPrompt=state.sessionPrompt;if(!text)return;queueAdding=true;queueButton.disabled=true;try{let current=session();if(!current){current=await api('/api/sessions',{method:'POST',body:{kind:scope,workspaceId:scope==='workspace'?workspaceId:null,systemPrompt}});state.data.sessions.unshift(current);if(ticket===state.navVersion){state.sessionId=current.id;await rememberSelection();}}const result=await api('/api/queue',{method:'POST',body:{sessionId:current.id,text,images,documents}});queuedMessage=result.message;queuePaused=false;if(ticket===state.navVersion && state.sessionId===current.id){if(oldKey!==current.id)deleteDraft(oldKey);$('prompt').value='';state.images=[];state.documents=[];saveDraft();features.renderImages();features.renderDocuments();}renderQueue();renderSidebar();renderRuntime();toast('Message queued. It will send after the current reply.');}catch(error){fail(error);}finally{queueAdding=false;renderRuntime();if(queuedMessage && !busy())setTimeout(()=>void startQueue(),0);}};
function loadDraft(){const d=state.drafts.get(draftKey());$('prompt').value=d?.text||'';state.images=d?.images||[];state.documents=d?.documents||[];state.sessionPrompt=d?d.systemPrompt:session()?.systemPrompt??null;features?.renderImages();features?.renderDocuments();}
const clean = () => !state.dirty || confirm('Discard the unsaved changes in this document?');
const shortModel = name => name?.replace(/-GGUF$/i, '') || 'No model loaded';

function inline(text, parent) {
  const expression = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let start = 0;
  for (const match of text.matchAll(expression)) { parent.append(document.createTextNode(text.slice(start, match.index))); parent.append(node(match[2] ? 'strong' : 'code', '', match[2] || match[3])); start = match.index + match[0].length; }
  parent.append(document.createTextNode(text.slice(start)));
}
function markdown(text, target) {
  target.replaceChildren(); target.classList.add('markdown');
  const lines = text.split('\n'); let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) { const code = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); i++; const pre = node('pre'); const copy=node('button','copy-code','Copy code');copy.type='button';copy.onclick=()=>navigator.clipboard.writeText(code.join('\n')).then(()=>toast('Code copied.')).catch(fail); pre.append(copy,node('code', '', code.join('\n'))); target.append(pre); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (heading) { const h = node(`h${heading[1].length}`); inline(heading[2], h); target.append(h); i++; continue; }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line); const list = node(ordered ? 'ol' : 'ul');
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) { const item = node('li'); inline(lines[i++].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''), item); list.append(item); }
      target.append(list); continue;
    }
    if (line.startsWith('> ')) { const quote = node('blockquote'); inline(line.slice(2), quote); target.append(quote); i++; continue; }
    const paragraph = node('p');
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|\s*[-*]\s|\s*\d+\.\s|> )/.test(lines[i])) { if (paragraph.childNodes.length) paragraph.append(node('br')); inline(lines[i++], paragraph); }
    if (!paragraph.childNodes.length) { inline(lines[i++], paragraph); }
    target.append(paragraph);
  }
}
function showView(view) {
  if (['chat','workspace'].includes(view) && view!==state.scope) { void switchConversation(view).catch(fail); return; }
  state.view = view;
  if (view==='trainer') {
    document.querySelector('.tools-nav').open=true;
    void features?.refreshTrainingBases();
  }
  for (const name of ['workspace','models','settings','trainer']) $(`${name}-view`).hidden=name==='workspace' ? !['chat','workspace'].includes(view) : name!==view;
  document.querySelectorAll('[data-view]').forEach(e => e.classList.toggle('active', e.dataset.view === view));
  $('page-title').textContent=['chat','workspace'].includes(view) ? session()?.title || (state.scope==='chat' ? 'New chat' : 'New workspace session') : view==='models' ? 'Model library' : view==='trainer' ? 'Trainer' : 'Settings';
  $('workspace-view').classList.toggle('chat-mode',state.scope==='chat'); chatIntro.hidden=state.scope!=='chat'; workspaceIntro.hidden=state.scope!=='workspace';
  $('mode').value=state.scope==='chat' ? 'chat' : 'agent'; conversationType.textContent=state.scope==='chat' ? 'Chat' : 'Workspace agent';
  $('prompt').placeholder=state.scope==='chat' ? 'Message Forge…' : 'What would you like to work on?';
  document.querySelector('.composer-caption').firstElementChild.textContent=state.data?.runtime.localOllama ? 'Ollama on this computer · check whether your model uses the cloud' : state.data?.runtime.source==='remote' ? 'Remote model · messages are sent to the configured server' : state.scope==='chat' ? 'Local inference · general conversation' : 'Local inference · writes need your review';
  if (view === 'models') renderModels();
  if (view === 'settings') fillSettings();
  if (state.data) features?.render(state.data);
  journey?.render(state.data);
  projectGit?.render();
  projectInstructions?.render();
  $('toggle-files').hidden = view !== 'workspace';
  renderEditor();
}
function setScope(scope) {
  if(scope===state.scope) return;
  state.lastSessions[state.scope]=state.sessionId;state.scope=scope;
}
async function switchConversation(scope) {
  saveDraft();state.navVersion++;state.loadingSession=null;const id=state.lastSessions[scope]; setScope(scope); state.sessionId=null;
  const target=state.data?.sessions.find(s=>s.id===id && kind(s)===scope && (scope==='chat' || s.workspaceId===state.workspaceId));
  if(target) await selectSession(target.id);
  else { loadDraft();showView(scope); renderSidebar(); renderMessages(); renderRuntime(); await rememberSelection(); }
  if(scope==='workspace') await refreshFiles();
}
function renderSidebar() {
  $('workspaces').replaceChildren();
  for (const w of state.data.workspaces) {
    const b = node('button', `project-button${w.id === state.workspaceId ? ' active' : ''}`); b.append(node('span', '', '▱'), node('strong', '', w.name)); b.title = w.path;
    if (w.id === state.workspaceId) b.append(node('span', 'project-dot'));
    b.onclick = () => switchProject(w.id); $('workspaces').append(b);
  }
  const sessions=state.data.sessions.filter(s => kind(s)===state.scope && (state.scope==='chat' || s.workspaceId===state.workspaceId) && !s.archived && (!searchMatches || searchMatches.has(s.id))).sort((a,b) => Number(Boolean(b.pinned))-Number(Boolean(a.pinned)) || b.updated-a.updated);
  $('session-count').textContent = sessions.length || '';
  $('sessions').replaceChildren();
  if (!sessions.length) $('sessions').append(node('div', 'empty-sessions', searchMatches ? 'No matching conversations.' : 'A fresh start.\nYour conversations will appear here.'));
  for (const s of sessions) {
    const row = node('div', `session-row${s.id === state.sessionId ? ' active' : ''}`);
    const b = node('button'); b.append(node('span', '', '◌'), node('span', 'session-title', s.title)); b.title = s.title;if(s.id===generatingId())b.append(node('small','session-generating','Generating…'));
    b.onclick=() => selectSession(s.id).catch(fail);
    const del = node('button', 'delete-session', '×'); del.title = 'Delete session'; del.setAttribute('aria-label', `Delete ${s.title}`); del.disabled = s.id===generatingId();
    del.onclick=async()=>{if(!confirm(`Delete “${s.title}” and its saved conversation? Project files will remain.`))return;try{await api('/api/session/delete',{method:'POST',body:{id:s.id}});state.data.sessions=state.data.sessions.filter(x=>x.id!==s.id);deleteDraft(s.id);state.notices.delete(s.id);if(state.sessionId===s.id){state.navVersion++;state.sessionId=null;deleteDraft(draftKey());loadDraft();await rememberSelection();}renderSidebar();renderMessages();showView(state.view);renderRuntime();}catch(error){fail(error);}};
    const pin=node('button','pin-session',s.pinned?'★':'☆');pin.type='button';pin.title=s.pinned?'Unpin conversation':'Pin conversation';pin.setAttribute('aria-label',`${s.pinned?'Unpin':'Pin'} ${s.title}`);pin.onclick=async()=>{pin.disabled=true;try{const updated=await api('/api/session/update',{method:'POST',body:{id:s.id,pinned:!s.pinned}});Object.assign(s,{pinned:updated.pinned,updated:updated.updated});renderSidebar();}catch(error){fail(error);}finally{pin.disabled=false;}};
    row.append(b,pin,del); $('sessions').append(row);
  }
  $('project-label').textContent = state.scope==='chat' ? 'Chat' : project()?.name || 'Workspace'; $('workspace-path').textContent = project()?.path || ''; $('workspace-path').title = project()?.path || '';
  $('workspaces').hidden=state.scope==='chat'; $('workspaces').previousElementSibling.hidden=state.scope==='chat';
  $('session-count').parentElement.firstChild.textContent=state.scope==='chat' ? 'CHATS ' : 'SESSIONS ';
  $('new-session').childNodes[1].textContent=state.scope==='chat' ? ' New chat ' : ' New session ';
  $('new-session').disabled=false;$('add-workspace').disabled=false;$('mode').disabled=busy();
}
function renderRuntime() {
  const r = state.data.runtime; const isBusy = busy();
  const ready=chatReadiness(r,{installed:state.data.runtimeInstalled,hasImages:Boolean(state.images.length || session()?.messages?.some(m=>m.images?.length)),loadingSession:Boolean(state.loadingSession),busy:isBusy});const key=JSON.stringify(ready);
  if(key!==readinessKey){readinessKey=key;readiness.replaceChildren();const text=node('span');text.append(node('strong','',ready.label));if(ready.detail)text.append(node('small','',ready.detail));readiness.append(text);if(ready.action){const action=node('button','text-button',ready.button);action.type='button';action.onclick=()=>{if(ready.action==='vision')void features.visionSetup().catch(fail);else if(ready.action==='memory'){showView('settings');features.selectSettings('runtime');$('runtime-advanced').open=true;}else showView('models');};readiness.append(action);}}
  document.querySelector('.composer-caption').firstElementChild.textContent=r.localOllama ? 'Ollama on this computer · check whether your model uses the cloud' : r.source==='remote' ? 'Remote model · messages are sent to the configured server' : state.scope==='chat' ? 'Local inference · general conversation' : 'Local inference · writes need your review';
  chatIntro.querySelector('p').textContent=r.localOllama ? 'Ask a question, explore an idea, or just talk. Messages go to Ollama on this computer; check whether your model uses the cloud.' : r.source==='remote' ? 'Ask a question, explore an idea, or just talk. Messages are sent to your configured model server.' : 'Ask a question, explore an idea, or just talk. Your conversation stays on this computer.';
  const name = shortModel(r.model?.name);
  $('runtime-label').textContent = r.status === 'loading' ? 'Loading model…' : r.status === 'error' ? 'Runtime needs attention' : name;
  $('active-model-label').textContent = r.model ? `${r.status === 'loading' ? 'Loading · ' : ''}${name}` : 'Choose a model';
  $('composer-model').textContent = name;
  $('runtime-dot').className = `dot ${r.status === 'ready' ? '' : r.status === 'loading' ? 'loading' : r.status === 'error' ? 'error' : 'muted'}`;
  $('hardware-label').textContent = `${state.data.hardware.ramGiB.toFixed(0)} GB RAM · ${r.status === 'ready' ? 'Ready' : r.status === 'stopped' ? 'Idle' : r.status}`;
  $('send').disabled=r.status!=='ready'||isBusy||Boolean(state.loadingSession)||(!$('prompt').value.trim()&&!state.images.length&&!state.documents.length);$('send').hidden=visibleRun();
  queueButton.hidden=!isBusy;queueButton.disabled=queueAdding||Boolean(queuedMessage)||Boolean(state.loadingSession)||(!$('prompt').value.trim()&&!state.images.length&&!state.documents.length)||r.status!=='ready';renderQueue();
  $('attach-image').disabled=Boolean(state.loadingSession);$('attach-image').title='Attach, paste or drop an image. Vision setup is available if needed.';
  $('stop-task').hidden=!state.sending&&!state.data.active;$('prompt').disabled=Boolean(state.loadingSession);
  generationBanner.hidden=!isBusy;const activeTitle=state.run?.current?.title||state.data.sessions.find(s=>s.id===state.data.active)?.title;
  generationLabel.textContent=activeTitle?`${state.run?.approvals.size?'Waiting for approval':'Generating'} in “${activeTitle}”. You can browse chats and prepare your next message.`:'The model is working. You can browse chats and prepare your next message.';
  viewGeneration.hidden=!generatingId()||generatingId()===state.sessionId;stopGeneration.hidden=!state.sending&&!state.data.active;features?.renderComposer();
  $('model-count').textContent = state.data.models.length;
  $('runtime-logs').textContent = r.logs?.join('\n') || 'No runtime output yet.';
  $('unload-model').disabled=!r.model || isBusy || r.status==='stopping';
  $('unload-model').textContent=r.status==='loading' ? 'Cancel loading' : 'Unload model';
  $('install-runtime').disabled = state.installing || isBusy || state.data.modelConversion?.active || ['loading', 'ready', 'stopping'].includes(r.status);
  $('install-runtime').hidden=false;
  $('runtime-backend').disabled=$('install-runtime').disabled;
  $('library-runtime-status').textContent = r.status === 'ready' ? 'Model ready' : r.status === 'loading' ? 'Loading your model…' : r.status === 'error' ? 'Runtime needs attention' : state.data.runtimeInstalled ? 'llama.cpp is installed' : 'One quick setup step';
  $('library-runtime-detail').textContent=r.error || (r.status==='loading' ? `${r.phase || 'Loading'} · ${Math.floor((Date.now()-r.started)/1000)}s · you can cancel loading or keep using the editor.` : state.installing ? 'Downloading the official runtime from GitHub…' : state.data.runtimeInstalled ? `${r.vision ? 'Vision + text' : 'Text'} inference · ${state.data.executable}` : 'Install a runtime, or choose your own llama-server executable in Settings.');
  $('models-folder').textContent = state.data.modelError || state.data.settings.modelDir;
  const hint = setupHint; hint.replaceChildren();
  if (r.status !== 'ready') { hint.append(document.createTextNode(r.status === 'loading' ? 'Your model is loading. ' : r.phase==='Unloaded after inactivity' ? 'Your model was unloaded after inactivity. ' : 'Ready when you are. ')); const b = node('button', '', state.data.runtimeInstalled ? 'Choose a local model ↗' : 'Set up local inference ↗'); b.onclick = () => showView('models'); hint.append(b); }
  if (state.view === 'models') renderModels();
}
function renderModels() {
  if (!state.data) return;
  const signature=JSON.stringify([state.data.models,state.data.runtime.status,state.data.runtime.model?.path,state.data.runtimeInstalled,busy(),state.installing,state.data.modelConversion?.active,state.data.modelPerformance,state.data.modelBenchmarks,benchmarkActive]);
  if(signature===modelRenderKey)return; modelRenderKey=signature;
  $('model-list').replaceChildren();
  if (!state.data.models.length) $('model-list').append(node('div', 'empty-state', 'No GGUF models found. Point Settings to a folder containing your .gguf files, then refresh this library.'));
  for (const model of state.data.models) {
    const active = state.data.runtime.model?.path === model.path;
    const card = node('div', 'model-card'); const info = node('div', 'model-card-info'); info.append(node('strong', '', model.name));
    const meta = node('small'); meta.append(node('span', '', 'GGUF'), document.createTextNode(`${(model.bytes / 1024 ** 3).toFixed(2)} GiB · ${active ? state.data.runtime.status : 'On this device'}`)); info.append(meta);
    const speed=state.data.modelPerformance?.[model.path];if(speed && speed.modelBytes===model.bytes && speed.modelMtimeMs===model.mtimeMs && Number.isFinite(speed.tokensPerSecond))info.append(node('small','model-speed',`Last measured: ${speed.tokensPerSecond.toFixed(1)} tokens/s · ${speed.mode}${speed.gpuLayers ? ` (${speed.gpuLayers} GPU layers)` : ''} · context ${speed.contextSize}. Speed varies with workload.`));else info.append(node('small','model-speed','Speed not measured yet. Run this model to measure it on your computer.'));
    const benchmark=state.data.modelBenchmarks?.[model.path];if(benchmark && benchmark.modelBytes===model.bytes && benchmark.modelMtimeMs===model.mtimeMs && [benchmark.mean,benchmark.min,benchmark.max].every(Number.isFinite) && Array.isArray(benchmark.samples))info.append(node('small','model-speed',`Benchmark: ${benchmark.mean.toFixed(1)} tokens/s average (${benchmark.min.toFixed(1)}–${benchmark.max.toFixed(1)}, ${benchmark.samples.length} runs) · ${benchmark.mode}, ${benchmark.gpuLayers} GPU layers · context ${benchmark.contextSize || 'unknown'} · ${new Date(benchmark.measuredAt).toLocaleDateString()}. ${benchmark.hardware?.cpu ? `Reported CPU: ${benchmark.hardware.cpu}. ` : ''}${benchmark.hardware?.reportedGpu ? `Reported GPU: ${benchmark.hardware.reportedGpu}. ` : ''}Results vary with workload.`));
    const load = node('button', active ? 'secondary-button' : 'primary-button', active ? state.data.runtime.status === 'loading' ? 'Loading…' : 'Loaded' : state.data.runtimeInstalled ? 'Load model' : 'Set up & load');
    load.disabled = active || busy() || state.data.modelConversion?.active || state.installing || ['loading', 'stopping'].includes(state.data.runtime.status);
    load.onclick = async () => { load.disabled = true; try { if(!state.data.runtimeInstalled){state.installing=true;renderRuntime();await api('/api/runtime/install',{method:'POST',body:{backend:'auto'}});state.installing=false;await refresh();} state.data.runtime = await api('/api/model/load', { method: 'POST', body: { path: model.path } }); renderRuntime(); toast('Loading model. Progress is shown in the runtime logs.'); } catch (error) { state.installing=false;fail(error);modelRenderKey='';renderModels(); } };
    const check=node('button','secondary-button','Check fit');check.type='button';check.onclick=async()=>{check.disabled=true;try{const plan=await api('/api/model/plan',{method:'POST',body:{path:model.path}});let detail=info.querySelector('.model-fit');if(!detail){detail=node('small','model-fit');info.append(detail);}detail.textContent=`${state.data.runtimeInstalled ? '' : 'CPU-only estimate until a runtime is installed. '}Planned ${plan.mode}: estimated ${plan.ramGiB.toFixed(1)} GiB system RAM${plan.vramGiB ? ` · ${plan.vramGiB.toFixed(1)} GiB GPU memory` : ''}. ${plan.errors.length ? plan.errors.join(' ') : 'Estimated to fit currently available memory; actual usage may vary.'}`;}catch(error){fail(error);}finally{check.disabled=false;}};
    const bench=node('button','secondary-button',benchmarkActive && active?'Stop benchmark':'Measure speed');bench.type='button';bench.hidden=!active || state.data.runtime.source==='remote' || state.data.runtime.status!=='ready';bench.disabled=!benchmarkActive && busy();bench.onclick=async()=>{if(benchmarkActive){try{await api('/api/model/benchmark/cancel',{method:'POST',body:{}});}catch(error){fail(error);}return;}benchmarkActive=true;modelRenderKey='';renderModels();try{await api('/api/model/benchmark',{method:'POST',body:{}});await refresh();toast('Model benchmark complete.');}catch(error){fail(error);}finally{benchmarkActive=false;modelRenderKey='';renderModels();}};
    card.append(node('div', 'model-symbol', '◈'), info, check, bench, load); $('model-list').append(card);
  }
}
function messageElement(message, streaming = false) {
  const wrap = node('article', `message ${message.role}${message.interrupted ? ' interrupted' : ''}`); wrap.dataset.messageId = message.id;
  const head = node('div', 'message-head');
  head.append(node('span','message-avatar',message.role==='user' ? 'Y' : '✧'),node('strong','',message.role==='user' ? 'You' : 'Forge'));
  const time = node('time', '', new Date(message.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); head.append(time); wrap.append(head);
  if (message.metrics) head.append(node('small','message-metrics',`${message.metrics.estimatedRate ? '~' : ''}${message.metrics.tokensPerSecond.toFixed(1)} tokens/s`));
  if (message.reasoning) {
    const details = node('details', 'reasoning'); details.append(node('summary', '', 'Model reasoning'), node('div', '', message.reasoning)); wrap.append(details);
  }
  const body = node('div', 'message-body');
  if (message.role === 'assistant' && !streaming) markdown(message.content || (message.tool_calls ? 'Working with project files.' : message.interrupted ? 'This response was interrupted.' : ''), body);
  else body.textContent = message.content || (streaming ? 'Thinking…' : '');
  wrap.append(body);
  if (message.images?.length) { const images=node('div','message-images'); for (const image of message.images) { const picture=node('img'); picture.src=image.url; picture.alt=image.name || 'Attached image'; images.append(picture); } wrap.append(images); }
  if (message.documents?.length) for(const document of message.documents){const details=node('details','message-document');details.append(node('summary','',`${document.name}${document.truncated?' · excerpt':''}`),node('pre','',document.text));if(document.name.startsWith('Web result: ')){const open=node('button','text-button','Open source');open.type='button';open.onclick=()=>openExternal(document.name.slice('Web result: '.length)).catch(fail);details.append(open);}wrap.append(details);}
  if (message.sources?.length) {const details=node('details','message-document');details.append(node('summary','',`Retrieved project passages (${message.sources.length})`));for(const source of message.sources){const section=node('div');const open=node('button','text-button',`${source.path}${source.startLine ? `:${source.startLine}-${source.endLine}` : ' · extracted text'}`);open.type='button';open.onclick=async()=>{await openFile(source.path);state.filesVisible=true;renderEditor();if(state.file?.path===source.path && source.startLine){const editor=$('editor'),lines=state.file.content.split('\n');const offset=lines.slice(0,source.startLine-1).reduce((sum,line)=>sum+line.length+1,0);editor.focus();editor.setSelectionRange(offset,Math.min(state.file.content.length,offset+(lines[source.startLine-1]?.length || 0)));}};section.append(open,node('pre','',source.text));details.append(section);}wrap.append(details);}
  if (message.tool_calls) for (const call of message.tool_calls) {
    const details = node('details', 'tool-event'); details.append(node('summary', '', `↳ ${call.function.name}`), node('pre', '', call.function.arguments)); wrap.append(details);
  }
  if(!streaming && message.content) {
    const actions=node('div','message-actions');
    const copy=node('button','text-button','Copy');copy.type='button';copy.onclick=()=>navigator.clipboard.writeText(message.content).then(()=>toast('Message copied.')).catch(fail);actions.append(copy);
    const original=message.role==='user' ? message : [...(session()?.messages || [])].slice(0,(session()?.messages || []).findIndex(m=>m.id===message.id)).reverse().find(m=>m.role==='user');
    if(original?.id && ['user','assistant'].includes(message.role)) { const action=node('button','text-button',message.role==='user' ? 'Edit in copy' : 'Retry in copy');action.type='button';action.disabled=busy();action.onclick=async()=>{try{const branch=await api('/api/session/branch-at',{method:'POST',body:{id:session().id,messageId:original.id}});await refresh();await selectSession(branch.session.id);$('prompt').value=branch.message.content;state.images=branch.message.images || [];state.documents=branch.message.documents || [];saveDraft();features.renderImages();features.renderDocuments();$('prompt').dispatchEvent(new Event('input'));if(message.role==='assistant')$('chat-form').requestSubmit();else $('prompt').focus();}catch(error){fail(error);}};actions.append(action); }
    wrap.append(actions);
  }
  return wrap;
}
function renderMessages(preserveScroll=false) {
  streamUpdates.clear();if(streamFrame){cancelAnimationFrame(streamFrame);streamFrame=0;}
  const priorHeight=$('messages').scrollHeight,priorTop=$('messages').scrollTop;
  const messages = session()?.messages || [];
  $('messages').replaceChildren(); $('task-notice').hidden = true;
  if (!messages.length) $('messages').append(welcome);
  if(messages.length>historyLimit){const older=node('button','text-button','Show older messages');older.type='button';older.onclick=()=>{historyLimit+=100;renderMessages(true);};$('messages').append(older);}
  for (const m of messages.slice(-historyLimit)) {
    if (m.role === 'tool') {
      const details = node('details', 'tool-event'); details.append(node('summary', '', `✓ ${m.name || 'Tool'} result`), node('pre', '', m.content)); $('messages').append(details);
    } else $('messages').append(messageElement(m));
  }
  if(visibleRun())for(const approval of state.run.approvals.values())approvalCard(approval);
  if(state.notices.has(state.sessionId))notice(state.notices.get(state.sessionId));
  $('page-title').textContent = ['chat','workspace'].includes(state.view) ? session()?.title || (state.scope==='chat' ? 'New chat' : 'New workspace session') : $('page-title').textContent;
  if(preserveScroll)$('messages').scrollTop=priorTop+$('messages').scrollHeight-priorHeight;else scrollToBottom();
}
function scheduleStreamUpdate(message) {
  streamUpdates.set(message.id,message);if(streamFrame)return;
  streamFrame=requestAnimationFrame(()=>{streamFrame=0;const nearBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<160;
    for(const [id,m] of streamUpdates){if(!visibleRun())continue;const article=document.querySelector(`[data-message-id="${id}"]`);if(!article)continue;updateStreamText(article.querySelector('.message-body'),m.content || 'Thinking…');if(m.reasoning){let details=article.querySelector('.reasoning');if(!details){details=node('details','reasoning');details.append(node('summary','','Model reasoning'),node('div'));article.querySelector('.message-body').before(details);}updateStreamText(details.querySelector('div'),m.reasoning);}}
    streamUpdates.clear();if(nearBottom)scrollToBottom();
  });
}
function scrollToBottom() { $('messages').scrollTop = $('messages').scrollHeight; }
function notice(message) { $('task-notice').textContent = message; $('task-notice').hidden = false; }
async function newSession() {
  saveDraft();state.navVersion++;state.loadingSession=null;state.sessionId=null;historyLimit=100;deleteDraft(draftKey());loadDraft();state.lastSessions[state.scope]=null;showView(state.scope);renderSidebar();renderMessages();renderRuntime();$('prompt').focus();
  await rememberSelection();
}
async function rememberSelection() { const ticket=state.navVersion;const values={workspaceId:state.workspaceId,sessionId:state.sessionId,view:state.scope};try { state.lastSessions[state.scope]=state.sessionId;const selected=await api('/api/session/select',{method:'POST',body:values});if(ticket===state.navVersion)state.data.selection=selected; } catch(error){fail(error);} }
async function selectSession(id) {
  saveDraft();const ticket=++state.navVersion;state.loadingSession=id;renderRuntime();
  try{const selected=state.run?.current?.id===id?state.run.current:await api(`/api/session?id=${encodeURIComponent(id)}`);if(ticket!==state.navVersion)return;saveDraft();
  if (kind(selected)==='workspace' && state.workspaceId!==selected.workspaceId && !clean()) return;
  setScope(kind(selected));
  if (kind(selected)==='workspace' && state.workspaceId!==selected.workspaceId) { state.workspaceId=selected.workspaceId; state.file=null; state.dirty=false; state.folder='.'; renderEditor(); await refreshFiles(); }
  const index=state.data.sessions.findIndex(s => s.id===id); if (index<0) state.data.sessions.unshift(selected); else state.data.sessions[index]=selected;
  state.sessionId=id;historyLimit=100;loadDraft();showView(state.scope);renderSidebar();renderMessages();renderRuntime();await rememberSelection();
  }finally{if(ticket===state.navVersion){state.loadingSession=null;renderRuntime();}}
}
async function switchProject(id) {
  if (!clean()) return;saveDraft();state.navVersion++;state.loadingSession=null;
  setScope('workspace');
  state.workspaceId = id; state.sessionId = null; state.folder = '.'; state.file = null; state.dirty = false;
  loadDraft();
  renderSidebar(); renderMessages(); renderEditor(); showView('workspace'); await refreshFiles();
  await rememberSelection();
}
async function refreshFiles() {
  if (!project() || state.scope!=='workspace') return;
  try {
    const workspaceId=state.workspaceId;const folder=state.folder;
    const entries = await api(`/api/files?workspaceId=${encodeURIComponent(state.workspaceId)}&path=${encodeURIComponent(state.folder)}`);
    if(state.workspaceId!==workspaceId||state.folder!==folder||state.scope!=='workspace')return;
    $('folder-breadcrumb').replaceChildren();
    const root = node('button', '', '▱ Project'); root.onclick = () => { state.folder = '.'; refreshFiles(); }; $('folder-breadcrumb').append(root);
    if (state.folder !== '.') { const up = node('button', '', '↑'); up.title = 'Parent folder'; up.onclick = () => { state.folder = state.folder.split('/').slice(0, -1).join('/') || '.'; refreshFiles(); }; $('folder-breadcrumb').append(node('span', '', '/'), node('span', '', state.folder), up); }
    $('file-list').replaceChildren();
    if (!entries.length) $('file-list').append(node('div', 'empty-sessions', 'No text documents here yet.'));
    for (const entry of entries) {
      const b = node('button', `file-row${state.file?.path === entry.path ? ' active' : ''}`); b.append(node('span', 'file-icon', entry.directory ? '▱' : entry.name.endsWith('.md') ? '▤' : '⌘'), node('span', 'file-name', entry.name));
      b.onclick = () => { if (entry.directory) { state.folder = entry.path; refreshFiles(); } else openFile(entry.path); }; $('file-list').append(b);
    }
  } catch (error) { $('file-list').replaceChildren(node('div', 'empty-sessions', error.message)); }
}
async function openFile(path) {
  if (!clean()) return false;
  const request=++fileRequest,workspaceId=state.workspaceId,navVersion=state.navVersion,priorContent=state.file?.content;
  try {
    const file=await api(`/api/file?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`);
    if(request!==fileRequest || workspaceId!==state.workspaceId || navVersion!==state.navVersion)return false;
    if(state.dirty && state.file?.content!==priorContent){toast('File opening cancelled to preserve your unsaved edits.');return false;}
    state.file=file;state.dirty=false;state.preview=false;renderEditor();void refreshFiles();return true;
  } catch(error){if(request===fileRequest && workspaceId===state.workspaceId && navVersion===state.navVersion)fail(error);return false;}
}
function renderEditor() {
  const f = state.file;
  $('editor-name').textContent = f ? `${state.dirty ? '● ' : ''}${f.path}` : 'Choose a document';
  $('editor-placeholder').hidden = Boolean(f); $('editor').hidden = !f || state.preview; $('document-preview').hidden = !f || !state.preview;
  $('save-file').disabled=!f || !state.dirty || f.readOnly; $('preview-toggle').disabled=!f; $('editor').readOnly=Boolean(f?.readOnly);
  $('preview-toggle').textContent = state.preview ? 'Edit' : 'Preview';
  $('editor-status').textContent=f?.readOnly ? 'Extracted document text · read only' : f ? state.dirty ? 'Unsaved changes' : f.hash ? 'Saved on this device' : 'New document' : 'Markdown · text · code';
  if (f) { if ($('editor').value !== f.content) $('editor').value = f.content; if (state.preview) markdown(f.content, $('document-preview')); }
  $('files-panel').hidden = state.scope!=='workspace' || !state.filesVisible;
}
async function saveFile() {
  if (!state.file || !state.dirty || state.file.readOnly) return;
  const workspaceId=state.workspaceId,current=state.file,content=current.content;
  try {const saved=await api('/api/file',{method:'PUT',body:{workspaceId,...current}});
    if(workspaceId!==state.workspaceId || state.file!==current)return;
    if(current.content===content){state.file=saved;state.dirty=false;}else current.hash=saved.hash;
    renderEditor();await refreshFiles();toast(state.dirty?'Earlier edits saved. Your newer edits are still unsaved.':'Document saved.');
  }catch(error){fail(error);}
}
const settingKeys = ['modelDir', 'runtimePath', 'contextSize', 'gpuLayers', 'threads', 'temperature', 'maxTokens', 'systemPrompt'];
function fillSettings() { for (const key of settingKeys) $(`setting-${key}`).value = state.data.settings[key]; }
async function refresh() {
  const previous = state.data;
  state.data = await api('/api/bootstrap');
  $('app-version').textContent=state.data.appVersion ? ` / ${state.data.appVersion}` : '';
  if(!previous) { try { const [drafts,queue]=await Promise.all([api('/api/drafts'),api('/api/queue')]); state.drafts=new Map(Object.entries(drafts));queuedMessage=queue.message;queuePaused=Boolean(queuedMessage); } catch(error) { fail(error); } }
  if(state.run?.current){const index=state.data.sessions.findIndex(s=>s.id===state.run.current.id);if(index>=0)state.data.sessions[index]=state.run.current;}
  if (!previous && state.data.settings.restoreSession) { const selection=state.data.selection || {}; state.workspaceId=selection.workspaceId; state.scope=selection.view==='workspace' ? 'workspace' : 'chat'; state.view=state.scope; state.lastSessions={chat:selection.chatSessionId || null,workspace:selection.workspaceSessionId || (selection.view!=='chat' ? selection.sessionId : null)}; state.sessionId=state.lastSessions[state.scope]; }
  if (!state.workspaceId || !project()) state.workspaceId = state.data.workspaces[0]?.id;
  if (state.sessionId && (!session() || kind(session())!==state.scope)) state.sessionId = null;
  if(state.sessionId&&state.sessionId!==state.run?.current?.id){const id=state.sessionId;const ticket=state.navVersion;const full=await api(`/api/session?id=${encodeURIComponent(id)}`);if(id===state.sessionId&&ticket===state.navVersion){const index=state.data.sessions.findIndex(s=>s.id===id);if(index>=0)state.data.sessions[index]=full;}}
  renderSidebar(); renderRuntime();
  if (!previous) { loadDraft();showView(state.scope); renderMessages(); renderEditor(); await refreshFiles(); }
  features?.render(state.data);
}
function approvalCard(event) {
  const pendingRun=state.run;
  const card=node('div','approval'); card.append(node('div','approval-title',`${event.kind==='command' ? 'Review shell command' : event.kind==='mcp' ? 'Review external MCP tool call' : event.exists ? 'Review file replacement' : 'Review new document'} · ${event.path}`),node('p','',event.description || 'The agent is waiting. Applying this proposal writes the following content to your project.'));
  const columns = node('div', 'proposal-columns');
  for (const [label, value] of [['Before', event.before || '(new file)'], ['After', event.after]]) { const col = node('div', 'proposal-column'); col.append(node('span', '', label), node('pre', '', value)); columns.append(col); }
  if(!['mcp','command'].includes(event.kind)) { const before=(event.before || '').split('\n'),after=(event.after || '').split('\n');let start=0,endBefore=before.length,endAfter=after.length;while(start<endBefore && start<endAfter && before[start]===after[start])start++;while(endBefore>start && endAfter>start && before[endBefore-1]===after[endAfter-1]){endBefore--;endAfter--;}const changes=[...before.slice(start,endBefore).map(line=>`− ${line}`),...after.slice(start,endAfter).map(line=>`+ ${line}`)].join('\n');const summary=node('details','change-preview');summary.open=true;summary.append(node('summary','','Changes'),node('pre','',changes.slice(0,20000) || 'No text changes.'));if(changes.length>20000)summary.append(node('small','','Preview shortened; the full text is available below.'));card.append(summary); }
  const full=node('details','proposal-full');full.append(node('summary','',event.kind==='command'?'View command':'View complete before and after'),event.kind==='command'?node('pre','',event.after):columns);if(event.kind==='command')full.open=true;
  const actions=node('div','approval-actions'); const yes=node('button','primary-button',event.kind==='command'?'Run command':event.kind==='mcp' ? 'Run external tool' : 'Apply write'); const no=node('button','secondary-button','Decline');
  for (const [button, accept] of [[yes, true], [no, false]]) button.onclick = async () => {
    yes.disabled = true; no.disabled = true;
    try { await api('/api/approval', { method: 'POST', body: { id: event.id, accept } });pendingRun?.approvals.delete(event.id);renderRuntime(); actions.append(node('span', '', accept ? event.kind==='command'?'Approved · waiting for command result':'Approved · waiting for save result' : 'Declined')); }
    catch (error) { fail(error); actions.append(node('span', '', 'Proposal is no longer active.')); }
  };
  actions.append(yes, no); card.append(full, actions); $('messages').append(card); scrollToBottom();
}

function installFileHistory() {
  const button=node('button','icon-button','↶');button.type='button';button.title='Assistant change history';button.setAttribute('aria-label','Assistant change history');document.querySelector('.panel-header>div').prepend(button);
  const dialog=node('dialog','forge-dialog');dialog.innerHTML='<h3>Assistant change history</h3><p>Restore earlier versions of files changed by the assistant. Files changed since the assistant edit are protected.</p><div class="history-list"></div><div class="dialog-actions"><button type="button" class="secondary-button">Close</button></div>';document.body.append(dialog);dialog.querySelector('.dialog-actions button').onclick=()=>dialog.close();
  const refreshHistory=async()=>{const entries=await api(`/api/file/history?workspaceId=${encodeURIComponent(state.workspaceId)}`);const list=dialog.querySelector('.history-list');list.replaceChildren();if(!entries.length)list.append(node('p','','No assistant file changes yet.'));for(const entry of entries){const row=node('div','history-item');const info=node('span','',`${entry.path} · ${new Date(entry.created).toLocaleString()}${entry.undone?' · restored':''}`);const undo=node('button','secondary-button',entry.existed?'Restore previous':'Remove created file');undo.disabled=entry.undone;undo.onclick=async()=>{if(state.dirty && state.file?.path===entry.path){toast('Save or discard your open edits before restoring this file.',true);return;}if(!confirm(`Undo the assistant change to ${entry.path}?`))return;undo.disabled=true;try{await api('/api/file/undo',{method:'POST',body:{id:entry.id,workspaceId:state.workspaceId}});if(state.file?.path===entry.path){state.file=null;state.dirty=false;renderEditor();}await refreshFiles();await refreshHistory();toast('Assistant change undone.');}catch(error){fail(error);undo.disabled=false;}};row.append(info,undo);list.append(row);}};
  button.onclick=()=>{dialog.showModal();refreshHistory().catch(fail);};
}
async function* events(body) {
  const decoder = new TextDecoder(); let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }); buffer = buffer.replaceAll('\r\n', '\n'); let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) { const block = buffer.slice(0, index); buffer = buffer.slice(index + 2); const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n'); if (data) yield JSON.parse(data); }
  }
}
async function send(event,queued=null) {
  event.preventDefault(); const queuedSession=queued ? await api(`/api/session?id=${encodeURIComponent(queued.sessionId)}`) : null; if(queued && queuedMessage?.id!==queued.id)return;
  const text=queued ? queued.text : $('prompt').value.trim() || (state.images.length ? 'Describe the attached image.' : state.documents.length ? 'Summarize the attached files.' : '');
  if(!text||state.loadingSession)return;if(busy()){toast('The model is generating another reply. You can prepare this message and send it when that reply finishes.');return;}
  const selectedImages=queued ? queued.images : state.images;const selectedSession=queuedSession || session();
  if((selectedImages.length||selectedSession?.messages?.some(m=>m.images?.length))&&!state.data.runtime.vision&&state.data.runtime.source!=='remote'){if(queued){queuePaused=true;renderQueue();toast('Set up vision before sending the queued image.',true);}else await features.visionSetup();return;}
  if (state.data.runtime.status !== 'ready') { toast('Load a model in the Models tab first.', true); showView('models'); return; }
  const scope=queuedSession ? kind(queuedSession) : state.scope;const workspaceId=queuedSession?.workspaceId || state.workspaceId;const originTicket=queued && state.sessionId!==queued.sessionId ? -1 : state.navVersion;const images=selectedImages;const documents=queued ? queued.documents || [] : state.documents;const systemPrompt=state.sessionPrompt;const mode=scope==='chat'?'chat':'agent';
  const run={current:selectedSession||null,originTicket,approvals:new Map(),notice:'',controller:new AbortController(),accepted:false};state.run=run;
  state.sending=true;$('task-notice').hidden=true;if(!queued){$('prompt').value='';state.images=[];state.documents=[];saveDraft();features.renderImages();features.renderDocuments();}showView(state.scope);
  renderSidebar(); renderRuntime();
  let current=run.current;
  try {
    if(!current){current=await api('/api/sessions',{method:'POST',body:{kind:scope,workspaceId:scope==='workspace'?workspaceId:null,systemPrompt}});run.current=current;state.data.sessions.unshift(current);if(originTicket===state.navVersion){state.sessionId=current.id;saveDraft();}}
    state.notices.delete(current.id);if(originTicket===state.navVersion)await rememberSelection();renderSidebar();renderRuntime();
    const response=await fetch('/api/chat',{ method:'POST',headers:{ 'Content-Type':'application/json','X-Local-Desk-Token':token },body:JSON.stringify({ sessionId:current.id,text,mode,images,documents }),signal:run.controller.signal });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
    run.accepted=true;
    for await (const event of events(response.body)) {
      if(queued && event.type==='session' && queuedMessage?.id===queued.id){await api('/api/queue',{method:'POST',body:{clear:true,id:queued.id}});queuedMessage=null;queuePaused=false;renderQueue();}
      if(event.type==='approval')run.approvals.set(event.id,event);
      if(event.type==='notice'||event.type==='error'){run.notice=event.message;state.notices.set(current.id,event.message);}
      if(event.type==='tool'){const last=current.messages.at(-1);if(last?.role==='assistant'){last.tool_calls??=[];last.tool_calls.push({function:{name:event.name,arguments:event.arguments}});}}
      if(!visibleRun()){
        if(event.type==='session')Object.assign(current,event.session);
        else if(event.type==='message'||event.type==='tool_result')current.messages.push(event.message);
        else if(event.type==='delta'||event.type==='reasoning'){const m=current.messages.find(m=>m.id===event.id);if(m){if(event.type==='delta')m.content+=event.content;else m.reasoning=(m.reasoning||'')+event.content;}}
        else if(event.type==='metrics'){const m=current.messages.find(m=>m.id===event.id);if(m)m.metrics=event.metrics;}
        if(['session','approval','done','error'].includes(event.type)){renderSidebar();renderRuntime();}
        continue;
      }
      if(event.type==='delta'||event.type==='reasoning'){const m=current.messages.find(m=>m.id===event.id);if(m){if(event.type==='delta')m.content+=event.content;else m.reasoning+=event.content;scheduleStreamUpdate(m);}continue;}
      const nearBottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 160;
      if (event.type === 'session') { Object.assign(current, event.session); renderSidebar(); renderMessages(); }
      else if (event.type === 'message') { current.messages.push(event.message); $('messages').append(messageElement(event.message, true)); }
      else if (event.type === 'tool') {
        const last = current.messages.at(-1); const article = last && document.querySelector(`[data-message-id="${last.id}"]`); if (article && !last.content) article.querySelector('.message-body').textContent = 'Working with project files.';
        const details = node('details', 'tool-event'); details.append(node('summary', '', `↳ ${event.name}`), node('pre', '', event.arguments)); $('messages').append(details);
      } else if (event.type === 'tool_result') {
        current.messages.push(event.message);
        const details = node('details', 'tool-event'); details.append(node('summary', '', `${event.message.content.includes('"error"') ? '!' : '✓'} ${event.message.name} result`), node('pre', '', event.message.content)); $('messages').append(details);
        if (event.message.name === 'write_file') { refreshFiles(); try { const result = JSON.parse(event.message.content); if (result.saved && state.file?.path === result.path && !state.dirty) await openFile(result.path); } catch { /* Result stays visible in chat. */ } }
      } else if (event.type === 'approval') approvalCard(event);
      else if (event.type==='skills') $('composer-skills').textContent=`Skills: ${event.names.join(', ')}`;
      else if (event.type==='metrics') { const m=current.messages.find(m => m.id===event.id); if (m) m.metrics=event.metrics; const head=document.querySelector(`[data-message-id="${event.id}"] .message-head`); if (head) head.append(node('small','message-metrics',`${event.metrics.estimatedRate ? '~' : ''}${event.metrics.tokensPerSecond.toFixed(1)} tokens/s`)); }
      else if (event.type === 'notice' || event.type === 'error') notice(event.message);
      else if (event.type === 'usage') $('composer-model').textContent = `${shortModel(state.data.runtime.model?.name)} · ${event.usage.completion_tokens ?? '?'} output tokens`;
      if (nearBottom || ['message', 'approval'].includes(event.type)) scrollToBottom();
    }
  } catch(error){const message=error.name==='AbortError'?'Task stopped.':error.message;run.notice=message;if(current)state.notices.set(current.id,message);if(visibleRun()){fail(message);notice(message);}else toast(message,true);if(!run.accepted&&current){state.drafts.set(current.id,{text,images,documents,systemPrompt});if(state.sessionId===current.id)loadDraft();}}
  finally {
    if(queued && queuedMessage?.id===queued.id)queuePaused=true;
    if(!queued && queuedMessage && run.notice)queuePaused=true;
    const wasVisible=visibleRun();state.sending=false;if(state.run===run)state.run=null;
    try { await refresh();
      renderMessages();if(!wasVisible&&current&&!run.notice)toast(`Reply finished in “${current.title}”.`);
    } catch (error) { fail(error); }
    renderSidebar();renderRuntime();refreshFiles();if(wasVisible)$('prompt').focus();if(queuedMessage && !run.notice && !queuePaused)setTimeout(()=>void startQueue(),0);
  }
}

function askPath(title, help, initial = '') {
  $('path-title').textContent = title; $('path-help').textContent = help; $('path-input').value = initial; $('path-dialog').returnValue = ''; $('path-dialog').showModal(); $('path-input').focus();
  return new Promise(resolve => { $('path-dialog').addEventListener('close', () => resolve($('path-dialog').returnValue === 'accept' ? $('path-input').value.trim() : null), { once: true }); });
}
$('path-form').onsubmit = e => { e.preventDefault(); $('path-dialog').close('accept'); };
$('path-cancel').onclick = () => $('path-dialog').close('cancel');
document.querySelectorAll('[data-view]').forEach(e => { e.onclick = () => showView(e.dataset.view); });
document.querySelectorAll('[data-prompt]').forEach(e => { e.onclick = () => { $('prompt').value = e.dataset.prompt; $('prompt').focus(); renderRuntime(); }; });
$('new-session').onclick = newSession; $('chat-form').onsubmit = send;
$('prompt').oninput = () => { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min(220, $('prompt').scrollHeight)}px`; saveDraft(); renderRuntime(); };
$('prompt').onkeydown=e => { if (e.key==='Enter' && !e.shiftKey && !e.isComposing && state.data?.settings.enterToSend!==false) { e.preventDefault(); $('chat-form').requestSubmit(); } };
$('stop-task').onclick = async () => { try {state.run?.controller.abort();await api('/api/stop',{method:'POST',body:{}});toast('Stopping the current response…');} catch(error){fail(error);} };
$('model-shortcut').onclick = $('runtime-shortcut').onclick = () => showView('models');
$('toggle-files').onclick = () => { state.filesVisible = !state.filesVisible; renderEditor(); };
$('refresh-files').onclick = refreshFiles;
$('new-file').onclick = async () => {
  if (!clean()) return;
  const path = await askPath('New document', 'Enter a relative filename in this project. Use an existing folder, and a text or Markdown extension.', state.folder === '.' ? 'Untitled.md' : `${state.folder}/Untitled.md`);
  if (!path) return;
  state.file = { path, content: '', hash: null }; state.dirty = true; state.preview = false; renderEditor(); $('editor').focus();
};
$('editor').oninput = () => { if (state.file) { state.file.content = $('editor').value; state.dirty = true; $('save-file').disabled = false; $('editor-status').textContent = 'Unsaved changes'; $('editor-name').textContent = `● ${state.file.path}`; } };
$('save-file').onclick = saveFile;
$('preview-toggle').onclick = () => { state.preview = !state.preview; renderEditor(); };
$('refresh-models').onclick = async () => { try { await refresh(); toast('Model library refreshed.'); } catch (error) { fail(error); } };
$('change-model-folder').onclick = async () => {
  try {
    const folder=window.desktop ? await window.desktop.chooseFolder() : await askPath('Model folder','Enter the absolute path containing your GGUF files.',state.data.settings.modelDir);
    if (!folder) return;
    await api('/api/settings',{ method:'PATCH',body:{ modelDir:folder } }); await refresh(); toast('Model folder updated.');
  } catch (error) { fail(error); }
};
$('unload-model').onclick = async () => { try { state.data.runtime = await api('/api/model/unload', { method: 'POST', body: {} }); renderRuntime(); } catch (error) { fail(error); } };
$('add-workspace').onclick = async () => {
  try { const folder = window.desktop ? await window.desktop.chooseFolder() : await askPath('Open project folder', 'Enter the absolute path of an existing folder. The workspace agent will be able to read its text files and propose writes inside it.'); if (!folder) return; if (!clean()) return;
    const w = await api('/api/workspaces', { method: 'POST', body: { path: folder } }); if (!state.data.workspaces.some(x => x.id === w.id)) state.data.workspaces.push(w); state.dirty = false; await switchProject(w.id);
  } catch (error) { fail(error); }
};
$('browse-models').onclick = async () => { try { const folder = window.desktop ? await window.desktop.chooseFolder() : await askPath('Model folder', 'Enter the absolute path containing your GGUF files.', $('setting-modelDir').value); if (folder) $('setting-modelDir').value = folder; } catch (error) { fail(error); } };
$('browse-runtime').onclick = async () => { try { const file = window.desktop ? await window.desktop.chooseRuntime() : await askPath('llama-server executable', 'Enter the absolute path to your llama-server executable.', $('setting-runtimePath').value); if (file) $('setting-runtimePath').value = file; } catch (error) { fail(error); } };
$('settings-form').onsubmit = async e => {
  e.preventDefault(); const values = {};
  for (const key of settingKeys) { const field = $(`setting-${key}`); if(!e.target.contains(field))continue;values[key] = field.type === 'number' ? Number(field.value) : field.value; }
  try { state.data.settings = await api('/api/settings', { method: 'PATCH', body: values }); await refresh(); $('settings-saved').textContent = 'Saved. Reload the model for hardware changes.'; toast('Settings saved.'); } catch (error) { fail(error); }
};
$('install-runtime').onclick = async () => {
  state.installing = true; renderRuntime();
  try { await api('/api/runtime/install',{ method:'POST',body:{ backend:$('runtime-backend').value } }); await refresh(); toast('llama.cpp installed. Choose a GGUF model to load.'); }
  catch (error) { fail(error); }
  finally { state.installing = false; renderRuntime(); }
};
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newSession(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); } });
$('search-chats').addEventListener('input',()=>{const query=$('search-chats').value.trim();const ticket=++searchTicket;clearTimeout(searchTimer);if(!query){searchMatches=null;renderSidebar();return;}searchTimer=setTimeout(async()=>{try{const result=await api(`/api/search/chats?q=${encodeURIComponent(query)}`);if(ticket===searchTicket){searchMatches=new Set(result.ids);renderSidebar();}}catch(error){fail(error);}},200);});
window.addEventListener('beforeunload', e => { if (state.dirty || state.sending) { e.preventDefault(); e.returnValue = ''; } });
features=initFeatures({ state,api,refresh,showView,session,busy,toast,fail,askPath,selectSession,newSession,token,renderRuntime,saveDraft });
journey=initJourney({state,api,refresh,showView,toast,fail,features,busy});
const knowledge=initKnowledge({state,api,fail,toast});
projectGit=initProjectGit({state,api});
projectInstructions=initProjectInstructions({state,api,fail});
const openExternal=async value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol) || url.username || url.password)throw new Error('Only HTTP(S) links can be opened.');if(window.desktop?.openExternal)await window.desktop.openExternal(url.href);else window.open(url.href,'_blank','noopener,noreferrer');};
initWebSearch({state,api,saveDraft,features,renderRuntime,fail,openExternal});
initAttachmentMenu();
initHelp();
installFileHistory();
window.desktop?.onPrepareQuit?.(async()=>{if(state.data){saveDraft();clearTimeout(draftTimer);await flushDrafts();await draftQueue;}});
await refresh().catch(error => { fail(error); notice(`Could not connect: ${error.message}`); });
let polling=false;
setInterval(async () => {
  if (!state.data) return;
  if(polling || document.hidden && !state.sending) return; polling=true;
  try {
    const old = state.data.runtime.status; const result = await api('/api/runtime'); state.data.runtime = result; state.data.active = result.active;
    if (old !== result.status) { renderSidebar(); if (result.status === 'ready') toast('Your model is ready. Start a session to chat.'); if (result.status === 'error') toast(result.error, true); }
    renderRuntime();
    await features.tick(state.data);
    await journey?.tick();
    await knowledge.tick();
    if(queuedMessage && !queuePaused && !busy())void startQueue();
  } catch { /* Preserve the screen during a short connection interruption. */ } finally { polling=false; }
}, 2000);
