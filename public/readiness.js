export function chatReadiness(runtime,{installed=false,hasImages=false,loadingSession=false,busy=false}={}){
  if(loadingSession)return {label:'Opening conversation',detail:'Your draft will be ready shortly.'};
  if(runtime.status==='loading')return {label:'Loading model',detail:'You can keep browsing chats while it loads.'};
  if(runtime.status==='stopping')return {label:'Unloading model',detail:'Wait for the model to stop.'};
  if(runtime.status==='error')return /\b(memory|ram|vram)\b/i.test(runtime.error || '')
    ? {label:'Not enough available memory',detail:'Try a smaller model or context, or adjust the CPU/GPU split.',action:'memory',button:'Review runtime settings'}
    : {label:'Model needs attention',detail:(runtime.error || 'Check model setup and try loading again.').slice(0,500),action:'models',button:'Open Models'};
  if(runtime.status!=='ready')return {label:installed?'Choose a model':'Set up a model',detail:installed?'Load a model from your library to start chatting.':'Add a local model or connect Ollama to start chatting.',action:'models',button:installed?'Choose model':'Add model'};
  if(busy)return {label:'Model is working',detail:'You can prepare another message or queue it.'};
  if(hasImages && !runtime.vision && runtime.source!=='remote')return {label:'Needs matching projector',detail:'Image understanding needs a vision-capable model and its matching projector.',action:'vision',button:'Set up vision'};
  return {label:'Ready to chat',detail:''};
}
