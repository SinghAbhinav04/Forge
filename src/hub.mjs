import fs from 'node:fs/promises';
import { createReadStream,createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash,randomUUID } from 'node:crypto';
const repoPattern=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
async function checked(url,options={}) { const response=await fetch(url,{ ...options,signal:options.signal || AbortSignal.timeout(20000) }); if (!response.ok) throw new Error(`Hugging Face returned ${response.status}. Private/gated models require a separate manual download.`); return response; }
export async function searchModels(query) { const p=new URLSearchParams({ search:query,filter:'gguf',sort:'downloads',direction:'-1',limit:'12' }); return (await (await checked(`https://huggingface.co/api/models?${p}`)).json()).map(m => ({ id:m.id,downloads:m.downloads,likes:m.likes })); }
export async function modelFiles(repo) { if (!repoPattern.test(repo)) throw new Error('Use an owner/model repository ID.'); const model=await (await checked(`https://huggingface.co/api/models/${repo}?blobs=true`)).json(); return (model.siblings || []).filter(f => /\.gguf$/i.test(f.rfilename)).map(f => ({ name:f.rfilename,kind:/mmproj/i.test(f.rfilename) ? 'projector' : 'model',bytes:f.size || f.lfs?.size || 0,sha256:f.lfs?.sha256 || null })); }
export class Downloads {
  constructor(store) { this.store=store; this.jobs=new Map(); this.controllers=new Map(); this.tasks=new Map(); for (const job of store.state.downloads || []) this.jobs.set(job.id,{ ...job,status:['downloading','verifying','pausing'].includes(job.status) ? 'paused' : job.status }); }
  snapshot() { return [...this.jobs.values()].map(({ destination,...job }) => job); }
  async persist() { this.store.state.downloads=[...this.jobs.values()]; await this.store.save(); }
  async create(repo,file) {
    const found=(await modelFiles(repo)).find(f => f.name===file); if (!found || !found.bytes || !found.sha256) throw new Error('This file has no published LFS size/checksum; download it manually.');
    const folder=await fs.realpath(this.store.state.settings.modelDir); const name=`${repo.replace('/','--')}--${path.basename(file)}`; const destination=path.join(folder,name);
    if ([...this.jobs.values()].some(j => j.destination===destination && !['cancelled','error'].includes(j.status))) throw new Error('This file already has a download.');
    try { await fs.access(destination); throw new Error('This model file already exists.'); } catch (e) { if (e.code!=='ENOENT') throw e; }
    const job={ id:randomUUID(),repo,file,name,bytes:found.bytes,sha256:found.sha256,received:0,status:'paused',destination,error:'' }; this.jobs.set(job.id,job); await this.persist(); this.resume(job.id); return this.snapshot().find(j => j.id===job.id);
  }
  resume(id) {
    const job=this.jobs.get(id); if (!job || !['paused','error'].includes(job.status) || this.controllers.has(id)) throw new Error('This download cannot be resumed yet.');
    const controller=new AbortController(); this.controllers.set(id,controller); job.status='downloading'; job.error='';
    const task=this.run(job,controller).finally(() => { this.controllers.delete(id); this.tasks.delete(id); }); this.tasks.set(id,task); void task.catch(() => {});
  }
  async run(job,controller) {
    const partial=`${job.destination}.part`;
    try {
      let offset=0; try { offset=(await fs.stat(partial)).size; } catch (e) { if (e.code!=='ENOENT') throw e; }
      const disk=await fs.statfs(path.dirname(partial)); if (disk.bavail*disk.bsize < job.bytes-offset+1024**3) throw new Error('Not enough free disk space; keep at least 1 GiB free.');
      const file=job.file.split('/').map(encodeURIComponent).join('/');
      const response=await checked(`https://huggingface.co/${job.repo}/resolve/main/${file}`,{ headers:offset ? { Range:`bytes=${offset}-` } : {},signal:controller.signal });
      if (offset && response.status===206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('Server returned an invalid resume range.');
      if (response.status!==206) offset=0; job.received=offset;
      const progress=async function* (body) { for await (const chunk of body) { job.received+=chunk.length; yield chunk; } };
      await pipeline(progress(response.body),createWriteStream(partial,{ flags:offset ? 'a' : 'w' }),{ signal:controller.signal });
      controller.signal.throwIfAborted(); job.status='verifying'; if (job.received!==job.bytes) throw new Error('Downloaded size does not match model metadata.');
      const hash=createHash('sha256'); for await (const chunk of createReadStream(partial)) { controller.signal.throwIfAborted(); hash.update(chunk); }
      if (hash.digest('hex')!==job.sha256) throw new Error('Model checksum mismatch; cancel this download and retry.');
      const handle=await fs.open(partial,'r'); const magic=Buffer.alloc(4); try { await handle.read(magic,0,4,0); } finally { await handle.close(); } if (magic.toString()!=='GGUF') throw new Error('Downloaded file is not GGUF.');
      await fs.rename(partial,job.destination); job.status='completed';
    } catch (e) { if (!controller.signal.aborted) { job.status='error'; job.error=e.message; } }
    finally { if (job.status==='cancelled') await fs.rm(partial,{ force:true }); await this.persist(); }
  }
  async control(id,action) { const job=this.jobs.get(id); if (!job) throw new Error('Download not found.'); if (action==='resume') this.resume(id); else if (['pause','cancel'].includes(action)) { if (job.status==='completed') throw new Error('Completed models are managed in the library.'); job.status=action==='pause' ? 'pausing' : 'cancelled'; this.controllers.get(id)?.abort(); await this.tasks.get(id); if (action==='pause') job.status='paused'; else await fs.rm(`${job.destination}.part`,{ force:true }); } else throw new Error('Unknown download action.'); await this.persist(); return this.snapshot(); }
  async close() { for (const [id,c] of this.controllers) { this.jobs.get(id).status='paused'; c.abort(); } await Promise.allSettled([...this.tasks.values()]); await this.persist(); }
}
