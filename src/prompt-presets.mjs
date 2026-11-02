import { randomUUID } from 'node:crypto';
const builtins=[
  {id:'builtin-general',name:'General assistant',instructions:'Be a helpful assistant. Be clear, accurate, and honest about uncertainty.',builtin:true},
  {id:'builtin-writing',name:'Writing editor',instructions:'Help improve writing while preserving the author’s intent and voice. Explain substantial changes when useful.',builtin:true},
  {id:'builtin-coding',name:'Coding helper',instructions:'Help investigate and solve coding problems. Explain relevant changes, and report actual test results without inventing them.',builtin:true},
  {id:'builtin-research',name:'Research assistant',instructions:'Help analyze the available sources. Distinguish evidence from inference, cite the provided sources, and say when information is missing.',builtin:true}
];
const queues=new WeakMap();
function serialized(store,operation){const task=(queues.get(store) || Promise.resolve()).catch(()=>{}).then(operation);queues.set(store,task);return task;}
export function listPromptPresets(store){return [...builtins,...(store.state.promptPresets || [])];}
export function savePromptPreset(store,input){return serialized(store,async()=>{
  if(typeof input.name!=='string' || !input.name.trim() || input.name.length>80 || typeof input.instructions!=='string' || !input.instructions.trim() || input.instructions.length>16000)throw new Error('Enter a name and instructions for the preset.');
  const list=store.state.promptPresets ||= [];if(list.length>=20)throw new Error('Remove a preset before adding another.');const item={id:randomUUID(),name:input.name.trim(),instructions:input.instructions,builtin:false};list.push(item);try{await store.save({sessionIds:[]});}catch(error){list.pop();throw error;}return item;
});}
export function removePromptPreset(store,id){return serialized(store,async()=>{const list=store.state.promptPresets ||= [];const index=list.findIndex(item=>item.id===id);if(index<0)throw new Error('Custom preset not found.');const [item]=list.splice(index,1);try{await store.save({sessionIds:[]});}catch(error){list.splice(index,0,item);throw error;}return {removed:true};});}
