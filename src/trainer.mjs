import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn,execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { reviewedDataset } from './datasets.mjs';
export const trainingPython = dataDir => path.join(dataDir,'training-env',process.platform==='win32' ? 'Scripts/python.exe' : 'bin/python');
const run = (command,args,options={}) => new Promise((resolve,reject) => execFile(command,args,{ windowsHide:true,timeout:20000,...options },(error,stdout) => error ? reject(error) : resolve(stdout)));
const externalScript=(root,name) => path.join(root.endsWith('.asar') ? `${root}.unpacked` : root,'scripts',name);
const killTree=child => { if (!child?.pid) return; if (process.platform==='win32') execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{ windowsHide:true },() => {}); else { try { process.kill(-child.pid,'SIGTERM'); } catch { child.kill(); } } };
export async function modelWeightBytes(folder) {let bytes=0;for(const f of await fs.readdir(folder,{withFileTypes:true}))if((f.isFile() || f.isSymbolicLink()) && /\.(?:safetensors|bin)$/.test(f.name)){const info=await fs.stat(path.join(folder,f.name));if(info.isFile())bytes+=info.size;}return bytes;}
export async function trainingEnvironment(dataDir) {
  const python=trainingPython(dataDir);
  try { return { installed:true,python,...JSON.parse(await run(python,['-c','import torch,transformers,peft; import json; print(json.dumps({"torch":torch.__version__,"cuda":torch.cuda.is_available(),"mps":bool(hasattr(torch.backends,"mps") and torch.backends.mps.is_available())}))'])) }; }
  catch { return { installed:false,python,cuda:false,mps:false }; }
}
export class Trainer {
  constructor(appRoot,store,runtime) { this.appRoot=appRoot; this.store=store; this.runtime=runtime; this.child=null; this.logs=[]; this.job=store.state.trainingJob || null; if (this.job && ['running','pausing','installing','resuming'].includes(this.job.status)) this.job.status='interrupted'; }
  snapshot() { return { job:this.job,logs:this.logs.slice(-100) }; }
  log(text) { this.logs.push(...String(text).split(/\r?\n/).filter(Boolean)); this.logs=this.logs.slice(-200); }
  async persist() { this.store.state.trainingJob=this.job; await this.store.save(); }
  async install() {
    if (this.child || !['stopped','error'].includes(this.runtime.status)) throw new Error('Unload the inference model and stop any training job before installing.');
    const script=externalScript(this.appRoot,'setup-training.mjs');
    // Electron's executable can run Node scripts with ELECTRON_RUN_AS_NODE.
    this.job={ id:randomUUID(),status:'installing',created:Date.now() }; this.logs=[];
    this.child=spawn(process.execPath,[script,'--data',this.store.dataDir],{ windowsHide:true,detached:process.platform!=='win32',env:{ ...process.env,ELECTRON_RUN_AS_NODE:'1' },stdio:['ignore','pipe','pipe'] });
    this.attach(this.child,true); await this.persist(); return this.snapshot();
  }
  async start(input) {
    if (this.child || !['stopped','error'].includes(this.runtime.status)) throw new Error('Unload the inference model before training to keep memory available.');
    if (input.confirmedPreview!==true) throw new Error('Review the original and prepared examples, then confirm the training preview.');
    const imported=await reviewedDataset(input.reviewId,input.dataset,this.store.dataDir);
    const env=await trainingEnvironment(this.store.dataDir); if (!env.installed) throw new Error('Install the optional training engine first.');
    if (typeof input.baseModel!=='string' || !path.isAbsolute(input.baseModel) || /\.gguf$/i.test(input.baseModel)) throw new Error('Choose a local Hugging Face model folder, not a GGUF file. Training produces a LoRA adapter.');
    await fs.access(path.join(input.baseModel,'config.json'));
    const device=!input.device || input.device==='auto' ? env.cuda ? 'cuda' : env.mps ? 'mps' : 'cpu' : input.device;
    const config={ baseModel:input.baseModel,dataset:imported.path,datasetSource:input.dataset,datasetMode:imported.mode,datasetExamples:imported.examples,selectedSpeaker:imported.selectedSpeaker,lossMode:imported.lossMode,device };
    if(input.gradientCheckpointing!==undefined && typeof input.gradientCheckpointing!=='boolean') throw new Error('Invalid gradient checkpointing setting.');
    config.gradientCheckpointing=input.gradientCheckpointing===true;
    for (const [key,defaultValue,min,max,integer] of [['epochs',1,0.1,20,false],['learningRate',0.0002,0.000001,0.1,false],['batchSize',1,1,4,true],['gradientAccumulation',4,1,32,true],['maxLength',256,32,2048,true],['loraRank',8,2,64,true],['saveEvery',10,1,1000,true],['maxSteps',100,1,100000,true]]) { const v=input[key] ?? defaultValue; if (typeof v!=='number' || !Number.isFinite(v) || v<min || v>max || (integer && !Number.isInteger(v))) throw new Error(`Invalid training ${key}.`); config[key]=v; }
    if (!['cpu','cuda','mps'].includes(config.device)) throw new Error('Select CPU, CUDA or Apple Metal.');
    if (config.device==='cuda' && !env.cuda) throw new Error('The training engine has no CUDA support. Use CPU, or install a CUDA-enabled PyTorch build into the displayed training environment.');
    if (config.device==='mps' && !env.mps) throw new Error('Apple Metal training is unavailable in this environment.');
    const bytes=await modelWeightBytes(input.baseModel);
    if (!bytes) throw new Error('The model folder has no readable Hugging Face weights.');
    const free=os.freemem(); if (free<bytes*2+2*1024**3) throw new Error('Not enough free system RAM for this base model. Use a smaller model or close other model apps.');
    const id=randomUUID(); const output=path.join(this.store.dataDir,'training',id); await fs.mkdir(output,{ recursive:true });
    this.job={ id,name:typeof input.name==='string' ? input.name.slice(0,80) : 'Untitled LoRA',status:'running',created:Date.now(),config,output,step:0,checkpoint:null }; this.logs=[]; await this.persist(); await this.launch(false); return this.snapshot();
  }
  async launch(resume) {
    delete this.job.error;
    const config={ ...this.job.config,output:this.job.output,resume }; await fs.writeFile(path.join(this.job.output,'job.json'),JSON.stringify(config,null,2));
    await fs.writeFile(path.join(this.job.output,'control.json'),'{}');
    const python=trainingPython(this.store.dataDir); const script=externalScript(this.appRoot,'train_lora.py');
    this.child=spawn(python,['-u',script,path.join(this.job.output,'job.json')],{ windowsHide:true,detached:process.platform!=='win32',env:{ ...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'2',TOKENIZERS_PARALLELISM:'false' },stdio:['ignore','pipe','pipe'] });
    this.attach(this.child,false); await this.persist();
  }
  attach(child,installing) {
    let buffer=''; child.once('spawn',() => { try { os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {} });
    child.stdout.on('data',chunk => { this.log(chunk); if (installing) return; buffer+=chunk.toString(); let i; while ((i=buffer.indexOf('\n'))!==-1) { const line=buffer.slice(0,i); buffer=buffer.slice(i+1); try { const event=JSON.parse(line); if (event.type==='progress') Object.assign(this.job,{ step:event.step,loss:event.loss,totalSteps:event.totalSteps }); if (event.type==='checkpoint') this.job.checkpoint=event.path; if (event.type==='status') this.job.status=event.status; if (event.type==='error') { this.job.status='error'; this.job.error=event.message; } } catch {} } });
    child.stderr.on('data',c => this.log(c));
    child.once('error',error => { this.job.status='error'; this.job.error=error.message; this.child=null; void this.persist(); });
    child.once('exit',code => { if (this.child!==child) return; this.child=null; if (this.job.status==='cancelled') {} else if (code!==0) { this.job.status='error'; this.job.error ||= 'Worker stopped. Check training logs; a completed checkpoint can be resumed.'; } else if (installing) this.job.status='installed'; else if (!['paused','completed'].includes(this.job.status)) this.job.status='completed'; if (this.job.status==='completed' && this.adapterLibrary) void this.adapterLibrary.registerJob(this.job).catch(error => { this.job.error=`Adapter export: ${error.message}`; void this.persist(); }); void this.persist(); });
  }
  async control(action) {
    if (!this.job) throw new Error('No training job.');
    if (action==='cancel') { this.job.status='cancelled'; killTree(this.child); await this.persist(); return this.snapshot(); }
    if (action==='pause') { if (!this.child || this.job.status!=='running') throw new Error('No running training job.'); this.job.status='pausing'; await fs.writeFile(path.join(this.job.output,'control.json'),JSON.stringify({ action:'pause' })); }
    else if (action==='resume') { if (this.child || !['paused','interrupted','error','cancelled'].includes(this.job.status)) throw new Error('This job cannot be resumed yet.'); if (!this.job.checkpoint) { try { this.job.checkpoint=JSON.parse(await fs.readFile(path.join(this.job.output,'latest.json'),'utf8')).path; } catch { throw new Error('There is no completed checkpoint to resume. Start a new training job.'); } } if (this.runtime.status!=='stopped') throw new Error('Unload the inference model before resuming training.'); this.job.status='running'; await this.launch(true); }
    else throw new Error('Unknown training action.');
    await this.persist(); return this.snapshot();
  }
  async close() { if (this.child) { killTree(this.child); if (!['installed','completed','cancelled','paused'].includes(this.job.status)) this.job.status='interrupted'; } await this.persist(); }
}
