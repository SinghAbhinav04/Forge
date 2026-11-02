const $=id=>document.getElementById(id);
const element=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};

export function initJourney(ctx) {
  const activity=element('details','activity-menu');activity.id='activity-menu';activity.innerHTML='<summary>Activity</summary><div class="activity-panel"><strong>Activity</strong><p>Downloads, conversion, and training appear here.</p><div id="activity-items"></div><button id="activity-refresh" type="button" class="secondary-button">Refresh</button></div>';
  document.querySelector('.topbar-actions').prepend(activity);
  const action=(label,run)=>{const button=element('button','text-button',label);button.type='button';button.onclick=async()=>{button.disabled=true;try{await run();await refreshActivity();}catch(error){ctx.fail(error);}finally{button.disabled=false;}};return button;};
  let activityRevision='';
  async function refreshActivity(){
    const data=await ctx.api('/api/activity');const revision=JSON.stringify([data.downloads,data.conversion.job?.status,data.conversion.job?.error,data.training.job?.status,data.training.job?.step,data.training.job?.error,data.runtime.status,ctx.state.installing]);if(revision===activityRevision)return;activityRevision=revision;const list=$('activity-items');list.replaceChildren();
    const append=(title,detail,actions=[])=>{const row=element('div','activity-item');row.append(element('strong','',title),element('small','',detail));const buttons=element('div','activity-actions');for(const item of actions)buttons.append(item);row.append(buttons);list.append(row);};
    if(ctx.state.installing)append('Model setup','Installing the local model engine.');
    if(data.runtime.status==='loading')append('Loading model',data.runtime.phase || 'Preparing model');
    for(const job of data.downloads.filter(j=>j.status!=='cancelled')){const buttons=[];for(const [label,operation,states] of [['Pause','pause',['downloading']],['Resume','resume',['paused','error']],['Cancel','cancel',['downloading','paused','error','verifying']]])if(states.includes(job.status))buttons.push(action(label,()=>ctx.api('/api/downloads/control',{method:'POST',body:{id:job.id,action:operation}})));append(job.name,`${job.status} · ${(job.received/1024**3).toFixed(2)} / ${(job.bytes/1024**3).toFixed(2)} GiB${job.error ? ` · ${job.error}` : ''}`,buttons);}
    const conversion=data.conversion.job;if(conversion)append('Model conversion',`${conversion.status}${conversion.error ? ` · ${conversion.error}` : ''}`,data.conversion.active?[action('Cancel',()=>ctx.api('/api/model/cancel-conversion',{method:'POST',body:{}}))]:[]);
    const training=data.training.job;if(training){const buttons=[];for(const [label,operation,states] of [['Pause','pause',['running']],['Resume','resume',['paused','interrupted','error','cancelled']],['Cancel','cancel',['running','pausing','installing']]])if(states.includes(training.status))buttons.push(action(label,()=>ctx.api('/api/trainer/control',{method:'POST',body:{action:operation}})));append('Training',`${training.status}${training.step ? ` · step ${training.step}` : ''}${training.error ? ` · ${training.error}` : ''}`,buttons);}
    if(!list.children.length)list.append(element('p','','Nothing running yet.'));
  }
  $('activity-refresh').onclick=()=>refreshActivity().catch(ctx.fail);activity.addEventListener('toggle',()=>{if(activity.open)refreshActivity().catch(ctx.fail);});
  const setup=element('details','getting-started'); setup.id='getting-started';
  setup.innerHTML=`<summary>Add a model <span>Choose the way you want to get started</span></summary><p>Use an existing model, find one to download, or connect a model already running on your computer.</p><div class="setup-choices"><button type="button" id="setup-files"><strong>Use my files</strong><small>Choose a folder containing GGUF models.</small></button><button type="button" id="setup-download"><strong>Find a model</strong><small>Search public Hugging Face models.</small></button><button type="button" id="setup-ollama"><strong>Connect Ollama</strong><small>Use models available in Ollama on this computer.</small></button><button type="button" id="setup-convert"><strong>Convert a model</strong><small>Turn a downloaded Hugging Face model into GGUF.</small></button></div><p id="setup-status" role="status"></p><div id="setup-results" class="setup-results"></div>`;
  document.querySelector('#models-view .runtime-banner').before(setup);
  $('setup-files').onclick=()=>{ $('change-model-folder').click(); };
  $('setup-download').onclick=()=>{ ctx.showView('settings');ctx.features.selectSettings('explore'); };
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
  return {render(data){if(!initialized && data){setup.open=!data.models.length && data.runtime.status!=='ready';initialized=true;}},async tick(){if(activity.open)await refreshActivity();}};
}
