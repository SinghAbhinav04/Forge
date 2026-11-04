import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { trainingEnvironment,trainingPython } from './trainer.mjs';
const command=(exe,args,{ signal,log=()=>{},env={},cwd }={}) => new Promise((resolve,reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const child=spawn(exe,args,{ cwd,windowsHide:true,detached:process.platform!=='win32',env:{ ...process.env,OMP_NUM_THREADS:'2',TOKENIZERS_PARALLELISM:'false',...env },stdio:['ignore','pipe','pipe'] });
  let tail=''; let timer; let stopping=false;
  const stop=() => {
    if (!child.pid || stopping) return; stopping=true;
    if (process.platform==='win32') { const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{ windowsHide:true,stdio:'ignore' }); killer.on('error',() => child.kill()); }
    else { try { process.kill(-child.pid,'SIGTERM'); } catch { child.kill(); } }
    timer=setTimeout(() => { try { if (process.platform!=='win32') process.kill(-child.pid,'SIGKILL'); else child.kill('SIGKILL'); } catch {} },4000);
  };
  child.once('spawn',() => { try { os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {} if (signal?.aborted) stop(); });
  signal?.addEventListener('abort',stop,{ once:true });
  for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk => { tail=(tail+chunk).slice(-6000); log(String(chunk)); });
  child.once('error',reject);
  child.once('close',code => { clearTimeout(timer); signal?.removeEventListener('abort',stop); if (signal?.aborted) reject(signal.reason); else if (code===0) resolve(); else reject(new Error(`Converter process failed (${code}): ${tail}`)); });
});
const sourceTasks=new Map();
const helperTasks=new Map();
export async function ensureConverterSource(dataDir,{ signal,log=console.log }={}) {
  const root=path.join(dataDir,'converter'); const marker=path.join(root,'current.json');
  try { const current=JSON.parse(await fs.readFile(marker,'utf8')); await fs.access(path.join(current.source,'convert_lora_to_gguf.py')); await fs.access(path.join(current.source,'convert_hf_to_gguf.py')); return current.source; } catch {}
  if (sourceTasks.has(root)) return sourceTasks.get(root);
  const task=(async () => {
    await fs.mkdir(root,{ recursive:true });
    const response=await fetch('https://api.github.com/repos/ggml-org/llama.cpp/commits/master',{ headers:{ 'User-Agent':'Forge/0.2' },signal }); if (!response.ok) throw new Error('Cannot resolve the official llama.cpp converter source.'); const commit=(await response.json()).sha; if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid converter source commit.');
    const archive=path.join(root,`${commit}.zip`); log(`Downloading official llama.cpp converter source at ${commit.slice(0,12)}…`);
    const sourceResponse=await fetch(`https://github.com/ggml-org/llama.cpp/archive/${commit}.zip`,{ signal }); if (!sourceResponse.ok) throw new Error(`Source download failed (${sourceResponse.status}).`); await pipeline(Readable.fromWeb(sourceResponse.body),createWriteStream(archive),{ signal });
    await command('tar',['-xf',archive,'-C',root],{ signal,log }); const source=path.join(root,`llama.cpp-${commit}`); await fs.access(path.join(source,'convert_lora_to_gguf.py'));
    await fs.writeFile(marker,JSON.stringify({ source,commit },null,2)); return source;
  })(); sourceTasks.set(root,task);
  try { return await task; } finally { sourceTasks.delete(root); }
}
export async function ensureConverter(dataDir,options={}) {
  const source=await ensureConverterSource(dataDir,options);
  const marker=path.join(dataDir,'converter','adapter-helpers.json');
  const python=options.python ?? trainingPython(dataDir);
  try {
    const previous=JSON.parse(await fs.readFile(marker,'utf8'));
    if (previous.source===source && (previous.python ?? trainingPython(dataDir,'cpu'))===python) return source;
  } catch {}
  if (helperTasks.has(marker)) return helperTasks.get(marker);
  const task=(async () => {
    options.log?.('Installing converter helpers into the isolated training environment…');
    await command(python,['-m','pip','install','sentencepiece','protobuf','tiktoken','gguf'],options);
    await fs.writeFile(marker,JSON.stringify({ source,python })); return source;
  })(); helperTasks.set(marker,task);
  try { return await task; } finally { helperTasks.delete(marker); }
}
export class AdapterConverter {
  constructor(store,library) { this.store=store; this.library=library; this.tasks=new Map(); }
  async start(id,baseGguf) {
    const adapter=this.store.state.adapters.find(a => a.id===id); if (!adapter?.baseModel || !adapter.folder) throw new Error('This PEFT adapter needs its original local Hugging Face base folder.');
    if (this.tasks.has(id)) throw new Error('This adapter is already converting.'); await fs.access(baseGguf);
    const env=await trainingEnvironment(this.store.dataDir,'cpu');
    if (!env.installed) throw new Error('Install a training engine in Trainer before converting a LoRA.');
    const controller=new AbortController(); adapter.conversion={ status:'preparing',logs:[],error:'' }; const log=text => { adapter.conversion.logs=[...adapter.conversion.logs,...text.split(/\r?\n/).filter(Boolean).map(l => l.slice(0,1500))].slice(-40); };
    const task=(async () => {
      try {
        const source=await ensureConverter(this.store.dataDir,{ signal:controller.signal,log,python:env.python }); controller.signal.throwIfAborted(); adapter.conversion.status='converting';
        const outfile=path.join(adapter.folder,'adapter.gguf');
        await command(env.python,[path.join(source,'convert_lora_to_gguf.py'),'--base',adapter.baseModel,'--outfile',outfile,'--outtype','f16',adapter.folder],{ signal:controller.signal,log,env:{ HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1' } });
        const { ggufMetadata }=await import('./hardware.mjs'); const actual=await ggufMetadata(outfile); const base=await ggufMetadata(baseGguf); if (actual.kind!=='adapter' || actual.adapterType!=='lora' || actual.architecture!==base.architecture) throw new Error('Converted adapter is incompatible with the selected base GGUF architecture.');
        adapter.ggufPath=outfile; adapter.baseGguf=baseGguf; adapter.format='peft+gguf'; adapter.conversion.status='completed';
      } catch (error) { adapter.conversion.status=controller.signal.aborted ? 'cancelled' : 'error'; adapter.conversion.error=error.message; }
      finally { this.tasks.delete(id); await this.store.save(); }
    })(); this.tasks.set(id,{ task,controller }); void task.catch(() => {}); await this.store.save(); return { started:true };
  }
  async cancel(id) { const item=this.tasks.get(id); if (!item) throw new Error('No active conversion.'); item.controller.abort(); await item.task; return { cancelled:true }; }
  async close() { for (const item of this.tasks.values()) item.controller.abort(); await Promise.allSettled([...this.tasks.values()].map(i => i.task)); }
}
export { command as converterCommand };
