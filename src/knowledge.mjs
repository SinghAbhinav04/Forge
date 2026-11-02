import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { confined,listFiles } from './files.mjs';
import { atomicJson,readJson } from './storage.mjs';
import { extractInWorker } from './document-worker-client.mjs';

const validId=/^[a-zA-Z0-9_-]+$/;
const extensions=new Set(['.pdf','.docx','.doc','.txt','.md','.json','.jsonl','.csv','.tsv']);
const maxFileBytes=32*1024**2,maxText=1_000_000,maxFiles=50;
const stopWords=new Set(['the','and','for','with','what','when','where','which','that','this','from','about','your','does','have','into','are','was','were','how','can','you','our','their','they','is','in','to','of','on','at','an','by','as','or','be','do']);
const terms=text=>[...new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(word=>!stopWords.has(word)))].slice(0,20);
const revision=stat=>`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
export function validateSources(input){
  if(!Array.isArray(input) || input.length>5)throw new Error('Invalid saved project sources.');
  return input.map(source=>{if(!source || typeof source.path!=='string' || !source.path || source.path.length>1024 || typeof source.text!=='string' || source.text.length>700 || !((source.startLine===null && source.endLine===null) || (Number.isInteger(source.startLine) && source.startLine>0 && Number.isInteger(source.endLine) && source.endLine>=source.startLine)))throw new Error('Invalid saved project source.');return {path:source.path,text:source.text,startLine:source.startLine,endLine:source.endLine};});
}
export function sourceExcerpt(source,query,maxLength){
  const lower=source.text.toLocaleLowerCase();const positions=terms(query).map(word=>lower.indexOf(word)).filter(position=>position>=0);const hit=positions.length ? Math.min(...positions) : 0;
  let start=Math.max(0,hit-Math.floor(maxLength/3));if(start>0){const next=source.text.indexOf('\n',start);if(next>=0 && next<hit)start=next+1;}
  const text=source.text.slice(start,start+maxLength);const startLine=source.startLine ? Math.min(source.endLine,source.startLine+(source.text.slice(0,start).match(/\n/g) || []).length) : null;const endLine=startLine ? Math.min(source.endLine,startLine+(text.match(/\n/g) || []).length) : null;
  return {...source,startLine,endLine,text};
}

export function splitKnowledge(text) {
  const lines=text.split(/\r?\n/),chunks=[];let current=[],size=0,start=1,end=1;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];for(let offset=0;offset<Math.max(1,line.length);offset+=1200){const part=line.slice(offset,offset+1200);if(size+part.length>1500 && current.length){chunks.push({startLine:start,endLine:end,text:current.join('\n')});current=[];size=0;start=i+1;}current.push(part);end=i+1;size+=part.length+1;}
  }
  if(current.length)chunks.push({startLine:start,endLine:lines.length,text:current.join('\n')});return chunks.filter(chunk=>chunk.text.trim());
}

export class KnowledgeStore {
  constructor(dataDir){this.dataDir=path.resolve(dataDir);this.directory=path.join(this.dataDir,'knowledge');this.jobs=new Map();this.mutating=new Set();}
  async isAppData(file){let data;try{data=await fs.realpath(this.dataDir);}catch(error){if(error.code!=='ENOENT')throw error;data=this.dataDir;}const relative=path.relative(data,file);return !relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative));}
  file(id){if(!validId.test(id || ''))throw new Error('Invalid project ID.');return path.join(this.directory,`${id}.json`);}
  jobFile(id){this.file(id);return path.join(this.directory,`${id}.job.json`);}
  async read(id){try{const value=await readJson(this.file(id));if(value.version!==1 || !Array.isArray(value.documents))throw new Error('Invalid knowledge index.');return value;}catch(error){if(error.code==='ENOENT')return {version:1,documents:[]};throw error;}}
  async save(id,value){await fs.mkdir(this.directory,{recursive:true});await atomicJson(this.file(id),JSON.stringify(value));}
  async saveJob(id){await fs.mkdir(this.directory,{recursive:true});await atomicJson(this.jobFile(id),JSON.stringify(this.snapshot(id)));}
  async runJob(id,job,operation){try{await operation();}catch(error){if(job.status!=='cancelled'){job.status='error';job.error=error.message;}}finally{try{await this.saveJob(id);}catch(error){if(job.status!=='cancelled'){job.status='error';job.error=`Could not save indexing status: ${error.message}`;}}job.done=true;}}
  snapshot(id){const job=this.jobs.get(id);return job ? {id:job.id,status:job.status,path:job.path,error:job.error || null,...(job.total!==undefined ? {total:job.total,processed:job.processed,failed:job.failed,limited:job.limited,errors:job.errors} : {})} : null;}
  snapshots(){return [...this.jobs.keys()].map(id=>({workspaceId:id,...this.snapshot(id)}));}
  async list(workspace){const index=await this.read(workspace.id);let job=this.snapshot(workspace.id);if(!job)try{job=await readJson(this.jobFile(workspace.id));if(['running','saving'].includes(job?.status))job={...job,status:'interrupted',error:'Indexing was interrupted. Start indexing again to continue.'};}catch(error){if(error.code!=='ENOENT')throw error;}return {documents:index.documents.map(({chunks,...document})=>document),job};}
  async start(workspace,relative){
    if(this.mutating.has(workspace.id) || this.jobs.has(workspace.id) && !this.jobs.get(workspace.id).done)throw new Error('Wait for the current indexing job or cancel it.');
    this.mutating.add(workspace.id);try{
      if(typeof relative!=='string' || !extensions.has(path.extname(relative).toLowerCase()))throw new Error('Choose a PDF, Word, text, Markdown, JSON, CSV or TSV file in this project.');
      const file=await confined(workspace.path,relative);if(await this.isAppData(file))throw new Error('Forge application data cannot be indexed as project knowledge.');const stat=await fs.stat(file);if(!stat.isFile() || stat.size>maxFileBytes)throw new Error('Choose a file smaller than 32 MiB.');
      const current=await this.read(workspace.id);if(current.documents.length>=maxFiles && !current.documents.some(doc=>doc.path===relative))throw new Error('A project can index at most 50 files.');
      const job={id:randomUUID(),status:'running',path:relative,controller:new AbortController()};this.jobs.set(workspace.id,job);try{await this.saveJob(workspace.id);}catch(error){this.jobs.delete(workspace.id);throw error;}
      job.task=this.runJob(workspace.id,job,()=>this.index(workspace,relative,file,revision(stat),job));return this.snapshot(workspace.id);
    }finally{this.mutating.delete(workspace.id);}
  }
  async index(workspace,relative,file,initialRevision,job,{batch=false}={}){
    try{
      const text=await extractInWorker(file,{signal:job.controller.signal});
      if(job.status==='cancelled')return;
      const target=await confined(workspace.path,relative);const current=await fs.stat(target);if(revision(current)!==initialRevision)throw new Error('The file changed during indexing. Index it again.');
      if(typeof text!=='string' || !text.trim())throw new Error('No readable text found. Scanned documents may need OCR.');
      const index=await this.read(workspace.id);const truncated=text.length>maxText;const chunks=splitKnowledge(text.slice(0,maxText));const doc={path:relative,revision:initialRevision,indexedAt:Date.now(),bytes:current.size,truncated,extracted:!['.txt','.md','.json','.jsonl','.csv','.tsv'].includes(path.extname(relative).toLowerCase()),chunks};
      index.documents=index.documents.filter(item=>item.path!==relative);if(index.documents.length>=maxFiles)throw new Error('A project can index at most 50 files.');index.documents.push(doc);if(job.status==='cancelled')return;job.status='saving';await this.save(workspace.id,index);job.status=batch?'running':'completed';
    }catch(error){if(job.status!=='cancelled'){job.status='error';job.error=error.message;}}
  }
  async startFolder(workspace,relative='.'){
    if(this.mutating.has(workspace.id) || this.jobs.has(workspace.id) && !this.jobs.get(workspace.id).done)throw new Error('Wait for the current indexing job or cancel it.');this.mutating.add(workspace.id);
    try{const target=await confined(workspace.path,relative);if(!(await fs.stat(target)).isDirectory())throw new Error('Choose a project folder.');const base=await fs.realpath(workspace.path);const queue=[relative],files=[];let visited=0,limited=false;
      while(queue.length && visited<1000 && files.length<maxFiles){const folder=queue.shift();const entries=await listFiles(workspace.path,folder);if(entries.length===500)limited=true;for(const entry of entries){visited++;if(await this.isAppData(path.resolve(base,entry.path)))continue;if(entry.directory)queue.push(entry.path);else if(extensions.has(path.extname(entry.path).toLowerCase()))files.push(entry.path);if(visited>=1000 || files.length>=maxFiles){limited=true;break;}}}
      if(queue.length)limited=true;if(!files.length)throw new Error('No supported files were found in this folder.');const job={id:randomUUID(),status:'running',path:relative,controller:new AbortController(),total:files.length,processed:0,failed:0,limited,errors:[]};this.jobs.set(workspace.id,job);try{await this.saveJob(workspace.id);}catch(error){this.jobs.delete(workspace.id);throw error;}job.task=this.runJob(workspace.id,job,()=>this.indexFolder(workspace,files,job));return this.snapshot(workspace.id);
    }finally{this.mutating.delete(workspace.id);}
  }
  async indexFolder(workspace,files,job){
    for(const relative of files){if(job.status==='cancelled')return;try{const file=await confined(workspace.path,relative),stat=await fs.stat(file);if(!stat.isFile() || stat.size>maxFileBytes)throw new Error('File is unavailable or too large.');await this.index(workspace,relative,file,revision(stat),job,{batch:true});if(job.status==='cancelled')return;if(job.status==='error'){job.failed++;if(job.errors.length<10)job.errors.push({path:relative,message:job.error});job.status='running';job.error=null;}}catch(error){job.failed++;if(job.errors.length<10)job.errors.push({path:relative,message:error.message});}job.processed++;await this.saveJob(workspace.id);}
    if(job.status!=='cancelled')job.status='completed';
  }
  async cancel(id){const job=this.jobs.get(id);if(!job || job.status!=='running')throw new Error('No indexing job is running.');job.status='cancelled';job.controller.abort(new Error('Indexing cancelled.'));await job.task;return this.snapshot(id);}
  async remove(workspace,relative){if(this.mutating.has(workspace.id) || this.jobs.has(workspace.id) && !this.jobs.get(workspace.id).done)throw new Error('Wait for indexing to finish.');this.mutating.add(workspace.id);try{const index=await this.read(workspace.id);if(!index.documents.some(item=>item.path===relative))throw new Error('Indexed document not found.');index.documents=index.documents.filter(item=>item.path!==relative);await this.save(workspace.id,index);return this.list(workspace);}finally{this.mutating.delete(workspace.id);}}
  async search(workspace,query){
    if(typeof query!=='string' || query.length>100000)throw new Error('Enter a question of at most 100,000 characters.');const words=terms(query.slice(0,1000));const index=await this.read(workspace.id),matches=[],stale=[];if(!words.length)return {sources:[],stale:[],indexedCount:index.documents.length};
    for(const doc of index.documents){try{const file=await confined(workspace.path,doc.path);if(await this.isAppData(file)){stale.push(doc.path);continue;}const info=await fs.stat(file);if(revision(info)!==doc.revision){stale.push(doc.path);continue;}}catch{stale.push(doc.path);continue;}
      for(const chunk of doc.chunks){const lower=chunk.text.toLocaleLowerCase();const score=words.reduce((n,word)=>n+(lower.includes(word)?1:0),0);if(score)matches.push({path:doc.path,startLine:doc.extracted ? null : chunk.startLine,endLine:doc.extracted ? null : chunk.endLine,text:chunk.text,score});}}
    matches.sort((a,b)=>b.score-a.score || a.path.localeCompare(b.path) || (a.startLine || 0)-(b.startLine || 0));return {sources:matches.slice(0,5),stale,indexedCount:index.documents.length};
  }
  async close(){await Promise.allSettled([...this.jobs.entries()].map(([id,job])=>job.status==='running' ? this.cancel(id) : job.task));}
}
