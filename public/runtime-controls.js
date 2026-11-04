export function initRuntimeControls(ctx,panel){
  const form=document.getElementById('runtime-form');
  // Keep each hardware setting in one form instead of duplicating it in Defaults.
  for(const key of ['gpuLayers','threads']){
    const duplicate=form.querySelector(`[data-setting="${key}"]`).closest('label');
    const original=document.getElementById(`setting-${key}`);original.dataset.setting=key;duplicate.replaceWith(original.closest('label'));
  }
  const path=document.getElementById('setting-runtimePath');path.dataset.setting='runtimePath';form.querySelector('.action-row').before(path.closest('label'));
  const advanced=document.createElement('details');advanced.id='runtime-advanced';advanced.className='runtime-advanced';const summary=document.createElement('summary');summary.textContent='Advanced runtime controls';advanced.append(summary);form.before(advanced);advanced.append(form);
  const backend=document.getElementById('runtime-backend');const label=document.createElement('label');label.textContent='Runtime build to install';label.append(backend);label.className='runtime-build-choice';advanced.append(label);
  const install=document.createElement('button');install.type='button';install.className='secondary-button';install.textContent='Install selected runtime';install.id='runtime-install-selected';install.onclick=()=>document.getElementById('install-runtime').click();advanced.append(install);
  const builds=[...panel.querySelectorAll('.settings-section')].find(node=>node.querySelector('h3')?.textContent==='Installed runtime builds');if(builds)advanced.append(builds);
  const technicalNote=[...panel.querySelectorAll('.feature-note')].find(node=>node.textContent.startsWith('Responsive mode disables'));if(technicalNote)advanced.append(technicalNote);advanced.append(document.getElementById('runtime-feature-log'));
  const status=document.createElement('p');status.id='runtime-choice-status';status.className='feature-note';const automatic=document.createElement('button');automatic.type='button';automatic.id='runtime-use-automatic';automatic.className='secondary-button';automatic.textContent='Use Automatic';advanced.before(status,automatic);
  automatic.onclick=async()=>{automatic.disabled=true;try{await ctx.api('/api/settings',{method:'PATCH',body:{executionMode:'auto'}});await ctx.refresh();ctx.toast('Automatic execution saved for the next model load.');}catch(error){ctx.fail(error);}finally{automatic.disabled=ctx.state.data?.settings.executionMode==='auto';}};
  return {render(data){const labels={auto:'Automatic · recommended',cpu:'CPU / RAM',gpu:'GPU / VRAM',hybrid:'Hybrid / RAM + VRAM'};const choice=labels[data.settings.executionMode] || 'Automatic';status.textContent=`Execution: ${choice}. Changes apply on the next model load.`;document.getElementById('quick-execution-label').textContent=`Execution: ${choice}`;automatic.hidden=data.settings.executionMode==='auto';install.disabled=document.getElementById('install-runtime').disabled;}};
}
