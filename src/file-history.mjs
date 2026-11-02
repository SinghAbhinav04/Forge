import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson,readJson } from './storage.mjs';
import { confined,hash,inspectWrite,writeFile } from './files.mjs';

export class FileHistory {
  constructor(store){this.directory=path.join(store.dataDir,'file-history');this.undoing=false;}
  async record(workspaceId,file,before,after,existed){
    await fs.mkdir(this.directory,{recursive:true});const id=randomUUID();
    const entry={id,workspaceId,path:file,before,afterHash:hash(after),existed,created:Date.now(),undone:false};
    await atomicJson(path.join(this.directory,`${id}.json`),JSON.stringify(entry));return entry;
  }
  async discard(id){await fs.rm(path.join(this.directory,`${id}.json`),{force:true});}
  async get(id){if(typeof id!=='string' || !/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid history entry.');return readJson(path.join(this.directory,`${id}.json`));}
  async list(workspaceId){
    let names;try{names=await fs.readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const entries=[];for(const name of names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){try{const item=await readJson(path.join(this.directory,name));if(item.workspaceId===workspaceId)entries.push({id:item.id,path:item.path,created:item.created,existed:item.existed,undone:item.undone});}catch{}}
    return entries.sort((a,b)=>b.created-a.created).slice(0,100);
  }
  async undo(id,workspace){
    if(this.undoing)throw new Error('Another undo is in progress.');this.undoing=true;
    try{const item=await this.get(id);if(item.workspaceId!==workspace.id)throw new Error('This change belongs to another project.');if(item.undone)throw new Error('This change has already been undone.');
      const current=await inspectWrite(workspace.path,item.path,item.before);if(!current.exists || hash(current.before)!==item.afterHash)throw new Error('The file changed since this assistant edit. Open it and review before restoring an earlier version.');
      if(item.existed)await writeFile(workspace.path,item.path,item.before,item.afterHash);
      else {const target=await confined(workspace.path,item.path);const check=await inspectWrite(workspace.path,item.path,item.before);if(!check.exists || hash(check.before)!==item.afterHash)throw new Error('The file changed while undoing.');await fs.unlink(target);}
      item.undone=true;item.undoneAt=Date.now();await atomicJson(path.join(this.directory,`${id}.json`),JSON.stringify(item));return {undone:true,path:item.path,removed:!item.existed};
    }finally{this.undoing=false;}
  }
}
