import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { openStore } from '../src/store.mjs';
import { Trainer,trainingPython,trainingEnvironment } from '../src/trainer.mjs';
const root=path.resolve('.'); const output=path.resolve('test-artifacts/trainer'); await fs.mkdir(output,{ recursive:true });
const python=trainingPython(path.resolve('.data'));
await new Promise((resolve,reject) => execFile(python,['scripts/create-training-fixture.py',output],{ windowsHide:true,env:{ ...process.env,HF_HUB_OFFLINE:'1' },timeout:60000 },(e,stdout,stderr) => { if (e) reject(new Error(stderr || e.message)); else { console.log(stdout.trim()); resolve(); } }));
const dataDir=path.join(output,`data-${Date.now()}`); const store=await openStore(root,dataDir,path.join(output,'workspace'));
await fs.symlink(path.resolve('.data/training-env'),path.join(dataDir,'training-env'),process.platform==='win32' ? 'junction' : 'dir');
const runtime={ status:'stopped' }; const trainer=new Trainer(root,store,runtime);
const until=async (predicate,timeout=90000) => { const end=Date.now()+timeout; while (!predicate()) { if (Date.now()>end || trainer.job?.status==='error') throw new Error(`Training wait failed: ${trainer.job?.error}\n${trainer.logs.slice(-25).join('\n')}`); await new Promise(r => setTimeout(r,20)); } };
try {
  assert.ok((await trainingEnvironment(dataDir)).installed);
  await trainer.start({ baseModel:path.join(output,'base'),dataset:path.join(output,'samples.jsonl'),device:'cpu',epochs:2,maxSteps:120,maxLength:32,batchSize:1,gradientAccumulation:1,loraRank:4,saveEvery:5 });
  await until(() => trainer.job.step>=2); await trainer.control('pause'); await until(() => trainer.job.status==='paused' && !trainer.child);
  const paused=trainer.job.step; assert.ok(trainer.job.checkpoint); await fs.access(path.join(trainer.job.checkpoint,'training_state.pt'));
  console.log(`Paused at completed optimizer step ${paused}; adapter and optimizer checkpoint saved.`);
  await trainer.control('resume'); await until(() => trainer.job.step>paused+2); await trainer.control('cancel'); await until(() => !trainer.child);
  assert.equal(trainer.job.status,'cancelled'); console.log('Resumed actual training and cancelled the worker.');
  await trainer.control('resume'); await until(() => trainer.job.status==='completed' && !trainer.child);
  await fs.access(path.join(trainer.job.output,'adapter','adapter_model.safetensors'));
  const result={ status:trainer.job.status,steps:trainer.job.step,loss:trainer.job.loss,checkpoint:trainer.job.checkpoint,output:trainer.job.output };
  assert.equal(result.steps,120); assert.ok(Number.isFinite(result.loss));
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
  console.log('Training smoke passed: real LoRA updates, checkpoint pause, resume, cancellation, and final adapter export.');
} finally { await trainer.close(); }
