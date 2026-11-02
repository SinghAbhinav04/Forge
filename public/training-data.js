const el=(tag,text) => { const node=document.createElement(tag); if (text!==undefined) node.textContent=text; return node; };

export function initTrainingData(ctx) {
  const source=document.getElementById('train-dataset'); const start=document.getElementById('training-start');
  const section=el('section'); section.id='dataset-review'; section.className='dataset-review';
  const detect=el('button','Detect participants & preview data'); detect.type='button'; detect.id='dataset-detect'; detect.className='secondary-button';
  const help=el('p','Import a WhatsApp TXT export, extracted Instagram message JSON, labelled chat, PDF, Word, or an existing dataset. Choose whose replies to learn, then compare the original and prepared examples. Prepared “user” messages provide context; “assistant” is the reply to learn.'); help.className='feature-note';
  const status=el('p'); status.id='dataset-preview'; status.setAttribute('role','status');
  const who=el('label','Whose replies should the model learn?'); who.hidden=true;
  const select=el('select'); select.id='dataset-speaker'; who.append(select);
  const original=el('details'); original.hidden=true; original.append(el('summary','Original file sample (first 5,000 characters)'));
  const raw=el('pre'); raw.id='dataset-original'; raw.className='feature-log'; original.append(raw);
  const samples=el('div'); samples.id='dataset-samples';
  const confirm=el('label'); confirm.hidden=true; confirm.className='dataset-confirm';
  const check=el('input'); check.type='checkbox'; check.id='dataset-confirm';
  confirm.append(check,el('span','I reviewed the original and prepared examples, including the chosen speaker. Use this prepared dataset for training.'));
  section.append(el('h3','Review training data'),help,detect,status,who,original,samples,confirm);
  document.getElementById('training-form').querySelector('.settings-grid').before(section);
  let result=null; let reviewedSource=''; let revision=0; let busy=false; let pending=false;
  const update=()=> { start.disabled=busy || pending || !result?.reviewId || !check.checked || source.value!==reviewedSource; };
  function invalidate() {
    revision++; result=null; pending=false; detect.disabled=false; select.disabled=false; check.checked=false; confirm.hidden=true; who.hidden=true; original.hidden=true; samples.replaceChildren(); status.textContent='Preview this source before training.'; update();
  }
  source.addEventListener('input',invalidate); check.onchange=update;
  async function preview(selectedSpeaker) {
    const version=++revision; const file=source.value; result=null; check.checked=false; confirm.hidden=true; pending=true; detect.disabled=true; select.disabled=true; samples.replaceChildren(); status.textContent='Reading source and preparing a preview…'; update();
    try {
      const value=await ctx.api('/api/trainer/prepare',{method:'POST',body:{path:file,...(selectedSpeaker ? {selectedSpeaker} : {})}});
      if (version!==revision) return;
      reviewedSource=file; raw.textContent=value.originalSample; original.hidden=false;
      select.replaceChildren(); const placeholder=el('option','Choose a participant…'); placeholder.value=''; select.append(placeholder);
      for (const person of value.participants || []) { const option=el('option',`${person.name} (${person.messages} messages)`); option.value=person.name; select.append(option); }
      who.hidden=!value.requiresSpeaker; select.value=value.selectedSpeaker || '';
      if (value.needsSelection) { status.textContent=`Detected: ${value.mode}. Select the person whose replies you want to learn.\n${value.warnings.join('\n')}`; return; }
      result=value;
      status.textContent=`${value.examples} prepared examples · ${value.mode}\nLearning: ${value.lossMode}${value.selectedSpeaker ? ` (${value.selectedSpeaker})` : ''}\n${value.warnings.join('\n')}\nThe model's tokenizer formats these examples when training starts. Long inputs are limited by your sequence length.`;
      const pairs=value.samples.length ? value.samples : [{original:value.originalSample,prepared:value.preview}];
      pairs.forEach((pair,index)=> {
        const item=el('article'); item.className='dataset-sample'; item.append(el('h4',`Sample ${index+1}`));
        const columns=el('div'); columns.className='dataset-comparison';
        for (const [title,content] of [['Original content',pair.original],['Prepared training data',JSON.stringify(pair.prepared,null,2)]]) {
          const column=el('div'); column.append(el('h4',title)); const pre=el('pre',content); pre.className='feature-log'; column.append(pre); columns.append(column);
        }
        item.append(columns); samples.append(item);
      });
      confirm.hidden=false;
    } catch(error) { if (version===revision) { status.textContent=error.message; original.hidden=true; } }
    finally { if(version===revision) { pending=false; detect.disabled=false; select.disabled=false; update(); } }
  }
  detect.onclick=()=>preview(); select.onchange=()=>preview(select.value);
  update();
  return {
    setBusy(value) { busy=value; update(); },
    confirmed() {
      if (!result?.reviewId || !check.checked || reviewedSource!==source.value) throw new Error('Detect the training data, choose a participant if asked, and confirm the preview first.');
      return {reviewId:result.reviewId,confirmedPreview:true};
    }
  };
}
