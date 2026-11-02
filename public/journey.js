const $=id=>document.getElementById(id);
const element=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};

export function initJourney(ctx) {
  const activity=element('details','activity-menu');activity.id='activity-menu';activity.innerHTML='<summary>Activity</summary><div class="activity-panel"><strong>Activity</strong><p>Downloads, conversion, and training appear here.</p><div id="activity-items"></div><button id="activity-refresh" type="button" class="secondary-button">Refresh</button></div>';
  document.querySelector('.topbar-actions').prepend(activity);
  const action=(label,run)=>{const button=element('button','text-button',label);button.type='button';button.onclick=async()=>{button.disabled=true;try{await run();await refreshActivity();}catch(error){ctx.fail(error);}finally{button.disabled=false;}};return button;};
  let activityRevision='';
  async function refreshActivity(){
    const data=await ctx.api('/api/activity');const revision=JSON.stringify([data.downloads,data.conversion.job?.status,data.conversion.job?.error,data.training.job?.status,data.training.job?.step,data.training.job?.error,data.runtime.status,data.knowledge,ctx.state.installing]);if(revision===activityRevision)return;activityRevision=revision;const list=$('activity-items');list.replaceChildren();
    const append=(title,detail,actions=[])=>{const row=element('div','activity-item');row.append(element('strong','',title),element('small','',detail));const buttons=element('div','activity-actions');for(const item of actions)buttons.append(item);row.append(buttons);list.append(row);};
    if(ctx.state.installing)append('Model setup','Installing the local model engine.');
    if(data.runtime.status==='loading')append('Loading model',data.runtime.phase || 'Preparing model');
    for(const job of data.downloads.filter(j=>j.status!=='cancelled')){const buttons=[];for(const [label,operation,states] of [['Pause','pause',['downloading']],['Resume','resume',['paused','error']],['Cancel','cancel',['downloading','paused','error','verifying']]])if(states.includes(job.status))buttons.push(action(label,()=>ctx.api('/api/downloads/control',{method:'POST',body:{id:job.id,action:operation}})));append(job.name,`${job.status} · ${(job.received/1024**3).toFixed(2)} / ${(job.bytes/1024**3).toFixed(2)} GiB${job.error ? ` · ${job.error}` : ''}`,buttons);}
    const conversion=data.conversion.job;if(conversion)append('Model conversion',`${conversion.status}${conversion.error ? ` · ${conversion.error}` : ''}`,data.conversion.active?[action('Cancel',()=>ctx.api('/api/model/cancel-conversion',{method:'POST',body:{}}))]:[]);
    const training=data.training.job;if(training){const buttons=[];for(const [label,operation,states] of [['Pause','pause',['running']],['Resume','resume',['paused','interrupted','error','cancelled']],['Cancel','cancel',['running','pausing','installing']]])if(states.includes(training.status))buttons.push(action(label,()=>ctx.api('/api/trainer/control',{method:'POST',body:{action:operation}})));append('Training',`${training.status}${training.step ? ` · step ${training.step}` : ''}${training.error ? ` · ${training.error}` : ''}`,buttons);}
    for(const job of data.knowledge || [])append('Project indexing',`${job.status} · ${job.path}${job.error ? ` · ${job.error}` : ''}`,job.status==='running'?[action('Cancel',()=>ctx.api('/api/knowledge/cancel',{method:'POST',body:{workspaceId:job.workspaceId}}))]:[]);
    if(!list.children.length)list.append(element('p','','Nothing running yet.'));
  }
  $('activity-refresh').onclick=()=>refreshActivity().catch(ctx.fail);activity.addEventListener('toggle',()=>{if(activity.open)refreshActivity().catch(ctx.fail);});
  const setup=element('details','getting-started'); setup.id='getting-started';
  setup.innerHTML=`<summary>Add a model <span>Choose the way you want to get started</span></summary><p>Use an existing model, find one to download, or connect a model already running on your computer.</p><div class="setup-choices"><button type="button" id="setup-files"><strong>Use my files</strong><small>Choose a folder containing GGUF models.</small></button><button type="button" id="setup-download"><strong>Find a model</strong><small>Search public Hugging Face models.</small></button><button type="button" id="setup-ollama"><strong>Connect Ollama</strong><small>Use models available in Ollama on this computer.</small></button><button type="button" id="setup-convert"><strong>Convert a model</strong><small>Turn a downloaded Hugging Face model into GGUF.</small></button></div><p id="setup-status" role="status"></p><div id="setup-results" class="setup-results"></div>`;
  document.querySelector('#models-view .runtime-banner').before(setup);
  const ollama=element('section','settings-section');ollama.id='ollama-models';ollama.hidden=true;ollama.innerHTML='<h3>Models in Ollama</h3><p class="feature-note">These models are managed by Ollama. Requests are sent to your local Ollama service; check the model source there if it uses a cloud model.</p><div id="ollama-model-list" class="feature-list"></div><button id="ollama-refresh" class="text-button" type="button">Refresh Ollama models</button>';document.querySelector('#model-list').after(ollama);
  let checkingOllama=false;let lastOllamaCheck=0;
  async function refreshOllama(){if(checkingOllama)return;checkingOllama=true;try{const result=await ctx.api('/api/ollama/models');lastOllamaCheck=Date.now();ollama.hidden=!result.available;const list=$('ollama-model-list');list.replaceChildren();if(!result.models.length)list.append(element('p','feature-note','No models found in Ollama.'));for(const model of result.models){const row=element('div','feature-row');const info=element('div','feature-row-info');info.append(element('strong','',model.id),element('small','',[model.bytes!==null ? `${(model.bytes/1024**3).toFixed(2)} GiB` : 'Size unknown',model.format,model.quantization].filter(Boolean).join(' · ')));const use=element('button','secondary-button','Use model');use.type='button';use.disabled=ctx.busy();use.onclick=async()=>{use.disabled=true;try{await ctx.api('/api/ollama/use',{method:'POST',body:{model:model.id}});await ctx.refresh();ctx.showView('chat');ctx.toast(`${model.id} is ready in Ollama.`);}catch(error){ctx.fail(error);}finally{use.disabled=false;}};row.append(info,use);list.append(row);}}catch{ollama.hidden=true;}finally{checkingOllama=false;}}
  $('ollama-refresh').onclick=()=>refreshOllama();
  $('setup-files').onclick=()=>{ $('change-model-folder').click(); };
  $('setup-download').onclick=()=>{
    const status=$('setup-status'),results=$('setup-results');results.replaceChildren();
    status.textContent='What would you like to do? Choose a starting point or search all models.';
    for(const [label,query] of [['General chat','instruct'],['Coding','coder'],['Documents','instruct'],['Images','vision'],['Reasoning','reasoning'],['Search all','']]) {
      const choice=element('button','secondary-button',label);choice.type='button';choice.onclick=()=>{ctx.showView('settings');ctx.features.selectSettings('explore');$('explore-query').value=query;if(query)$('explore-form').requestSubmit();$('explore-query').focus();};results.append(choice);
    }
  };
  $('setup-convert').onclick=()=>{ const conversion=$('model-conversion'); conversion.open=true; conversion.scrollIntoView({behavior:'smooth',block:'start'}); };
  $('setup-ollama').onclick=async()=>{
    const status=$('setup-status'),results=$('setup-results'); results.replaceChildren(); status.textContent='Connecting to Ollama on this computer…'; $('setup-ollama').disabled=true;
    try {
      const existing=ctx.state.data.connections.find(c=>c.base==='http://localhost:11434/v1' || c.base==='http://127.0.0.1:11434/v1');
      let id=existing?.id;
      if(!id) { const connections=await ctx.api('/api/connections',{method:'POST',body:{name:'Ollama on this computer',base:'http://127.0.0.1:11434/v1',key:'ollama'}}); id=connections.at(-1).id; }
      const models=await ctx.api('/api/connections/models',{method:'POST',body:{id}}); await ctx.refresh();
      status.textContent=models.length ? 'Choose an Ollama model to use:' : 'Ollama is running, but has no downloaded models yet.';
      for(const model of models) { const button=element('button','secondary-button',`Use ${model.id}`); button.type='button';button.onclick=async()=>{button.disabled=true;try{await ctx.api('/api/connections/use',{method:'POST',body:{id,model:model.id}});await ctx.refresh();ctx.showView('chat');ctx.toast(`${model.id} is ready to chat.`);}catch(error){ctx.fail(error);}finally{button.disabled=false;}};results.append(button); }
    } catch(error){status.textContent=`Could not connect. Start Ollama on this computer, then try again. ${error.message}`;} finally{$('setup-ollama').disabled=false;}
  };
  let initialized=false;
  return {render(data){if(!initialized && data){setup.open=!data.models.length && data.runtime.status!=='ready';initialized=true;}if(ctx.state.view==='models' && Date.now()-lastOllamaCheck>30000)void refreshOllama();},async tick(){if(activity.open)await refreshActivity();}};
}
