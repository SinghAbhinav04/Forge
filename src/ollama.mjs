const localBase='http://127.0.0.1:11434';

// Only contact the loopback Ollama service. Arbitrary remote URLs remain in the
// existing, explicitly configured connections flow.
export async function localOllamaModels({base=localBase,fetchImpl=fetch}={}) {
  const response=await fetchImpl(`${base}/api/tags`,{signal:AbortSignal.timeout(2500)});
  if(!response.ok)throw new Error(`Ollama returned HTTP ${response.status}.`);
  const result=await response.json();if(!Array.isArray(result.models))throw new Error('Ollama returned an invalid model list.');
  return result.models.filter(m=>m && typeof m.name==='string' && m.name.length<=256).slice(0,500).map(m=>({
    id:m.name,bytes:Number.isSafeInteger(m.size) && m.size>=0 ? m.size : null,
    format:typeof m.details?.format==='string' ? m.details.format.slice(0,80) : null,
    quantization:typeof m.details?.quantization_level==='string' ? m.details.quantization_level.slice(0,80) : null
  }));
}
export const ollamaConnection={name:'Ollama on this computer',base:`${localBase}/v1`,key:'ollama'};
