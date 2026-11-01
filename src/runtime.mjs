import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn,execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import { hardware, ggufMetadata, memoryPlan } from './hardware.mjs';

export async function scanModels(directory) {
  const models = [];
  const visit = async (dir, depth) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 2) await visit(file, depth + 1);
      else if (entry.isFile() && /\.gguf$/i.test(entry.name) && !/mmproj/i.test(entry.name) && !/-0*(?:[2-9]|[1-9]\d+)-of-\d+\.gguf$/i.test(entry.name)) {
        const info = await fs.stat(file);
        models.push({ path: file, name: entry.name.replace(/\.gguf$/i, ''), bytes: info.size });
      }
    }
  };
  await visit(directory, 0);
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

export class Runtime {
  constructor(appRoot, runtimeDir = path.join(appRoot, 'runtime')) { this.appRoot = appRoot; this.runtimeDir = runtimeDir; this.child = null; this.status = 'stopped'; this.model = null; this.logs = []; this.error = ''; this.busy = false; }
  snapshot() { return { status:this.status,model:this.model,error:this.error,logs:this.logs.slice(-100),busy:this.busy,phase:this.phase || '',plan:this.plan || null,started:this.started || null,source:this.remote ? 'remote' : 'local',offload:this.offloadEvidence || [],adapters:this.loadedAdapters || [],vision:Boolean(this.configuration?.vision),contextSize:this.configuration?.contextSize || null }; }
  log(chunk) {
    const text=String(chunk); this.logs.push(...text.split(/\r?\n/).filter(Boolean).map(line => line.length>1500 ? `${line.slice(0,1500)}… [line shortened]` : line)); this.logs=this.logs.slice(-120);
    const evidence=text.split(/\r?\n/).filter(l => /offload.*layers?|layers?.*offload/i.test(l)); if (evidence.length) this.offloadEvidence=[...(this.offloadEvidence || []),...evidence].slice(-8);
    if (this.status === 'loading') { if (/load_tensors|loading model|load_model/.test(text)) this.phase = 'Reading model weights'; if (/KV.*buffer|KV.*size|kv_cache/.test(text)) this.phase = 'Allocating context cache'; if (/graph|compute buffer/.test(text)) this.phase = 'Preparing inference'; }
  }
  async executable(settings) {
    if (settings.runtimePath) { await fs.access(settings.runtimePath); return settings.runtimePath; }
    const root = this.runtimeDir;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'current.json'), 'utf8'));
      const executable = path.resolve(root, manifest.executable);
      const relative = path.relative(root, executable);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) { await fs.access(executable); return executable; }
    } catch { /* A user can also place a build in the runtime folder manually. */ }
    const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const find = async (dir, depth) => {
      let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
      if (entries.some(e => e.name === name && e.isFile())) return path.join(dir, name);
      if (depth < 3) for (const entry of entries) if (entry.isDirectory()) { const result = await find(path.join(dir, entry.name), depth + 1); if (result) return result; }
      return null;
    };
    const result = await find(root, 0);
    if (!result) throw new Error('llama-server is not installed. Run npm run setup:runtime, or select your llama-server executable in Settings.');
    return result;
  }
  async load(model, settings) {
    if (this.busy || this.status === 'loading' || this.status === 'stopping') throw new Error('Stop the active task before changing models.');
    const executable = await this.executable(settings);
    if ((settings.executionMode || (settings.gpuLayers>0 ? 'hybrid' : 'cpu'))!=='cpu' && !(await this.devices(settings)).length) throw new Error('The selected runtime has no usable GPU device. Install/select a Vulkan, CUDA or Metal runtime, or switch execution to CPU/RAM.');
    const handle = await fs.open(model.path, 'r');
    try { const magic = Buffer.alloc(4); await handle.read(magic, 0, 4, 0); if (magic.toString() !== 'GGUF') throw new Error('The selected file is not a GGUF model.'); }
    finally { await handle.close(); }
    await this.stop();
    const metadata = await ggufMetadata(model.path); model = { ...model, ...metadata };
    let projectorBytes=0; if (settings.projectorPath) { if (!path.isAbsolute(settings.projectorPath) || !/\.gguf$/i.test(settings.projectorPath)) throw new Error('Select an absolute path to a matching GGUF vision projector.'); const projector=await fs.open(settings.projectorPath,'r'); try { const magic=Buffer.alloc(4); await projector.read(magic,0,4,0); if (magic.toString()!=='GGUF') throw new Error('Projector is not GGUF.'); projectorBytes=(await projector.stat()).size; } finally { await projector.close(); } }
    this.configuration={ contextSize:settings.contextSize,imageTokens:settings.imageTokens || 1120,projectorPath:settings.projectorPath || '',vision:Boolean(settings.projectorPath) };
    this.sampling=Object.fromEntries(['temperature','maxTokens','topP','topK','minP','repeatPenalty','seed'].filter(key => settings[key]!==undefined).map(key => [key,settings[key]]));
    this.plan=memoryPlan(model,{ ...settings,projectorBytes },await hardware({ fresh:true }));
    if (this.plan.errors.length) throw new Error(this.plan.errors.join('\n'));
    this.status = 'loading'; this.error = ''; this.logs = []; this.model = model;
    this.started=Date.now(); this.phase='Starting inference process'; this.offloadEvidence=[];
    this.port = await availablePort(); this.key = randomBytes(32).toString('hex');
    const mode = this.plan.mode;
    const threads = settings.performanceMode === 'responsive' ? Math.min(settings.threads,Math.max(1,Math.floor(os.availableParallelism()/3))) : settings.threads;
    const args = ['--model',model.path,'--host','127.0.0.1','--port',String(this.port),'--api-key',this.key,'--ctx-size',String(settings.contextSize),'--n-gpu-layers',mode === 'gpu' ? 'all' : String(this.plan.gpuLayers),'--threads',String(threads),'--threads-batch',String(threads),'--batch-size',String(settings.batchSize || 128),'--ubatch-size',String(settings.microBatchSize || 64),'--poll','0','--poll-batch','0','--prio','-1','--no-warmup','--parallel','1','--jinja','--no-webui'];
    if (mode === 'cpu') args.push('--device','none','--no-kv-offload','--no-op-offload');
    else if (settings.kvOnGpu === false) args.push('--no-kv-offload');
    if (settings.thinking && settings.thinking !== 'auto') args.push('--reasoning',settings.thinking);
    if (settings.chatTemplate) args.push('--chat-template',settings.chatTemplate);
    if (settings.projectorPath) args.push('--mmproj',settings.projectorPath,'--mmproj-device','none','--image-max-tokens',String(settings.imageTokens || 1120));
    args.push('--log-verbosity','4');
    if (settings.performanceMode==='responsive') args.push('--no-repack');
    args.push('--load-mode',this.plan.strategy==='stream tensors' ? 'none' : 'mmap');
    if (this.plan.strategy==='on-demand embeddings') args.push('--lazy-mode','on');
    this.loadedAdapters=settings.loraAdapters || [];
    for (const adapter of this.loadedAdapters) args.push('--lora',adapter.path);
    if (this.loadedAdapters.length) args.push('--lora-init-without-apply');
    const child = spawn(executable, args, { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.once('spawn',() => { try { os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* --prio still requests a lower inference priority. */ } });
    this.memoryTimer=setInterval(() => { if (this.child===child && this.status==='loading' && os.freemem()/1024**3<Math.max(1,settings.reserveRamGiB || 2)) { void this.stop().then(() => { this.status='error'; this.error='Loading cancelled to preserve the RAM reserved for your system. Close other model apps or use a smaller model/context.'; }); } },1000);
    child.stdout.on('data', c => this.log(c)); child.stderr.on('data', c => this.log(c));
    child.on('error',error => { if (this.child===child) { clearInterval(this.memoryTimer); this.error=error.message; this.status='error'; this.child=null; } });
    child.on('exit',(code,signal) => { if (this.child===child) { clearInterval(this.memoryTimer); this.child=null; if (this.status!=='stopping') { this.status='error'; this.error=`llama-server exited (${code ?? signal}). Check runtime logs. If memory is tight, lower context size or GPU layers.`; } } });
    void this.waitReady(child);
    return this.snapshot();
  }
  async waitReady(child) {
    const deadline = Date.now() + 5 * 60_000;
    while (this.child === child && this.status === 'loading' && Date.now() < deadline) {
      try {
        const result = await fetch(`http://127.0.0.1:${this.port}/v1/models`, { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(2000) });
        if (result.ok && (await result.json()).data?.length) { if (this.child===child && this.status==='loading') { if (this.loadedAdapters?.length) { const apply=await fetch(`http://127.0.0.1:${this.port}/lora-adapters`,{ method:'POST',headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${this.key}` },body:JSON.stringify(this.loadedAdapters.map((a,id) => ({ id,scale:a.scale }))),signal:AbortSignal.timeout(5000) }); if (!apply.ok) throw new Error('Could not activate LoRA stack.'); } this.status='ready'; this.phase='Ready'; clearInterval(this.memoryTimer); } return; }
      } catch { /* Loading is expected to take time. */ }
      await delay(800);
    }
    if (this.child === child && this.status === 'loading') { await this.stop(); this.status = 'error'; this.error = 'Model loading timed out after five minutes. Check runtime logs.'; }
  }
  async completion(body, signal) {
    if (this.status !== 'ready') throw new Error('Load a model and wait for it to be ready.');
    const base = this.remote?.base || `http://127.0.0.1:${this.port}/v1`;
    const result = await fetch(`${base}/chat/completions`, { method:'POST', headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${this.remote?.key || this.key}` }, body:JSON.stringify({ ...body,model:this.model.name }), signal });
    if (!result.ok) { const message = (await result.text()).slice(0, 2000); throw new Error(`Inference failed (${result.status}): ${message}`); }
    return result;
  }
  async stop() {
    if (this.busy) throw new Error('Stop the active task before unloading the model.');
    const child = this.child;
    clearInterval(this.memoryTimer); this.remote = null;
    if (child) {
      this.status = 'stopping';
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 4000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
      if (this.child === child) this.child = null;
    }
    this.status='stopped'; this.model=null; this.phase=''; this.loadedAdapters=[]; this.configuration=null; this.sampling=null;
  }
  async useRemote(connection,model) {
    if (this.busy || ['loading','stopping'].includes(this.status)) throw new Error('Stop the active operation first.');
    await this.stop(); this.remote = { base:connection.base.replace(/\/$/,''),key:connection.key || '' };
    this.model = { name:model,path:`remote:${connection.id}/${model}`,remote:true,device:connection.name }; this.status = 'ready'; this.phase = 'Remote device ready'; this.error = ''; this.plan = null;
    return this.snapshot();
  }
  async devices(settings) {
    const executable=await this.executable(settings);
    if (this.deviceCache?.executable===executable && Date.now()<this.deviceCache.until) return this.deviceCache.devices;
    const output=await new Promise((resolve,reject) => execFile(executable,['--list-devices'],{ cwd:path.dirname(executable),windowsHide:true,timeout:10000 },(error,stdout) => error ? reject(new Error('Unable to query GPU devices in this runtime. Check the runtime build and GPU drivers.')) : resolve(stdout)));
    const devices=String(output).split(/\r?\n/).filter(line => /^\s+\S+:\s+\S/.test(line)).map(line => line.trim());
    this.deviceCache={ executable,until:Date.now()+60000,devices }; return devices;
  }
  async installed() {
    const builds=[];
    try {
      const entries=await fs.readdir(this.runtimeDir,{ withFileTypes:true });
      for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const directory=path.join(this.runtimeDir,entry.name);
        try { const manifest=JSON.parse(await fs.readFile(path.join(directory,'install.json'),'utf8')); const executable=path.resolve(directory,manifest.executable); const relative=path.relative(directory,executable); if (relative.startsWith('..') || path.isAbsolute(relative)) continue; await fs.access(executable); builds.push({ executable,backend:manifest.backend,tag:manifest.tag }); } catch {}
      }
      try { const current=JSON.parse(await fs.readFile(path.join(this.runtimeDir,'current.json'),'utf8')); const executable=path.resolve(this.runtimeDir,current.executable); const relative=path.relative(this.runtimeDir,executable); if (!relative.startsWith('..') && !path.isAbsolute(relative) && !builds.some(b => b.executable===executable)) { await fs.access(executable); builds.push({ executable,backend:current.backend,tag:current.tag }); } } catch {}
    } catch {}
    return builds;
  }
  async applyAdapterStack(items) {
    if (this.status!=='ready' || this.remote) return { reloadRequired:true };
    if (this.busy) throw new Error('Stop the active request before changing adapters.');
    if (items.some(item => !this.loadedAdapters?.some(a => a.id===item.id))) return { reloadRequired:true };
    const scales=(this.loadedAdapters || []).map((a,id) => ({ id,scale:items.find(i => i.id===a.id)?.scale || 0 }));
    const response=await fetch(`http://127.0.0.1:${this.port}/lora-adapters`,{ method:'POST',headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${this.key}` },body:JSON.stringify(scales),signal:AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Runtime rejected the adapter stack.');
    this.loadedAdapters=(this.loadedAdapters || []).map((a,i) => ({ ...a,scale:scales[i].scale })); return { reloadRequired:false };
  }
}

export async function* sseData(body) {
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replaceAll('\r\n', '\n');
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}
