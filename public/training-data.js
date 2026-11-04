const el=(tag,text) => { const node=document.createElement(tag); if (text!==undefined) node.textContent=text; return node; };

export function initTrainingData(ctx) {
  const source=document.getElementById('train-dataset'); const start=document.getElementById('training-start');
  const section=el('section'); section.id='dataset-review'; section.className='dataset-review';
  const detect=el('button','Detect participants & preview data'); detect.type='button'; detect.id='dataset-detect'; detect.className='secondary-button';
  const help=el('p','Import an Instagram HTML export ZIP, message page, or chat folder, Instagram message JSON, WhatsApp TXT, or another supported dataset. Choose whose replies to learn, then compare the original and prepared examples. Prepared “user” messages provide context. The final “assistant” reply is the training target for named chats.'); help.className='feature-note';
  const status=el('p'); status.id='dataset-preview'; status.setAttribute('role','status');
  const chat=el('label','Which Instagram chat should Forge import?'); chat.hidden=true;
  const thread=el('select'); thread.id='dataset-thread'; chat.append(thread);
  const who=el('label','AI / Assistant · whose replies should Forge learn?'); who.hidden=true;
  const select=el('select'); select.id='dataset-speaker'; who.append(select);
  const roles=el('fieldset'); roles.id='dataset-context'; roles.hidden=true;
  roles.append(el('legend','User · whose messages should provide context?'));
  const roleChoices=el('div'); roles.append(roleChoices);
  const original=el('details'); original.hidden=true; original.append(el('summary','Original source sample'));
  const raw=el('pre'); raw.id='dataset-original'; raw.className='feature-log'; original.append(raw);
  const samples=el('div'); samples.id='dataset-samples';
  const confirm=el('label'); confirm.hidden=true; confirm.className='dataset-confirm';
  const check=el('input'); check.type='checkbox'; check.id='dataset-confirm';
  confirm.append(check,el('span','I reviewed the original and prepared examples, including the chosen speaker. Use this prepared dataset for training.'));
  section.append(el('h3','Review training data'),help,detect,status,chat,who,roles,original,samples,confirm);
  document.getElementById('training-form').querySelector('.settings-grid').before(section);
  const threadRoles=new Map();
  let result=null; let reviewedSource=''; let revision=0; let busy=false; let pending=false; let participants=[];
  const update=()=> { start.disabled=busy || pending || !result?.reviewId || !check.checked || source.value!==reviewedSource; };
  function showRoles(assistant,contextSpeakers) {
    roleChoices.replaceChildren();
    roles.hidden=!assistant;
    if (!assistant) return;
    const others=participants.filter(person=>person.name!==assistant);
    if (others.length===1) {
      roleChoices.append(el('div',others[0].name));
      return;
    }
    for (const person of others) {
      const label=el('label'); label.className='dataset-confirm';
      const input=el('input'); input.type='checkbox'; input.value=person.name;
      input.checked=contextSpeakers?.includes(person.name) ?? true;
      label.append(input,el('span',person.name));
      roleChoices.append(label);
    }
  }
  function invalidate() {
    threadRoles.clear();
    revision++; result=null; pending=false; detect.disabled=false; select.disabled=false; thread.disabled=false; roles.disabled=false; participants=[]; select.replaceChildren(); thread.replaceChildren(); chat.hidden=true; check.checked=false; confirm.hidden=true; who.hidden=true; showRoles(); original.hidden=true; samples.replaceChildren(); status.textContent='Preview this source before training.'; update();
  }
  source.addEventListener('input',invalidate); check.onchange=update;
  async function preview(threadId,selectedSpeaker,contextSpeakers) {
    const version=++revision; const file=source.value; result=null; check.checked=false; confirm.hidden=true; pending=true; detect.disabled=true; thread.disabled=true; select.disabled=true; roles.disabled=true; original.hidden=true; samples.replaceChildren(); status.textContent='Reading source and preparing a preview…'; update();
    try {
      const value=await ctx.api('/api/trainer/prepare',{method:'POST',body:{path:file,threadId,selectedSpeaker,contextSpeakers}});
      if (version!==revision) return;
      if (value.needsThread) {
        const placeholder=el('option','Choose a chat…'); placeholder.value='';
        thread.replaceChildren(placeholder);
        for (const item of value.threads) {
          const names=item.recentSenders?.join(', ');
          const label=[...new Set([item.title,names,item.label].filter(Boolean)),`${item.pages} ${item.pages===1 ? 'page' : 'pages'}`].join(' · ');
          const option=el('option',label); option.value=item.id; thread.append(option);
        }
        chat.hidden=false;
        status.textContent='Choose one Instagram thread for this training run.';
        return;
      }
      reviewedSource=file; raw.textContent=value.originalSample; original.hidden=false;
      participants=value.participants || [];
      select.replaceChildren(); const placeholder=el('option','Choose a participant…'); placeholder.value=''; select.append(placeholder);
      for (const person of participants) { const option=el('option',`${person.name} (${person.messages} messages)`); option.value=person.name; select.append(option); }
      who.hidden=!value.requiresSpeaker; select.value=value.selectedSpeaker || '';
      showRoles(value.selectedSpeaker,value.contextSpeakers);
      if (value.needsSelection) { status.textContent=`Detected: ${value.mode}. Select the person whose replies you want to learn.\n${value.warnings.join('\n')}`; return; }
      result=value;
      if (value.threadId && value.selectedSpeaker) threadRoles.set(value.threadId,{assistant:value.selectedSpeaker,context:value.contextSpeakers});
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
    } catch(error) { if (version===revision) { status.textContent=error.message; who.hidden=!select.options.length; } }
    finally { if(version===revision) { pending=false; detect.disabled=false; thread.disabled=false; select.disabled=false; roles.disabled=false; update(); } }
  }
  detect.onclick=()=>{ invalidate(); preview(); };
  thread.onchange=()=>{
    participants=[]; select.replaceChildren(); who.hidden=true; showRoles();
    const saved=threadRoles.get(thread.value);
    preview(thread.value || undefined,saved?.assistant,saved?.context);
  };
  select.onchange=()=>{ showRoles(select.value); preview(thread.value || undefined,select.value); };
  roles.onchange=()=>{
    const contextSpeakers=[...roleChoices.querySelectorAll('input:checked')].map(input=>input.value);
    preview(thread.value || undefined,select.value,contextSpeakers);
  };
  update();
  return {
    setBusy(value) { busy=value; update(); },
    confirmed() {
      if (!result?.reviewId || !check.checked || reviewedSource!==source.value) throw new Error('Detect the training data, choose a participant if asked, and confirm the preview first.');
      return {reviewId:result.reviewId,confirmedPreview:true};
    }
  };
}
