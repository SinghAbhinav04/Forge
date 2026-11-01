import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ggufMetadata } from './hardware.mjs';
export class AdapterLibrary {
  constructor(store) { this.store=store; this.directory=path.join(store.dataDir,'trained'); store.state.adapters ||= []; store.state.loraStack ||= []; }
  snapshot() { return { directory:this.directory,adapters:this.store.state.adapters,stack:this.store.state.loraStack }; }
  async registerJob(job) {
    if (this.store.state.adapters.some(a => a.sourceJobId===job.id)) return;
    await fs.mkdir(this.directory,{ recursive:true }); const id=randomUUID(); const name=job.name || 'Untitled LoRA'; const slug=name.replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,60) || 'adapter'; const folder=path.join(this.directory,`${slug}--${id.slice(0,8)}`);
    await fs.cp(path.join(job.output,'adapter'),folder,{ recursive:true,errorOnExist:true,force:false });
    const adapter={ id,name,folder,format:'peft',baseModel:job.config.baseModel,sourceJobId:job.id,created:Date.now(),ggufPath:'',baseGguf:'' }; this.store.state.adapters.push(adapter); await this.store.save(); return adapter;
  }
  async rename(id,name) { const adapter=this.store.state.adapters.find(a => a.id===id); if (!adapter || typeof name!=='string' || !name.trim() || name.length>80) throw new Error('Choose an adapter and a name under 80 characters.'); const slug=name.trim().replace(/[^a-zA-Z0-9_-]+/g,'-') || 'adapter'; const next=path.join(this.directory,`${slug.slice(0,60)}--${adapter.id.slice(0,8)}`); if (next!==adapter.folder) { await fs.rename(adapter.folder,next); if (adapter.ggufPath && path.dirname(adapter.ggufPath)===adapter.folder) adapter.ggufPath=path.join(next,path.basename(adapter.ggufPath)); adapter.folder=next; } adapter.name=name.trim(); await this.store.save(); return adapter; }
  async importGguf(file,name,baseGguf) {
    if (typeof file!=='string' || !path.isAbsolute(file) || !/\.gguf$/i.test(file)) throw new Error('Choose a GGUF LoRA adapter.'); const metadata=await ggufMetadata(file);
    if (metadata.kind!=='adapter' || metadata.adapterType!=='lora') throw new Error('This GGUF is not a LoRA adapter.');
    const base=await ggufMetadata(baseGguf); if (metadata.architecture!==base.architecture) throw new Error('Adapter architecture does not match the chosen base GGUF.');
    const id=randomUUID(); await fs.mkdir(this.directory,{ recursive:true }); const folder=path.join(this.directory,`imported--${id.slice(0,8)}`); await fs.mkdir(folder); const ggufPath=path.join(folder,'adapter.gguf'); await fs.copyFile(file,ggufPath);
    const adapter={ id,name:String(name || path.basename(file)).slice(0,80),folder,format:'gguf',baseModel:'',baseGguf,ggufPath,architecture:metadata.architecture,created:Date.now() }; this.store.state.adapters.push(adapter); await this.store.save(); return adapter;
  }
  async stack(items) { if (!Array.isArray(items) || items.length>8) throw new Error('Select at most eight adapters.'); const seen=new Set(); for (const item of items) { const adapter=this.store.state.adapters.find(a => a.id===item.id); if (!adapter?.ggufPath || !adapter.baseGguf || seen.has(item.id) || typeof item.scale!=='number' || !Number.isFinite(item.scale) || item.scale<0 || item.scale>2) throw new Error('Choose compatible GGUF adapters and scales between 0 and 2.'); seen.add(item.id); } this.store.state.loraStack=items.map(item => ({ id:item.id,scale:item.scale })); await this.store.save(); return items; }
  async forModel(model) { const selected=[]; for (const item of this.store.state.loraStack) { const adapter=this.store.state.adapters.find(a => a.id===item.id); if (!adapter?.ggufPath || adapter.baseGguf!==model.path) continue; await fs.access(adapter.ggufPath); selected.push({ id:adapter.id,name:adapter.name,path:adapter.ggufPath,scale:item.scale,bytes:(await fs.stat(adapter.ggufPath)).size }); } return selected; }
  async remove(id) { this.store.state.adapters=this.store.state.adapters.filter(a => a.id!==id); this.store.state.loraStack=this.store.state.loraStack.filter(a => a.id!==id); await this.store.save(); return { removed:true,filesKept:true }; }
}
