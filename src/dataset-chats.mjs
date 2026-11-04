// Deterministic speaker detection. A person's identity is never inferred from order.
const canonical=new Set(['system','user','human','customer','question','prompt','instruction','assistant','ai','bot','gpt','chatgpt','answer','response','completion','agent']);
const key=value => String(value || '').toLowerCase().replace(/[\s_-]/g,'');
const speaker=item => item.sender_name ?? item.sender?.name ?? item.sender ?? item.speaker ?? item.from ?? item.author?.name ?? item.author?.role ?? item.author ?? item.role;
const textOf=item => { const value=item.content?.parts ?? item.content ?? item.value ?? item.text ?? item.message; return typeof value==='string' ? value : Array.isArray(value) ? value.map(p => typeof p==='string' ? p : p?.type==='text' ? p.text : '').filter(Boolean).join('\n') : ''; };
const omitted=text => /^(?:[\u200e\u200f]?<?(?:media omitted|image omitted|video omitted|audio omitted|sticker omitted|gif omitted)>?|this message was deleted|you deleted this message|<attached:.*>|.*\(file attached\))$/i.test(text.trim());

export function textChat(text) {
  const records=[]; let current=null; let social=false; let skipped=0;
  // Android: 01/11/2026, 8:10 pm - Name: text. iOS: [01/11/2026, 20:10:03] Name: text.
  const stamp=/^(?:\[)?\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?(?:\]\s*|\s*[-–]\s*)/i;
  const clean=line=>line.replace(/^[\u200e\u200f\uFEFF]+/,'').replaceAll('\u202f',' ').replaceAll('\u00a0',' ');
  const timestamped=text.split(/\r?\n/).some(line=>stamp.test(clean(line)));
  for (const original of text.replaceAll('\r\n','\n').split('\n')) {
    const line=clean(original);
    const date=line.match(stamp); if (date) social=true;
    if (timestamped && !date) { if (current) { current.content+='\n'+original; current.original+='\n'+original; } continue; }
    const body=date ? line.slice(date[0].length) : line;
    const match=body.match(/^(?:#{1,6}\s*)?\[?([^:\[\]\r\n]{1,80}?)\]?\s*[:：]\s*(.*)$/u);
    const heading=!date && body.match(/^(?:#{1,6}\s*)?\[?(User\s*1|User\s*2|User|Assistant|Human|AI|Bot|Question|Answer|Prompt|Response)\]?\s*$/i);
    if (match || heading) { const m=match || heading; current={ speaker:m[1].trim(),content:m[2] || '',original }; records.push(current); }
    else if (date) { skipped++; current=null; } // Platform notices are not participant replies.
    else if (current) { current.content+='\n'+original; current.original+='\n'+original; }
  }
  const names=new Set(records.map(r => r.speaker));
  const known=records.some(r => canonical.has(key(r.speaker)) || /^user[12]$/i.test(key(r.speaker)));
  if (!social && !known && !(names.size>=2 && records.length>=4)) return null;
  return { conversations:[records],named:social,format:social ? 'WhatsApp / timestamped chat' : 'labelled conversation',skipped };
}

export function jsonChats(document) {
  let sources=Array.isArray(document) ? document : [document];
  for (const wrapper of ['data','train','records','items']) if (Array.isArray(document?.[wrapper])) { sources=document[wrapper]; break; }
  if (sources.length && sources.every(r => r && typeof r==='object' && speaker(r) !== undefined && !r.messages)) sources=[{ messages:sources }];
  const conversations=[]; let instagram=false; let named=false;
  for (const source of sources) {
    const items=['messages','conversations','chat_messages','chat'].map(k => source?.[k]).find(Array.isArray);
    if (!items) return null; // Canonical paired examples and ChatGPT tree exports use the existing parser.
    instagram ||= items.some(m => m.sender_name!==undefined);
    named ||= items.some(m => m.sender_name!==undefined || m.sender!==undefined || m.author?.name!==undefined);
    let ordered=items;
    if (items.length && items.every(m => Number.isFinite(m.timestamp_ms))) ordered=items.map((item,index)=>({item,index})).sort((a,b)=>a.item.timestamp_ms-b.item.timestamp_ms || a.index-b.index).map(v=>v.item);
    conversations.push(ordered.map(item => {
      const name=speaker(item);
      if (typeof name!=='string' || !name.trim()) throw new Error('A chat message has no participant name or role. Preprocess this export before training.');
      return { speaker:name.trim(),content:textOf(item),original:JSON.stringify(item) };
    }));
  }
  return { conversations,named,format:instagram ? 'Instagram / named JSON chat' : 'JSON conversation',skipped:0 };
}

export function prepareChats(chat,selectedSpeaker,contextSpeakers) {
  let skipped=chat.skipped; const speakers=new Map();
  const conversations=chat.conversations.map(records => records.filter(record => {
    if (!record.content.trim() || omitted(record.content)) { skipped++; return false; }
    speakers.set(record.speaker,(speakers.get(record.speaker) || 0)+1); return true;
  }));
  const named=chat.named || [...speakers.keys()].some(name => !canonical.has(key(name)));
  if (!named) return null;
  const participants=[...speakers].map(([name,messages])=>({ name,messages }));
  const base={ mode:chat.format,participants,requiresSpeaker:true,skipped,warnings:skipped ? [`Skipped ${skipped} platform notices or empty/media-only messages. Attachments are not trained.`] : [] };
  if (!selectedSpeaker) return { ...base,needsSelection:true,rows:[],samples:[] };
  if (!speakers.has(selectedSpeaker)) throw new Error('Choose one of the detected participants.');
  const otherSpeakers=[...speakers.keys()].filter(name=>name!==selectedSpeaker);
  const incoming=contextSpeakers ?? otherSpeakers;
  if (!Array.isArray(incoming) || !incoming.length || incoming.some(name=>!otherSpeakers.includes(name))) throw new Error('Choose at least one other participant for user context.');
  const context=new Set(incoming);
  let excluded=0;
  const segments=[];
  for (const records of conversations) {
    let segment=[];
    for (const record of records) {
      if (record.speaker===selectedSpeaker || context.has(record.speaker)) segment.push(record);
      else {
        excluded++;
        if (segment.length) segments.push(segment);
        segment=[];
      }
    }
    if (segment.length) segments.push(segment);
  }
  const rows=[]; const samples=[]; let opening=0; let trailing=0;
  for (const records of segments) {
    const turns=[];
    for (const record of records) {
      const role=record.speaker===selectedSpeaker ? 'assistant' : 'user';
      const content=role==='user' && participants.length>2 ? `${record.speaker}: ${record.content.trim()}` : record.content.trim();
      if (turns.at(-1)?.role===role) { turns.at(-1).content+='\n\n'+content; turns.at(-1).original.push(record.original); }
      else turns.push({role,content,original:[record.original]});
    }
    if (turns[0]?.role==='assistant') { turns.shift(); opening++; }
    if (turns.at(-1)?.role==='user') trailing++;
    for (let i=1;i<turns.length;i++) {
      if (turns[i].role!=='assistant') continue;
      // Keep complete user/assistant pairs in a bounded recent context window.
      let start=i-1; let chars=turns[start].content.length+turns[i].content.length;
      while (start>=2 && i-start<11 && chars+turns[start-2].content.length+turns[start-1].content.length<=6000) { start-=2; chars+=turns[start].content.length+turns[start+1].content.length; }
      const included=turns.slice(start,i+1); const row={messages:included.map(({role,content})=>({role,content})),assistant_only:true,target_last_reply:true}; rows.push(row);
      if (samples.length<3) samples.push({ original:included.flatMap(m=>m.original).join('\n'),prepared:row });
    }
  }
  if (!rows.length) throw new Error('No replies from this AI participant have preceding user context. Try different participant roles.');
  if (excluded) base.warnings.push(`Excluded ${excluded} messages from unselected participants. Examples never join messages across those gaps.`);
  if (opening) base.warnings.push(`Skipped ${opening} opening reply blocks without incoming context.`);
  if (trailing) base.warnings.push(`Excluded ${trailing} unanswered final incoming blocks from training targets.`);
  base.warnings.push('Nearby turns provide context. Only the final selected-person reply in each example is a training target; older context is limited to 12 turns / approximately 6,000 characters.');
  return { ...base,needsSelection:false,selectedSpeaker,contextSpeakers:[...context],rows,samples,lossMode:'selected replies only' };
}
