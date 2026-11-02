// Conservative estimate for budgeting only; the runtime remains the final token authority.
const estimate=(value,imageTokens=1120) => { let images=0; const text=typeof value==='string' ? value : JSON.stringify(value,(_key,v) => { if (v?.type==='image_url') { images++; return { type:'image_url',image_url:{ url:'[local image]' } }; } return v; }); return Math.ceil(Buffer.byteLength(text,'utf8')/3)+8+images*imageTokens; };
export function fitContext(messages,definitions,settings) {
  const limit=settings.contextSize-settings.maxTokens-96;
  const toolCost=definitions.length ? estimate(definitions) : 0;
  const result=structuredClone(messages); const costs=result.map(m=>estimate(m,settings.imageTokens || 1120));
  let total=costs.reduce((a,b)=>a+b,toolCost); let removed=0; let clipped=0;
  const users=result.flatMap((m,i)=>m.role==='user' ? [i] : []); let cut=0;
  while(total>limit && removed<users.length-1) {
    const first=users[removed]; const next=users[removed+1];
    for(let i=first;i<next;i++) total-=costs[i];
    cut=next; removed++;
  }
  if(cut) { const first=users[0]; result.splice(first,cut-first); costs.splice(first,cut-first); }
  for (let i=0;i<result.length && total>limit;i++) {
    const message=result[i];
    if (message.role==='tool' && message.content.length>300) {
      const available=Math.max(200,message.content.length-(total-limit)*3-150);
      message.content=message.content.slice(0,available)+'\n[Tool result excerpt. The complete result remains saved in the chat; read a smaller file section if needed.]';
      total+=estimate(message,settings.imageTokens || 1120)-costs[i]; clipped++;
    }
  }
  if (total>limit) throw new Error('The system prompt, enabled skills, tools, and current message exceed the available context. Increase context within your memory budget, reduce maximum output tokens, disable unused skills/tools, or shorten the message. Saved chat history is preserved.');
  return { messages:result,removed,clipped };
}
