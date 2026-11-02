const $=id => document.getElementById(id);

export function initModelConversion(ctx) {
  const section=document.createElement('details'); section.className='model-conversion'; section.id='model-conversion';
  section.innerHTML=`<summary>Convert a Hugging Face model to GGUF</summary>
    <p class="feature-note">Choose a downloaded model folder containing its config, tokenizer, and weights. The converted model will be added to your library. Original files are kept.</p>
    <form id="model-conversion-form" class="feature-form">
      <label>Hugging Face model folder<div class="input-row"><input id="convert-source" required placeholder="Folder containing config.json and model weights"><button id="convert-browse" type="button" class="secondary-button">Browse</button></div></label>
      <div class="settings-grid"><label>Model name (optional)<input id="convert-name" maxlength="100" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*" placeholder="Use the source folder name"></label>
      <label>Output format<select id="convert-format"><option value="q8_0">Q8_0 · 8-bit, smaller file</option><option value="Q4_K_M">Q4_K_M · 4-bit, compact</option><option value="Q5_K_M">Q5_K_M · 5-bit</option><option value="Q6_K">Q6_K · 6-bit</option><option value="f16">F16 · 16-bit, larger file</option><option value="bf16">BF16 · 16-bit</option></select></label></div>
      <small class="feature-note">First use downloads llama.cpp conversion tools and Python dependencies into a separate environment. Requires Python 3.10+. Q4/Q5/Q6 also need llama-quantize from an installed llama.cpp runtime and extra disk space for an intermediate model. Supported architectures depend on llama.cpp. Vision projectors are configured separately.</small>
      <p id="convert-destination" class="block-path"></p>
      <div class="action-row"><button id="convert-preview" class="secondary-button" type="button">Check requirements</button><button id="convert-start" class="primary-button" type="submit">Convert to GGUF</button><button id="convert-cancel" class="secondary-button" type="button" hidden>Cancel conversion</button><button id="convert-load" class="secondary-button" type="button" hidden>Load converted model</button></div><p id="convert-estimate" class="feature-note" role="status"></p>
    </form>
    <p id="convert-status" class="feature-note" role="status" aria-live="polite"></p>
    <progress id="convert-progress" aria-label="Model conversion in progress" hidden></progress>
    <details id="convert-log-details" hidden><summary>Conversion logs</summary><pre id="convert-logs" class="feature-log"></pre></details>`;
  document.querySelector('.library-heading').before(section);
  let value={ active:false,job:null }; let submitting=false; let completedId; let validationError='';
  $('convert-browse').onclick=async () => {
    try { const folder=window.desktop ? await window.desktop.chooseFolder() : await ctx.askPath('Hugging Face model folder','Enter the absolute path to the complete downloaded model folder.',$('convert-source').value); if (folder) $('convert-source').value=folder; } catch (error) { ctx.fail(error); }
  };
  $('convert-preview').onclick=async()=>{const status=$('convert-estimate');status.textContent='Checking your source and available space…';try{const result=await ctx.api('/api/model/conversion/preview',{method:'POST',body:{source:$('convert-source').value,name:$('convert-name').value,format:$('convert-format').value}});status.textContent=`Source: ${(result.sourceBytes/1024**3).toFixed(2)} GiB · Suggested free disk space: ${(result.temporaryBytes/1024**3).toFixed(2)} GiB · Available system RAM after reserve: ${result.availableRamGiB.toFixed(1)} GiB.\nSuggested starting format: ${result.recommended.toUpperCase()}. ${result.note}`;}catch(error){status.textContent=error.message;}};
  $('model-conversion-form').onsubmit=async event => {
    event.preventDefault(); validationError=''; submitting=true; render(value);
    try { value=await ctx.api('/api/model/convert',{ method:'POST',body:{ source:$('convert-source').value,name:$('convert-name').value,format:$('convert-format').value } }); section.open=true; await ctx.refresh(); }
    catch (error) { validationError=error.message; ctx.fail(error); }
    finally { submitting=false; render(value); }
  };
  $('convert-cancel').onclick=async () => { $('convert-cancel').disabled=true; try { render(await ctx.api('/api/model/cancel-conversion',{ method:'POST',body:{} })); await ctx.refresh(); } catch (error) { ctx.fail(error); } finally { $('convert-cancel').disabled=false; } };
  $('convert-load').onclick=async () => {
    $('convert-load').disabled=true;
    try { await ctx.api('/api/model/load',{ method:'POST',body:{ path:value.job.output } }); await ctx.refresh(); ctx.toast('Loading the converted model. Progress is shown in the runtime logs.'); }
    catch (error) { ctx.fail(error); } finally { $('convert-load').disabled=false; }
  };
  function render(next) {
    value=next || value; const active=value.active || submitting; const job=value.job;
    const runtime=ctx.state.data?.runtime; const blocked=ctx.busy() || !['stopped','error'].includes(runtime?.status) || ['running','pausing','installing','resuming'].includes(ctx.state.data?.trainer?.job?.status);
    for (const id of ['convert-source','convert-name','convert-format','convert-browse','convert-preview']) $(id).disabled=active;
    $('convert-start').disabled=active || blocked; $('convert-cancel').hidden=!value.active; $('convert-progress').hidden=!active;
    $('convert-load').hidden=value.active || job?.status!=='completed'; $('convert-load').disabled=blocked || active || !ctx.state.data?.runtimeInstalled;
    $('convert-destination').textContent=`Save to: ${ctx.state.data?.settings.modelDir || ''}`;
    const phases={ preparing:'Preparing conversion tools',converting:'Converting model weights',quantizing:'Quantizing the GGUF',publishing:'Adding the GGUF to your library',completed:'Conversion complete',cancelled:'Conversion cancelled',error:'Conversion failed',interrupted:'Conversion interrupted' };
    $('convert-status').textContent=job ? `${phases[job.status] || job.status}${job.output ? `\n${job.output}` : ''}${job.error ? `\n${job.error}` : ''}` : blocked ? 'Unload the inference model and stop training before converting.' : 'Ready to convert a local model. The first conversion installs its tools automatically.';
    if (validationError) $('convert-status').textContent=validationError;
    $('convert-log-details').hidden=!job; $('convert-logs').textContent=job?.logs?.join('\n') || 'Conversion logs will appear here.';
  }
  async function tick() {
    if (!value.active) return;
    try {
      const next=await ctx.api('/api/model/conversion'); render(next);
      if (next.job?.status==='completed' && completedId!==next.job.id) { completedId=next.job.id; await ctx.refresh(); ctx.toast('GGUF conversion complete. Your model is in the library.'); }
    } catch (error) { if (ctx.state.view==='models') ctx.fail(error); }
  }
  return { render,tick };
}
