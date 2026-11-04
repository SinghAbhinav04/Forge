export function initAttachmentMenu(){
  const controls=document.querySelector('.session-quick-actions');
  const menu=document.createElement('details');menu.className='attachment-menu';menu.id='attachment-menu';
  const trigger=document.createElement('summary');trigger.textContent='+';trigger.id='attachment-menu-toggle';trigger.setAttribute('aria-label','Add attachments or record voice');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
  const items=document.createElement('div');items.className='attachment-menu-items';items.setAttribute('role','menu');items.setAttribute('aria-label','Add to message');
  for(const id of ['attach-image','attach-document','web-search-open','composer-voice']){const button=document.getElementById(id);button.setAttribute('role','menuitem');items.append(button);}
  menu.append(trigger,items);controls.prepend(menu);
  const close=focus=>{menu.open=false;if(focus)trigger.focus();};
  menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.open)));
  items.addEventListener('click',event=>{if(event.target.closest('button'))close(false);});
  menu.addEventListener('keydown',event=>{
    const enabled=[...items.querySelectorAll('button:not(:disabled)')];
    if(event.key==='Escape'){event.preventDefault();close(true);}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();menu.open=true;const current=enabled.indexOf(document.activeElement);const index=event.key==='Home'?0:event.key==='End'?enabled.length-1:(current+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;enabled[index]?.focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close(false);});
  menu.addEventListener('focusout',event=>{if(event.relatedTarget && !menu.contains(event.relatedTarget))close(false);});
  const mic=document.getElementById('composer-voice');const stop=document.createElement('button');stop.type='button';stop.className='recording-stop text-button';stop.textContent='● Stop recording';stop.id='composer-recording-stop';stop.hidden=true;stop.onclick=()=>mic.click();controls.append(stop);
  new MutationObserver(()=>{stop.hidden=!mic.textContent.toLowerCase().includes('stop recording');stop.disabled=mic.disabled;}).observe(mic,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
}
