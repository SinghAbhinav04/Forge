const $=id=>document.getElementById(id);
const wait=()=>new Promise(resolve=>setTimeout(resolve,700));
export function initLoraUse(ctx){
  const dialog=document.createElement('dialog');dialog.className='forge-dialog';dialog.id='lora-use-dialog';
  dialog.innerHTML='<form id="lora-use-form"><h3 id="lora-use-title">Use this LoRA</h3><p>Choose the GGUF made from the exact base weights used for training. Architecture alone cannot prove a match. Forge will unload the current model if needed, convert the adapter, then load and activate it. Memory checks stay enabled.</p><p id="lora-use-source" class="block-path"></p><label>Matching GGUF base<select id="lora-use-base" required></select></label><label class="toggle-row"><span>I confirm this is the exact base for this adapter</span><input id="lora-use-confirm" type="checkbox"></label><label class="toggle-row"><span>Keep other selected adapters for this base</span><input id="lora-use-keep" type="checkbox" checked></label><p id="lora-use-status" class="feature-note" role="status" aria-live="polite"></p><div class="dialog-actions"><button id="lora-use-cancel" type="button" class="secondary-button">Close</button><button id="lora-use-start" type="submit" class="primary-button" disabled>Use this LoRA</button><button id="lora-use-chat" type="button" class="primary-button" hidden>Start chatting</button></div></form>';
  document.body.append(dialog);let selected=null,running=false,cancelled=false,ownConversion=false,ownLoad=false,chosenBase='';
  const update=()=>{$('lora-use-start').disabled=running || !$('lora-use-confirm').checked || !$('lora-use-base').value;};
  $('lora-use-confirm').onchange=update;$('lora-use-base').onchange=()=>{$('lora-use-confirm').checked=false;update();};
  const ensure=()=>{if(cancelled)throw new Error('Setup cancelled. Completed adapter files were kept.');};
  const status=text=>{$('lora-use-status').textContent=text;};
  function close(){if(running){cancelled=true;status('Stopping after the current setup step…');$('lora-use-cancel').disabled=true;}else dialog.close();}
  $('lora-use-cancel').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('lora-use-chat').onclick=()=>{dialog.close();ctx.showView('chat');};
  $('lora-use-form').onsubmit=async event=>{
    event.preventDefault();if(running || !selected || !$('lora-use-confirm').checked || !$('lora-use-base').value)return;
    running=true;cancelled=false;ownConversion=false;ownLoad=false;chosenBase=$('lora-use-base').value;
    for(const id of ['lora-use-base','lora-use-confirm','lora-use-keep'])$(id).disabled=true;
    $('lora-use-cancel').textContent='Cancel setup';update();
    try{
      const training=await ctx.api('/api/trainer');if(['running','pausing','installing','resuming'].includes(training.job?.status))throw new Error('Stop training before loading an adapter.');
      const library=await ctx.api('/api/adapters');let adapter=library.adapters.find(a=>a.id===selected.id);if(!adapter)throw new Error('This adapter is no longer in your library.');
      let runtime=await ctx.api('/api/runtime');ensure();if(runtime.busy || ctx.busy())throw new Error('Stop the current response before using an adapter.');
      const needsConversion=!adapter.ggufPath || adapter.baseGguf!==chosenBase;
      if(needsConversion && !adapter.baseModel)throw new Error('This imported adapter must use its recorded GGUF base. Choose that base in your model library.');
      const canReuse=!needsConversion && runtime.status==='ready' && runtime.source==='local' && runtime.model?.path===chosenBase && runtime.adapters?.some(a=>a.id===adapter.id);
      if(!canReuse && ['loading','ready','error'].includes(runtime.status)){status('1 / 3 · Unloading the current model…');await ctx.api('/api/model/unload',{method:'POST',body:{}});ensure();}
      if(needsConversion){status('1 / 3 · Converting the adapter to GGUF. First use may download converter tools.');await ctx.api('/api/adapters/convert',{method:'POST',body:{id:adapter.id,baseGguf:chosenBase}});ownConversion=true;ensure();const deadline=Date.now()+30*60_000;
        for(;;){ensure();const value=await ctx.api('/api/adapters');adapter=value.adapters.find(a=>a.id===selected.id);if(!adapter)throw new Error('The adapter was removed.');if(adapter.conversion?.status==='completed' && adapter.ggufPath && adapter.baseGguf===chosenBase)break;if(['error','cancelled','interrupted'].includes(adapter.conversion?.status))throw new Error(adapter.conversion.error || 'Adapter conversion stopped.');if(Date.now()>deadline)throw new Error('Conversion is taking too long. Cancel it from the adapter library before retrying.');await wait();}
        ownConversion=false;
      }
      ensure();status('2 / 3 · Selecting the adapter…');
      const current=await ctx.api('/api/adapters');const keep=$('lora-use-keep').checked;const prior=current.stack.find(item=>item.id===adapter.id);
      const items=current.stack.filter(item=>item.id!==adapter.id && (keep || current.adapters.find(a=>a.id===item.id)?.baseGguf!==chosenBase));items.push({id:adapter.id,scale:prior?.scale>0?prior.scale:1});
      const applied=await ctx.api('/api/adapters/stack',{method:'POST',body:{items}});ensure();
      if(!canReuse || applied.reloadRequired){
        runtime=await ctx.api('/api/runtime');if(['ready','loading','error'].includes(runtime.status))await ctx.api('/api/model/unload',{method:'POST',body:{}});ensure();
        const data=await ctx.api('/api/bootstrap');if(!data.runtimeInstalled){status('2 / 3 · Installing the automatic inference runtime…');await ctx.api('/api/runtime/install',{method:'POST',body:{backend:'auto'}});ensure();}
        status('2 / 3 · Loading the base model and adapter…');await ctx.api('/api/model/load',{method:'POST',body:{path:chosenBase}});ownLoad=true;ensure();
      }
      const deadline=Date.now()+6*60_000;
      for(;;){ensure();runtime=await ctx.api('/api/runtime');if(runtime.model?.path!==chosenBase)throw new Error('The selected model changed during setup. Retry with the matching base.');if(runtime.status==='error')throw new Error(runtime.error || 'Model loading failed.');if(runtime.status==='ready'){if(!runtime.adapters?.some(a=>a.id===adapter.id && a.scale>0))throw new Error('The model did not report this adapter as active. Reload the matching base.');break;}if(runtime.status==='stopped' || Date.now()>deadline)throw new Error('Model loading stopped. Review available memory and try again.');await wait();}
      ownLoad=false;status(`3 / 3 · ${adapter.name} is active. Ready to chat.`);$('lora-use-start').hidden=true;$('lora-use-chat').hidden=false;ctx.toast('LoRA active. Your base model file is unchanged.');
    }catch(error){status(cancelled?'Stopping setup…':error.message);}
    finally{
      if(cancelled){const errors=[];try{if(ownConversion)await ctx.api('/api/adapters/cancel-convert',{method:'POST',body:{id:selected.id}});}catch(error){if(!/No active conversion/i.test(error.message))errors.push(error.message);}
        try{if(ownLoad){const r=await ctx.api('/api/runtime');if(r.model?.path===chosenBase)await ctx.api('/api/model/unload',{method:'POST',body:{}});}}catch(error){errors.push(error.message);}status(errors.length?`Cancellation needs attention. Check Activity / Models: ${errors.join(' ')}`:'Setup cancelled. Completed adapter files and your selection were kept.');}
      running=false;for(const id of ['lora-use-base','lora-use-confirm','lora-use-keep'])$(id).disabled=false;$('lora-use-cancel').disabled=false;$('lora-use-cancel').textContent='Close';update();try{await ctx.refresh();}catch(error){ctx.fail(error);}
    }
  };
  return {open(adapter){if(running)return;selected=adapter;$('lora-use-title').textContent=`Use ${adapter.name}`;$('lora-use-source').textContent=adapter.baseModel?`Trained from: ${adapter.baseModel}`:'Imported GGUF adapter. Use the exact base recorded for this adapter.';$('lora-use-base').replaceChildren(new Option('Choose the exact GGUF base…',''));for(const model of ctx.state.data.models){if(!adapter.baseModel && adapter.baseGguf!==model.path)continue;$('lora-use-base').add(new Option(model.name,model.path));}if(ctx.state.data.models.some(m=>m.path===adapter.baseGguf))$('lora-use-base').value=adapter.baseGguf;$('lora-use-confirm').checked=false;$('lora-use-keep').checked=true;$('lora-use-start').hidden=false;$('lora-use-chat').hidden=true;status(ctx.state.data.models.length?'Choose and confirm the matching base.':'Add the matching GGUF base to Models first.');update();dialog.showModal();}};
}
