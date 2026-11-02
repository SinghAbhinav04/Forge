import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
const GiB = 1024 ** 3;
let cached; let expires = 0;
const metadataCache=new Map();
export function recommendedRuntime(device) {
  if (device.platform==='darwin') return 'cpu'; // The macOS build includes Metal on supported Macs.
  const required=device.platform==='win32' ? 12.4 : 12.8;
  const version=String(device.gpu?.cudaVersion || '').match(/^(\d+)\.(\d+)$/);
  const capability=String(device.gpu?.computeCapability || '').match(/^(\d+)\.(\d+)$/);
  if (['win32','linux'].includes(device.platform) && device.arch==='x64' && version && capability && Number(capability[1])>=5 && (Number(version[1])>Math.floor(required) || (Number(version[1])===Math.floor(required) && Number(version[2])>=Math.round((required%1)*10)))) return 'cuda';
  return 'cpu';
}
export function runtimeGpuMemory(devices=[]) {
  for(const line of devices){const match=String(line).match(/^([^:]+):\s*(.*?)\s*\(\s*([\d.]+)\s*MiB\s*,\s*([\d.]+)\s*MiB\s+free\s*\)/i);if(match)return {name:match[2] || match[1],totalGiB:Number(match[3])/1024,freeGiB:Number(match[4])/1024,source:'runtime'};}
  return null;
}
export async function hardware({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() < expires) return { ...cached, freeGiB: os.freemem() / GiB };
  const gpu = await new Promise(resolve => execFile('nvidia-smi', ['--query-gpu=name,memory.total,memory.free,memory.used,compute_cap', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 2000 }, (error, stdout) => {
    if (error) return resolve(null);
    const [name, total, free, used,computeCapability] = stdout.trim().split('\n')[0].split(',').map(s => s.trim());
    if (![total,free,used].every(value=>Number.isFinite(Number(value)))) return resolve(null);
    resolve({ name, totalGiB: Number(total) / 1024, freeGiB: Number(free) / 1024, usedGiB: Number(used) / 1024,computeCapability });
  }));
  if(gpu) gpu.cudaVersion=await new Promise(resolve=>execFile('nvidia-smi',[],{windowsHide:true,timeout:2000},(error,stdout)=>resolve(error ? null : String(stdout).match(/CUDA Version:\s*(\d+\.\d+)/)?.[1] || null)));
  cached = { ramGiB: os.totalmem() / GiB, freeGiB: os.freemem() / GiB, cores: os.availableParallelism(), cpu: os.cpus()[0]?.model, gpu, unifiedMemory: process.platform === 'darwin' && process.arch === 'arm64', platform: process.platform, arch: process.arch };
  expires = Date.now() + 5000; return cached;
}
export async function ggufMetadata(file) {
  const handle = await fs.open(file, 'r');
  try {
    const info=await handle.stat(); const size=info.size; const cacheKey=`${file}:${info.dev}:${info.ino}:${size}:${info.mtimeMs}:${info.ctimeMs}`;
    if(metadataCache.has(cacheKey)) return structuredClone(metadataCache.get(cacheKey));
    const buffer=Buffer.alloc(Math.min(size,32*1024**2)); const { bytesRead }=await handle.read(buffer,0,buffer.length,0);
    let cursor = 0;
    const take = n => { if (n < 0 || cursor + n > bytesRead) throw new RangeError('Metadata prefix exhausted'); const p = cursor; cursor += n; return p; };
    const u32 = () => buffer.readUInt32LE(take(4));
    const u64 = () => { const v = Number(buffer.readBigUInt64LE(take(8))); if (!Number.isSafeInteger(v)) throw new RangeError('Invalid GGUF value'); return v; };
    const text = () => { const length = u64(); return buffer.toString('utf8', take(length), cursor); };
    if (buffer.toString('ascii', take(4), cursor) !== 'GGUF') throw new Error('Not a GGUF file.');
    const version = u32(); if (![2, 3].includes(version)) throw new Error('Unsupported GGUF version.');
    const tensorCount=u64(); const count=u64(); const metadata={}; let complete=true;
    const value = type => {
      if (type === 8) return text();
      if (type===9) { const item=u32(); const length=u64(); if (length>2_000_000) throw new RangeError('Large metadata array'); const widths={ 0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8 }; if (widths[item]) take(length*widths[item]); else if (item===8) { for (let i=0;i<length;i++) take(u64()); } else throw new RangeError('Unsupported metadata array'); return null; }
      const widths = { 0:1, 1:1, 2:2, 3:2, 4:4, 5:4, 6:4, 7:1, 10:8, 11:8, 12:8 }; const width = widths[type]; if (!width) throw new RangeError('Unknown GGUF field type');
      const p = take(width); return type === 4 ? buffer.readUInt32LE(p) : type === 5 ? buffer.readInt32LE(p) : null;
    };
    try { for (let i=0;i<count;i++) { if (i>10000) throw new RangeError('Too many metadata fields'); const key=text(); const v=value(u32()); if (/^(?:general\.(?:architecture|name|file_type|type|alignment)|adapter\.type|.+\.(?:block_count|context_length|embedding_length|attention\.(?:head_count|head_count_kv|key_length|value_length)))$/.test(key)) metadata[key]=v; } } catch (error) { if (!(error instanceof RangeError)) throw error; complete=false; }
    const architecture = metadata['general.architecture'];
    let tensorLayout;
    if (complete && tensorCount<100000) {
      try { const tensors=[]; for (let i=0;i<tensorCount;i++) { const name=text(); const dimensions=u32(); if (dimensions>8) throw new RangeError('Invalid tensor shape'); for (let j=0;j<dimensions;j++) u64(); u32(); tensors.push({ name,offset:u64() }); } const alignment=metadata['general.alignment'] || 32; const dataStart=Math.ceil(cursor/alignment)*alignment; tensors.sort((a,b) => a.offset-b.offset); const blocks=[]; let total=0; let output=0; let input=0; let lazy=0;
        for (let i=0;i<tensors.length;i++) { const t=tensors[i]; const bytes=(tensors[i+1]?.offset ?? size-dataStart)-t.offset; if (bytes<0) throw new RangeError('Invalid tensor size'); total+=bytes; const block=t.name.match(/^blk\.(\d+)\./); if (block) blocks[Number(block[1])]=(blocks[Number(block[1])] || 0)+bytes; if (t.name==='output.weight') output=bytes; if (t.name==='token_embd.weight') input=bytes; if (/per_layer_token_embd/.test(t.name)) lazy+=bytes; }
        tensorLayout={ blocks:Array.from(blocks,n => n || 0),totalBytes:total,outputBytes:output || input,tiedOutput:!output,lazyBytes:lazy };
      } catch { /* Unknown/large headers use conservative file-size estimates. */ }
    }
    const result={ version,architecture,kind:metadata['general.type'],adapterType:metadata['adapter.type'],layers:metadata[`${architecture}.block_count`] || null,nativeContext:metadata[`${architecture}.context_length`] || null,embeddingLength:metadata[`${architecture}.embedding_length`] || null,heads:metadata[`${architecture}.attention.head_count`] || null,kvHeads:metadata[`${architecture}.attention.head_count_kv`] || null,keyLength:metadata[`${architecture}.attention.key_length`] || null,valueLength:metadata[`${architecture}.attention.value_length`] || null,tensorLayout };
    metadataCache.set(cacheKey,result); if(metadataCache.size>32)metadataCache.delete(metadataCache.keys().next().value); return structuredClone(result);
  } finally { await handle.close(); }
}
export function memoryPlan(model, settings, device) {
  const mode = settings.executionMode || (settings.gpuLayers > 0 ? 'hybrid' : 'cpu');
  const totalLayers = model.layers || 32;
  const gpuLayers = mode === 'cpu' ? 0 : mode === 'gpu' ? totalLayers + 1 : Math.min(settings.gpuLayers, Math.max(1, totalLayers - 1));
  const fraction = Math.min(1, gpuLayers / (totalLayers + 1));
  const weights=model.bytes/GiB; const headSize=model.heads && model.embeddingLength ? model.embeddingLength/model.heads : null;
  const keySize=model.keyLength || headSize, valueSize=model.valueLength || headSize, kvHeads=model.kvHeads || model.heads;
  const metadataCacheSize=model.layers && kvHeads && keySize && valueSize ? settings.contextSize*model.layers*kvHeads*(keySize+valueSize)*2/GiB*1.25 : 0;
  const cache=Math.max(0.3,metadataCacheSize || settings.contextSize/4096*0.55);
  const layout=model.tensorLayout; const strategy=settings.loadStrategy || 'auto'; const lazy=strategy!=='mmap' && layout?.lazyBytes>0;
  const outputOnGpu=gpuLayers>0;
  const offloadedBlocks=layout ? layout.blocks.slice(Math.max(0,layout.blocks.length-Math.max(0,gpuLayers-1))).reduce((n,b) => n+b,0) : 0;
  const cpuWeights=layout ? (layout.totalBytes-offloadedBlocks-(outputOnGpu && !layout.tiedOutput ? layout.outputBytes : 0)-(lazy ? Math.max(0,layout.lazyBytes-256*1024**2) : 0))/GiB : weights*(1-fraction);
  const gpuWeights=layout ? (offloadedBlocks+(outputOnGpu ? layout.outputBytes : 0))/GiB : weights*fraction;
  const gpuCache = mode !== 'cpu' && settings.kvOnGpu !== false;
  const adapterGiB=(settings.loraAdapters || []).reduce((sum,a) => sum+(a.bytes || 0),0)/GiB;
  const projectorGiB=(settings.projectorBytes || 0)/GiB;
  const ramGiB=(device.unifiedMemory ? (lazy ? cpuWeights+gpuWeights : weights)+cache+0.35 : Math.max(0.5,cpuWeights)+(gpuCache ? 0.35 : cache)+0.35)+adapterGiB+projectorGiB+(projectorGiB ? .2 : 0);
  const vramGiB=fraction ? gpuWeights+(gpuCache ? cache : 0.15)+0.3+adapterGiB : 0;
  const reserveGiB = settings.reserveRamGiB ?? 2; const errors = [];
  if (device.freeGiB < ramGiB + reserveGiB) errors.push(`Estimated RAM needed ${ramGiB.toFixed(1)} GiB plus ${reserveGiB} GiB reserved for your system; only ${device.freeGiB.toFixed(1)} GiB is currently free. Close other model apps, lower context, or use more GPU layers.`);
  if (fraction && device.gpu && vramGiB + 0.5 > device.gpu.freeGiB) errors.push(`Estimated VRAM needed ${vramGiB.toFixed(1)} GiB plus 0.5 GiB desktop headroom; only ${device.gpu.freeGiB.toFixed(1)} GiB is free. Use hybrid with fewer GPU layers or put the KV cache in RAM.`);
  return { mode,gpuLayers,ramGiB,vramGiB,reserveGiB,estimated:true,strategy:strategy==='mmap' ? 'memory map' : 'stream tensors',lazyEmbeddings:Boolean(lazy),errors };
}

export function chooseMemoryPlan(model,settings,device) {
  const manual=memoryPlan(model,settings,device);
  if (manual.mode!=='hybrid' || settings.autoGpuLayers===false || (!device.gpu && !device.unifiedMemory)) return manual;
  let best;
  // Start with the greatest hybrid offload that fits VRAM. Keep the CPU layers,
  // desktop VRAM margin and the configured RAM reserve in every candidate.
  for (let layers=Math.max(1,(model.layers || 32)-1);layers>=1;layers--) {
    const plan=memoryPlan(model,{ ...settings,gpuLayers:layers },device);
    if (device.gpu && plan.vramGiB+0.5>device.gpu.freeGiB) continue;
    best ??= plan;
    if (!plan.errors.length) return { ...plan,autoGpuLayers:true,requestedGpuLayers:settings.gpuLayers };
  }
  return { ...(best || manual),autoGpuLayers:true,requestedGpuLayers:settings.gpuLayers };
}
