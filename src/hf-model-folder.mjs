import fs from 'node:fs/promises';
import path from 'node:path';

async function readConfig(file) {
  if ((await fs.stat(file)).size>4*1024**2) throw new Error('Model configuration is too large.');
  return JSON.parse(await fs.readFile(file,'utf8'));
}

export async function inspectHuggingFaceFolder(folder) {
  if (typeof folder!=='string' || !path.isAbsolute(folder)) throw new Error('Choose a local Hugging Face model folder.');
  const source=await fs.realpath(folder);
  if (!(await fs.stat(source)).isDirectory()) throw new Error('Choose a model folder, rather than a single weights file.');
  let config;
  try { config=await readConfig(path.join(source,'config.json')); }
  catch { throw new Error('This folder needs a valid config.json from the original Hugging Face model.'); }
  if (!config.model_type && !config.architectures?.length) throw new Error('The model configuration does not identify a model architecture.');
  if (['gptq','awq','bitsandbytes','aqlm','hqq'].includes(config.quantization_config?.quant_method)) throw new Error('Use the original unquantized Hugging Face weights. This pre-quantized format cannot be converted here.');
  const names=await fs.readdir(source);
  if (!['tokenizer.json','tokenizer.model','vocab.json','vocab.txt','tekken.json'].some(name => names.includes(name))) throw new Error('The model folder is missing tokenizer files. Download the complete model, including its tokenizer.');
  const weights=names.filter(name => /\.(?:safetensors|bin)$/.test(name) && !/^(?:adapter_|training_args|optimizer|scheduler)/.test(name));
  if (!weights.length) throw new Error('No Hugging Face .safetensors or .bin weights were found. Ollama model storage and GGUF files are not Hugging Face source folders.');
  for (const index of ['model.safetensors.index.json','pytorch_model.bin.index.json']) if (names.includes(index)) {
    const manifest=await readConfig(path.join(source,index));
    if (!manifest.weight_map || !Object.keys(manifest.weight_map).length) throw new Error('The model shard index has no weights.');
    for (const shard of new Set(Object.values(manifest.weight_map))) {
      if (typeof shard!=='string' || path.basename(shard)!==shard || /[\\/]/.test(shard) || !weights.includes(shard)) throw new Error('The model download is incomplete: a weight shard listed in its index is missing.');
    }
  }
  let sourceBytes=0;
  for (const file of weights) { const info=await fs.stat(path.join(source,file)); if (!info.isFile() || !info.size) throw new Error(`Missing or empty model weights: ${file}`); sourceBytes+=info.size; }
  return {source,config,sourceBytes};
}
