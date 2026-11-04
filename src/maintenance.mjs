import fs from 'node:fs/promises';
import path from 'node:path';

const ageLimit=7*24*60*60*1000;
const uuid=/^[a-f0-9-]{36}$/;
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function treeSize(folder){let bytes=0,count=0;const pending=[folder];while(pending.length && count<10000){const dir=pending.pop();for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(++count>10000)break;const target=path.join(dir,entry.name);if(entry.isDirectory())pending.push(target);else if(entry.isFile())bytes+=(await fs.stat(target)).size;}}return bytes;}

export async function maintenancePreview(store,runtime,trainer,converter){
  const data=store.dataDir,items=[];const currentDataset=trainer.job?.config?.dataset;const activeTraining=Boolean(trainer.child);
  const datasetDir=path.join(data,'datasets');let datasetNames=[];try{datasetNames=await fs.readdir(datasetDir);}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const name of datasetNames.filter(n=>/^[a-f0-9-]{36}\.review\.json$/.test(n))){const id=name.slice(0,36),review=path.join(datasetDir,name),prepared=path.join(datasetDir,`${id}.jsonl`);if(prepared===currentDataset)continue;try{const a=await fs.lstat(review),b=await fs.lstat(prepared);if(!a.isFile() || !b.isFile() || Date.now()-Math.max(a.mtimeMs,b.mtimeMs)<ageLimit)continue;items.push({id:`dataset:${id}`,kind:'dataset',name:`Old prepared preview ${id.slice(0,8)}`,bytes:a.size+b.size,revision:`${a.mtimeMs}:${a.size}:${b.mtimeMs}:${b.size}`,paths:[review,prepared]});}catch{}}
  const trainingDir=path.join(data,'training');let jobs=[];try{jobs=await fs.readdir(trainingDir,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const job of jobs){if(!job.isDirectory() || !uuid.test(job.name) || activeTraining && trainer.job?.id===job.name)continue;const folder=path.join(trainingDir,job.name);let latest='';try{latest=path.basename(JSON.parse(await fs.readFile(path.join(folder,'latest.json'),'utf8')).path || '');}catch{}
    for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(!entry.isDirectory() || !/^checkpoint-\d+$/.test(entry.name) || entry.name===latest)continue;const target=path.join(folder,entry.name);const info=await fs.lstat(target);if(Date.now()-info.mtimeMs<ageLimit)continue;items.push({id:`checkpoint:${job.name}:${entry.name}`,kind:'checkpoint',name:`Older checkpoint ${entry.name} · ${job.name.slice(0,8)}`,bytes:await treeSize(target),revision:`${info.mtimeMs}`,paths:[target]});}
  }
  let runtimeReady=false;try{await runtime.executable(store.state.settings);runtimeReady=true;}catch{}
  const python=process.platform==='win32'?'Scripts/python.exe':'bin/python';
  const health={modelFolder:await exists(store.state.settings.modelDir),runtime:runtimeReady,trainingEnvironment:await exists(path.join(data,'training-env',python)) || await exists(path.join(data,'training-env-cuda','ready')),conversionEnvironment:await exists(path.join(data,'conversion-env',python)),trainingActive:activeTraining,conversionActive:Boolean(converter.active)};
  return {health,items:items.map(({paths,...item})=>item),totalBytes:items.reduce((n,item)=>n+item.bytes,0),_items:items};
}
export async function cleanupArtifacts(store,runtime,trainer,converter,selected){
  if(trainer.child || converter.active)throw new Error('Stop training and conversion before cleaning up.');
  if(!Array.isArray(selected) || selected.length>200 || selected.some(i=>!i || typeof i.id!=='string' || typeof i.revision!=='string'))throw new Error('Choose items from the storage preview.');
  const preview=await maintenancePreview(store,runtime,trainer,converter);const found=selected.map(s=>preview._items.find(i=>i.id===s.id && i.revision===s.revision));
  if(found.some(i=>!i))throw new Error('The storage preview changed. Refresh it before deleting.');
  for(const item of found)for(const target of item.paths){const info=await fs.lstat(target);if(info.isSymbolicLink())throw new Error('Linked storage items cannot be removed.');if(item.kind==='checkpoint')await fs.rm(target,{recursive:true});else await fs.unlink(target);}
  return {removed:found.length,bytes:found.reduce((n,i)=>n+i.bytes,0)};
}
