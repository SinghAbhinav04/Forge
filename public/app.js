import { initFeatures } from './features.js';
const $ = id => document.getElementById(id);
const node = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
const token = location.hash.slice(1) || sessionStorage.getItem('local-desk-token') || '';
if (token) { sessionStorage.setItem('local-desk-token', token); history.replaceState(null, '', location.pathname); }
const state={ data:null,workspaceId:null,sessionId:null,view:'chat',scope:'chat',lastSessions:{chat:null,workspace:null},drafts:new Map(),sessionPrompt:null,navVersion:0,loadingSession:null,run:null,notices:new Map(),folder:'.',file:null,dirty:false,preview:false,sending:false,installing:false,filesVisible:innerWidth>=1000,images:[] };
const welcome = $('welcome');
const setupHint = $('setup-hint');
const workspaceIntro=node('div'); while(welcome.firstChild) workspaceIntro.append(welcome.firstChild);
const chatIntro=node('div'); chatIntro.innerHTML='<div class="eyebrow"><span class="dot"></span> YOUR MODELS. YOUR CONVERSATION.</div><h1>What’s on<br><em>your mind?</em></h1><p>Ask a question, explore an idea, or just talk.<br>Your conversation stays on this computer.</p><div class="suggestions"><button data-prompt="Explain something interesting about the night sky."><span>✧</span><strong>Learn something</strong><small>Follow your curiosity ↗</small></button><button data-prompt="Help me brainstorm a creative weekend project."><span>✎</span><strong>Explore an idea</strong><small>Find a fresh perspective ↗</small></button><button data-prompt="Let’s have a casual conversation."><span>◌</span><strong>Just chat</strong><small>Start a conversation ↗</small></button></div>';
welcome.append(chatIntro,workspaceIntro,setupHint); $('mode').hidden=true;
const conversationType=node('span','conversation-type','Chat'); conversationType.id='conversation-type'; $('mode').before(conversationType);
const generationBanner=node('div','generation-banner');generationBanner.id='generation-banner';generationBanner.hidden=true;const generationLabel=node('span');const viewGeneration=node('button','text-button','View reply');viewGeneration.id='view-generating';const stopGeneration=node('button','text-button','Stop');stopGeneration.id='stop-generating';generationBanner.append(generationLabel,viewGeneration,stopGeneration);document.querySelector('.topbar').after(generationBanner);
viewGeneration.onclick=()=>{const id=state.run?.current?.id||state.data?.active;if(id)selectSession(id).catch(fail);};stopGeneration.onclick=()=>$('stop-task').click();
let features;
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
function saveDraft(){state.drafts.set(draftKey(),{text:$('prompt').value,images:state.images,systemPrompt:state.sessionPrompt});}
function loadDraft(){const d=state.drafts.get(draftKey());$('prompt').value=d?.text||'';state.images=d?.images||[];state.sessionPrompt=d?d.systemPrompt:session()?.systemPrompt??null;features?.renderImages();}
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
    if (/^\s*```/.test(line)) { const code = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); i++; const pre = node('pre'); pre.append(node('code', '', code.join('\n'))); target.append(pre); continue; }
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
  for (const name of ['workspace','models','settings','trainer']) $(`${name}-view`).hidden=name==='workspace' ? !['chat','workspace'].includes(view) : name!==view;
  document.querySelectorAll('[data-view]').forEach(e => e.classList.toggle('active', e.dataset.view === view));
  $('page-title').textContent=['chat','workspace'].includes(view) ? session()?.title || (state.scope==='chat' ? 'New chat' : 'New workspace session') : view==='models' ? 'Model library' : view==='trainer' ? 'Trainer' : 'Settings';
  $('workspace-view').classList.toggle('chat-mode',state.scope==='chat'); chatIntro.hidden=state.scope!=='chat'; workspaceIntro.hidden=state.scope!=='workspace';
  $('mode').value=state.scope==='chat' ? 'chat' : 'agent'; conversationType.textContent=state.scope==='chat' ? 'Chat' : 'Workspace agent';
  $('prompt').placeholder=state.scope==='chat' ? 'Message Forge…' : 'What would you like to work on?';
  document.querySelector('.composer-caption').firstElementChild.textContent=state.scope==='chat' ? 'Local inference · general conversation' : 'Local inference · writes need your review';
  if (view === 'models') renderModels();
  if (view === 'settings') fillSettings();
  if (state.data) features?.render(state.data);
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
  const sessions=state.data.sessions.filter(s => kind(s)===state.scope && (state.scope==='chat' || s.workspaceId===state.workspaceId) && !s.archived).sort((a,b) => b.updated-a.updated);
  $('session-count').textContent = sessions.length || '';
  $('sessions').replaceChildren();
  if (!sessions.length) $('sessions').append(node('div', 'empty-sessions', 'A fresh start.\nYour conversations will appear here.'));
  for (const s of sessions) {
    const row = node('div', `session-row${s.id === state.sessionId ? ' active' : ''}`);
    const b = node('button'); b.append(node('span', '', '◌'), node('span', 'session-title', s.title)); b.title = s.title;if(s.id===generatingId())b.append(node('small','session-generating','Generating…'));
    b.onclick=() => selectSession(s.id).catch(fail);
    const del = node('button', 'delete-session', '×'); del.title = 'Delete session'; del.setAttribute('aria-label', `Delete ${s.title}`); del.disabled = s.id===generatingId();
    del.onclick=async()=>{if(!confirm(`Delete “${s.title}” and its saved conversation? Project files will remain.`))return;try{await api('/api/session/delete',{method:'POST',body:{id:s.id}});state.data.sessions=state.data.sessions.filter(x=>x.id!==s.id);state.drafts.delete(s.id);state.notices.delete(s.id);if(state.sessionId===s.id){state.navVersion++;state.sessionId=null;state.drafts.delete(draftKey());loadDraft();await rememberSelection();}renderSidebar();renderMessages();showView(state.view);renderRuntime();}catch(error){fail(error);}};
    row.append(b, del); $('sessions').append(row);
  }
  $('project-label').textContent = state.scope==='chat' ? 'Chat' : project()?.name || 'Workspace'; $('workspace-path').textContent = project()?.path || ''; $('workspace-path').title = project()?.path || '';
  $('workspaces').hidden=state.scope==='chat'; $('workspaces').previousElementSibling.hidden=state.scope==='chat';
  $('session-count').parentElement.firstChild.textContent=state.scope==='chat' ? 'CHATS ' : 'SESSIONS ';
  $('new-session').childNodes[1].textContent=state.scope==='chat' ? ' New chat ' : ' New session ';
  $('new-session').disabled=false;$('add-workspace').disabled=false;$('mode').disabled=busy();
}
function renderRuntime() {
  const r = state.data.runtime; const isBusy = busy();
  const name = shortModel(r.model?.name);
  $('runtime-label').textContent = r.status === 'loading' ? 'Loading model…' : r.status === 'error' ? 'Runtime needs attention' : name;
  $('active-model-label').textContent = r.model ? `${r.status === 'loading' ? 'Loading · ' : ''}${name}` : 'Choose a model';
  $('composer-model').textContent = name;
  $('runtime-dot').className = `dot ${r.status === 'ready' ? '' : r.status === 'loading' ? 'loading' : r.status === 'error' ? 'error' : 'muted'}`;
  $('hardware-label').textContent = `${state.data.hardware.ramGiB.toFixed(0)} GB RAM · ${r.status === 'ready' ? 'Ready' : r.status === 'stopped' ? 'Idle' : r.status}`;
  $('send').disabled=r.status!=='ready'||isBusy||Boolean(state.loadingSession)||(!$('prompt').value.trim()&&!state.images.length);$('send').hidden=visibleRun();
  $('attach-image').disabled=Boolean(state.loadingSession);$('attach-image').title='Attach, paste or drop an image. Vision setup is available if needed.';
  $('stop-task').hidden=!state.sending&&!state.data.active;$('prompt').disabled=Boolean(state.loadingSession);
  generationBanner.hidden=!isBusy;const activeTitle=state.run?.current?.title||state.data.sessions.find(s=>s.id===state.data.active)?.title;
  generationLabel.textContent=activeTitle?`${state.run?.approvals.size?'Waiting for approval':'Generating'} in “${activeTitle}”. You can browse chats and prepare your next message.`:'The model is working. You can browse chats and prepare your next message.';
  viewGeneration.hidden=!generatingId()||generatingId()===state.sessionId;stopGeneration.hidden=!state.sending&&!state.data.active;features?.renderComposer();
  $('model-count').textContent = state.data.models.length;
  $('runtime-logs').textContent = r.logs?.join('\n') || 'No runtime output yet.';
  $('unload-model').disabled=!r.model || isBusy || r.status==='stopping';
  $('unload-model').textContent=r.status==='loading' ? 'Cancel loading' : 'Unload model';
  $('install-runtime').disabled = state.installing || isBusy || ['loading', 'ready', 'stopping'].includes(r.status);
  $('install-runtime').hidden=false;
  $('runtime-backend').disabled=$('install-runtime').disabled;
  $('library-runtime-status').textContent = r.status === 'ready' ? 'Model ready' : r.status === 'loading' ? 'Loading your model…' : r.status === 'error' ? 'Runtime needs attention' : state.data.runtimeInstalled ? 'llama.cpp is installed' : 'One quick setup step';
  $('library-runtime-detail').textContent=r.error || (r.status==='loading' ? `${r.phase || 'Loading'} · ${Math.floor((Date.now()-r.started)/1000)}s · you can cancel loading or keep using the editor.` : state.installing ? 'Downloading the official runtime from GitHub…' : state.data.runtimeInstalled ? `${r.vision ? 'Vision + text' : 'Text'} inference · ${state.data.executable}` : 'Install a runtime, or choose your own llama-server executable in Settings.');
  $('models-folder').textContent = state.data.modelError || state.data.settings.modelDir;
  const hint = setupHint; hint.replaceChildren();
  if (r.status !== 'ready') { hint.append(document.createTextNode(r.status === 'loading' ? 'Your model is loading. ' : 'Ready when you are. ')); const b = node('button', '', state.data.runtimeInstalled ? 'Choose a local model ↗' : 'Set up local inference ↗'); b.onclick = () => showView('models'); hint.append(b); }
  if (state.view === 'models') renderModels();
}
function renderModels() {
  $('model-list').replaceChildren();
  if (!state.data.models.length) $('model-list').append(node('div', 'empty-state', 'No GGUF models found. Point Settings to a folder containing your .gguf files, then refresh this library.'));
  for (const model of state.data.models) {
    const active = state.data.runtime.model?.path === model.path;
    const card = node('div', 'model-card'); const info = node('div', 'model-card-info'); info.append(node('strong', '', model.name));
    const meta = node('small'); meta.append(node('span', '', 'GGUF'), document.createTextNode(`${(model.bytes / 1024 ** 3).toFixed(2)} GiB · ${active ? state.data.runtime.status : 'On this device'}`)); info.append(meta);
    const load = node('button', active ? 'secondary-button' : 'primary-button', active ? state.data.runtime.status === 'loading' ? 'Loading…' : 'Loaded' : 'Load model');
    load.disabled = active || busy() || ['loading', 'stopping'].includes(state.data.runtime.status) || !state.data.runtimeInstalled;
    load.onclick = async () => { load.disabled = true; try { state.data.runtime = await api('/api/model/load', { method: 'POST', body: { path: model.path } }); renderRuntime(); toast('Loading model. Progress is shown in the runtime logs.'); } catch (error) { fail(error); renderModels(); } };
    card.append(node('div', 'model-symbol', '◈'), info, load); $('model-list').append(card);
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
  if (message.tool_calls) for (const call of message.tool_calls) {
    const details = node('details', 'tool-event'); details.append(node('summary', '', `↳ ${call.function.name}`), node('pre', '', call.function.arguments)); wrap.append(details);
  }
  return wrap;
}
function renderMessages() {
  const messages = session()?.messages || [];
  $('messages').replaceChildren(); $('task-notice').hidden = true;
  if (!messages.length) $('messages').append(welcome);
  for (const m of messages) {
    if (m.role === 'tool') {
      const details = node('details', 'tool-event'); details.append(node('summary', '', `✓ ${m.name || 'Tool'} result`), node('pre', '', m.content)); $('messages').append(details);
    } else $('messages').append(messageElement(m));
  }
  if(visibleRun())for(const approval of state.run.approvals.values())approvalCard(approval);
  if(state.notices.has(state.sessionId))notice(state.notices.get(state.sessionId));
  $('page-title').textContent = ['chat','workspace'].includes(state.view) ? session()?.title || (state.scope==='chat' ? 'New chat' : 'New workspace session') : $('page-title').textContent;
  scrollToBottom();
}
function scrollToBottom() { $('messages').scrollTop = $('messages').scrollHeight; }
function notice(message) { $('task-notice').textContent = message; $('task-notice').hidden = false; }
async function newSession() {
  saveDraft();state.navVersion++;state.loadingSession=null;state.sessionId=null;state.drafts.delete(draftKey());loadDraft();state.lastSessions[state.scope]=null;showView(state.scope);renderSidebar();renderMessages();renderRuntime();$('prompt').focus();
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
  state.sessionId=id;loadDraft();showView(state.scope);renderSidebar();renderMessages();renderRuntime();await rememberSelection();
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
  if (!clean()) return;
  try { state.file = await api(`/api/file?workspaceId=${encodeURIComponent(state.workspaceId)}&path=${encodeURIComponent(path)}`); state.dirty = false; state.preview = false; renderEditor(); refreshFiles(); } catch (error) { fail(error); }
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
  try { state.file = await api('/api/file', { method: 'PUT', body: { workspaceId: state.workspaceId, ...state.file } }); state.dirty = false; renderEditor(); await refreshFiles(); toast('Document saved.'); } catch (error) { fail(error); }
}
const settingKeys = ['modelDir', 'runtimePath', 'contextSize', 'gpuLayers', 'threads', 'temperature', 'maxTokens', 'systemPrompt'];
function fillSettings() { for (const key of settingKeys) $(`setting-${key}`).value = state.data.settings[key]; }
async function refresh() {
  const previous = state.data;
  state.data = await api('/api/bootstrap');
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
  const card=node('div','approval'); card.append(node('div','approval-title',`${event.kind==='mcp' ? 'Review external MCP tool call' : event.exists ? 'Review file replacement' : 'Review new document'} · ${event.path}`),node('p','',event.description || 'The agent is waiting. Applying this proposal writes the following content to your project.'));
  const columns = node('div', 'proposal-columns');
  for (const [label, value] of [['Before', event.before || '(new file)'], ['After', event.after]]) { const col = node('div', 'proposal-column'); col.append(node('span', '', label), node('pre', '', value)); columns.append(col); }
  const actions=node('div','approval-actions'); const yes=node('button','primary-button',event.kind==='mcp' ? 'Run external tool' : 'Apply write'); const no=node('button','secondary-button','Decline');
  for (const [button, accept] of [[yes, true], [no, false]]) button.onclick = async () => {
    yes.disabled = true; no.disabled = true;
    try { await api('/api/approval', { method: 'POST', body: { id: event.id, accept } });pendingRun?.approvals.delete(event.id);renderRuntime(); actions.append(node('span', '', accept ? 'Approved · waiting for save result' : 'Declined')); }
    catch (error) { fail(error); actions.append(node('span', '', 'Proposal is no longer active.')); }
  };
  actions.append(yes, no); card.append(columns, actions); $('messages').append(card); scrollToBottom();
}
async function* events(body) {
  const decoder = new TextDecoder(); let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }); buffer = buffer.replaceAll('\r\n', '\n'); let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) { const block = buffer.slice(0, index); buffer = buffer.slice(index + 2); const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n'); if (data) yield JSON.parse(data); }
  }
}
async function send(event) {
  event.preventDefault(); const text=$('prompt').value.trim() || (state.images.length ? 'Describe the attached image.' : '');
  if(!text||state.loadingSession)return;if(busy()){toast('The model is generating another reply. You can prepare this message and send it when that reply finishes.');return;}
  if((state.images.length||session()?.messages?.some(m=>m.images?.length))&&!state.data.runtime.vision&&state.data.runtime.source!=='remote'){await features.visionSetup();return;}
  if (state.data.runtime.status !== 'ready') { toast('Load a model in the Models tab first.', true); showView('models'); return; }
  const scope=state.scope;const workspaceId=state.workspaceId;const originTicket=state.navVersion;const images=state.images;const systemPrompt=state.sessionPrompt;const mode=scope==='chat'?'chat':'agent';
  const run={current:session()||null,originTicket,approvals:new Map(),notice:'',controller:new AbortController(),accepted:false};state.run=run;
  state.sending=true;$('task-notice').hidden=true;$('prompt').value='';state.images=[];saveDraft();features.renderImages();showView(state.scope);
  renderSidebar(); renderRuntime();
  let current=run.current;
  try {
    if(!current){current=await api('/api/sessions',{method:'POST',body:{kind:scope,workspaceId:scope==='workspace'?workspaceId:null,systemPrompt}});run.current=current;state.data.sessions.unshift(current);if(originTicket===state.navVersion){state.sessionId=current.id;saveDraft();}}
    state.notices.delete(current.id);if(originTicket===state.navVersion)await rememberSelection();renderSidebar();renderRuntime();
    const response=await fetch('/api/chat',{ method:'POST',headers:{ 'Content-Type':'application/json','X-Local-Desk-Token':token },body:JSON.stringify({ sessionId:current.id,text,mode,images }),signal:run.controller.signal });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
    run.accepted=true;
    for await (const event of events(response.body)) {
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
      const nearBottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 160;
      if (event.type === 'session') { Object.assign(current, event.session); renderSidebar(); renderMessages(); }
      else if (event.type === 'message') { current.messages.push(event.message); $('messages').append(messageElement(event.message, true)); }
      else if (event.type === 'delta' || event.type === 'reasoning') {
        const m = current.messages.find(m => m.id === event.id); if (!m) continue;
        const article = document.querySelector(`[data-message-id="${event.id}"]`);
        if (event.type === 'delta') { m.content += event.content; if (article) article.querySelector('.message-body').textContent = m.content; }
        else { m.reasoning += event.content; if (article) { let details = article.querySelector('.reasoning'); if (!details) { details = node('details', 'reasoning'); details.append(node('summary', '', 'Model reasoning'), node('div')); article.querySelector('.message-body').before(details); } details.querySelector('div').textContent = m.reasoning; } }
      } else if (event.type === 'tool') {
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
  } catch(error){const message=error.name==='AbortError'?'Task stopped.':error.message;run.notice=message;if(current)state.notices.set(current.id,message);if(visibleRun()){fail(message);notice(message);}else toast(message,true);if(!run.accepted&&current){state.drafts.set(current.id,{text,images,systemPrompt});if(state.sessionId===current.id)loadDraft();}}
  finally {
    const wasVisible=visibleRun();state.sending=false;if(state.run===run)state.run=null;
    try { await refresh();
      renderMessages();if(!wasVisible&&current&&!run.notice)toast(`Reply finished in “${current.title}”.`);
    } catch (error) { fail(error); }
    renderSidebar();renderRuntime();refreshFiles();if(wasVisible)$('prompt').focus();
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
$('prompt').oninput = () => { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min(220, $('prompt').scrollHeight)}px`; renderRuntime(); };
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
  for (const key of settingKeys) { const field = $(`setting-${key}`); values[key] = field.type === 'number' ? Number(field.value) : field.value; }
  try { state.data.settings = await api('/api/settings', { method: 'PATCH', body: values }); await refresh(); $('settings-saved').textContent = 'Saved. Reload the model for hardware changes.'; toast('Settings saved.'); } catch (error) { fail(error); }
};
$('install-runtime').onclick = async () => {
  state.installing = true; renderRuntime();
  try { await api('/api/runtime/install',{ method:'POST',body:{ backend:$('runtime-backend').value } }); await refresh(); toast('llama.cpp installed. Choose a GGUF model to load.'); }
  catch (error) { fail(error); }
  finally { state.installing = false; renderRuntime(); }
};
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newSession(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); } });
window.addEventListener('beforeunload', e => { if (state.dirty || state.sending) { e.preventDefault(); e.returnValue = ''; } });
features=initFeatures({ state,api,refresh,showView,session,busy,toast,fail,askPath,selectSession,newSession,token,renderRuntime,saveDraft });
await refresh().catch(error => { fail(error); notice(`Could not connect: ${error.message}`); });
setInterval(async () => {
  if (!state.data) return;
  try {
    const old = state.data.runtime.status; const result = await api('/api/runtime'); state.data.runtime = result; state.data.active = result.active;
    if (old !== result.status) { renderSidebar(); if (result.status === 'ready') toast('Your model is ready. Start a session to chat.'); if (result.status === 'error') toast(result.error, true); }
    renderRuntime();
    await features.tick(state.data);
  } catch { /* Preserve the screen during a short connection interruption. */ }
}, 2000);
