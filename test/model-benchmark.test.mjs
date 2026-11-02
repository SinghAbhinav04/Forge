import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkModel } from '../src/model-benchmark.mjs';
import { createApplication } from '../src/server.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('model benchmark reports actual runtime generation timings over repeated runs',async()=>{
 let calls=0;const runtime={status:'ready',model:{bytes:123,mtimeMs:456},plan:{mode:'hybrid',gpuLayers:12},configuration:{contextSize:4096},async completion(body){assert.equal(body.stream,false);calls++;return Response.json({timings:{predicted_per_second:calls*10,predicted_n:32}});}};const result=await benchmarkModel(runtime);assert.deepEqual(result.samples,[10,20,30]);assert.equal(result.mean,20);assert.equal(result.min,10);assert.equal(result.max,30);assert.equal(result.modelMtimeMs,456);assert.equal(result.gpuLayers,12);
 runtime.completion=async()=>Response.json({timings:{predicted_per_second:30,predicted_n:2}});await assert.rejects(()=>benchmarkModel(runtime),/not report enough/);runtime.remote={base:'x'};await assert.rejects(()=>benchmarkModel(runtime),/local model/);
});

test('benchmark API reserves the runtime, persists measured results, and releases it on cancellation',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-bench-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let hold=false;
 const runtime={status:'ready',busy:false,model:{path:'/fixture.gguf',bytes:100,mtimeMs:200},plan:{mode:'cpu',gpuLayers:0},configuration:{contextSize:2048},snapshot(){return {status:this.status,busy:this.busy};},async completion(_body,signal){if(hold)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return Response.json({timings:{predicted_per_second:12,predicted_n:24}});},async stop(){this.status='stopped';}};
 const app=await createApplication({appRoot:root,runtime});t.after(()=>app.close());const post=async route=>fetch(app.origin+route,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Desk-Token':app.token},body:'{}'});
 const response=await post('/api/model/benchmark');assert.equal(response.status,200);assert.equal((await response.json()).mean,12);assert.equal(app.store.state.modelBenchmarks['/fixture.gguf'].samples.length,3);assert.equal(runtime.busy,false);
 hold=true;const pending=post('/api/model/benchmark');for(let i=0;i<100 && !runtime.busy;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(runtime.busy,true);assert.equal((await post('/api/model/benchmark/cancel')).status,200);assert.equal((await pending).status,400);assert.equal(runtime.busy,false);
});
