import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { modelFiles,Downloads } from '../src/hub.mjs';
import { Runtime,sseData } from '../src/runtime.mjs';
const root=path.resolve('.'); const directory=path.resolve('test-artifacts/runtime-modes'); await fs.mkdir(directory,{ recursive:true });
const state={ settings:{ modelDir:directory } }; const store={ state,save:async () => {} }; const downloads=new Downloads(store);
const files=await modelFiles('ggml-org/models'); const file=files.find(f => /stories15M-q4_0\.gguf$/.test(f.name)); if (!file) throw new Error('Official small test model is unavailable.');
const destination=path.join(directory,`ggml-org--models--${path.basename(file.name)}`);
try { await fs.access(destination); } catch { const job=await downloads.create('ggml-org/models',file.name); while (!['completed','error'].includes(downloads.jobs.get(job.id).status)) await new Promise(r => setTimeout(r,100)); if (downloads.jobs.get(job.id).status!=='completed') throw new Error(downloads.jobs.get(job.id).error); }
const runtime=new Runtime(root); const results=[];
try {
  for (const executionMode of ['cpu','gpu','hybrid']) {
    const settings={ executionMode,gpuLayers:2,contextSize:512,threads:2,performanceMode:'responsive',batchSize:64,microBatchSize:32,kvOnGpu:false,reserveRamGiB:2,thinking:'auto' };
    await runtime.load({ path:destination,name:'stories15M-test',bytes:(await fs.stat(destination)).size },settings);
    const deadline=Date.now()+120000; while (runtime.status==='loading' && Date.now()<deadline) await new Promise(r => setTimeout(r,100));
    if (runtime.status!=='ready') throw new Error(`${executionMode}: ${runtime.error}\n${runtime.logs.slice(-20).join('\n')}`);
    const response=await runtime.completion({ messages:[{ role:'user',content:'Once upon a time' }],stream:true,max_tokens:20,temperature:0 },AbortSignal.timeout(60000));
    let text=''; for await (const event of sseData(response.body)) text+=event.choices?.[0]?.delta?.content || '';
    assert.ok(text.length>0,`${executionMode} did not generate text`);
    const offload=runtime.offloadEvidence || runtime.logs.filter(l => /offload.*layer|layers.*offload/i.test(l));
    await fs.writeFile(path.join(directory,`${executionMode}.log`),runtime.logs.join('\n'));
    console.log(`${executionMode} offload evidence: ${JSON.stringify(offload)}`);
    if (executionMode!=='cpu') assert.ok(offload.some(l => /offloaded [1-9]/.test(l)),`${executionMode} did not actually offload model layers`);
    results.push({ mode:executionMode,plan:runtime.plan,offload,text }); console.log(`${executionMode} mode passed: model loaded and generated text${offload.length ? ` · ${offload.at(-1)}` : ''}`);
    await runtime.stop();
  }
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(results,null,2));
} finally { runtime.busy=false; await runtime.stop(); await downloads.close(); }
