// Conservative estimate for budgeting only; the runtime remains the final token authority.
const estimate=(value,imageTokens=1120) => { let images=0; const text=typeof value==='string' ? value : JSON.stringify(value,(_key,v) => { if (v?.type==='image_url') { images++; return { type:'image_url',image_url:{ url:'[local image]' } }; } return v; }); return Math.ceil(Buffer.byteLength(text,'utf8')/3)+8+images*imageTokens; };
export function fitContext(messages,definitions,settings) {
  const limit=settings.contextSize-settings.maxTokens-96;
  const toolCost=definitions.length ? estimate(definitions) : 0;
  const result=structuredClone(messages); const size=() => result.reduce((sum,m) => sum+estimate(m,settings.imageTokens || 1120),0)+toolCost;
  let removed=0; let clipped=0;
  while (size()>limit) {
    const users=result.flatMap((m,i) => m.role==='user' ? [i] : []);
    if (users.length<2) break;
    const first=users[0]; const next=users[1]; result.splice(first,next-first); removed++;
  }
  for (const message of result) {
    if (size()<=limit) break;
    if (message.role==='tool' && message.content.length>300) {
      const available=Math.max(200,message.content.length-(size()-limit)*3-150);
      message.content=message.content.slice(0,available)+'\n[Tool result excerpt. The complete result remains saved in the chat; read a smaller file section if needed.]'; clipped++;
    }
  }
  if (size()>limit) throw new Error('The system prompt, enabled skills, tools, and current message exceed the available context. Increase context within your memory budget, reduce maximum output tokens, disable unused skills/tools, or shorten the message. Saved chat history is preserved.');
  return { messages:result,removed,clipped };
}
