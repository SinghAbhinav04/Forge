import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ModelConverter,inspectConversionInput } from '../src/model-converter.mjs';
import { converterCommand } from '../src/converter.mjs';
import { openStore } from '../src/store.mjs';
import { scanModels } from '../src/runtime.mjs';
import { createApplication } from '../src/server.mjs';

const sleep=ms => new Promise(resolve => setTimeout(resolve,ms));
async function waitFor(predicate) { const end=Date.now()+5000; while (!await predicate()) { if (Date.now()>end) throw new Error('Timed out'); await sleep(10); } }
function gguf() {
  const text=value => { const bytes=Buffer.from(value); const length=Buffer.alloc(8); length.writeBigUInt64LE(BigInt(bytes.length)); return Buffer.concat([length,bytes]); };
  const header=Buffer.alloc(24); header.write('GGUF'); header.writeUInt32LE(3,4); header.writeBigUInt64LE(1n,16);
  const type=Buffer.alloc(4); type.writeUInt32LE(8);
  return Buffer.concat([header,text('general.architecture'),type,text('llama')]);
}
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'forge-convert-'));
  const source=path.join(dir,'source'); const library=path.join(dir,'models'); const tools=path.join(dir,'tools');
  await Promise.all([source,library,tools].map(folder => fs.mkdir(folder)));
  await fs.writeFile(path.join(source,'config.json'),JSON.stringify({ model_type:'llama' }));
  await fs.writeFile(path.join(source,'tokenizer.json'),'{}'); await fs.writeFile(path.join(source,'model.safetensors'),'fixture weights');
  const store=await openStore(dir,path.join(dir,'data')); store.state.settings.modelDir=library;
  const runtime={ status:'stopped',busy:false,async stop() {},snapshot() { return { status:this.status }; } };
  const script=`const fs=require('node:fs'); const path=require('node:path'); const args=process.argv.slice(2); const source=args[0]; const output=args[args.indexOf('--outfile')+1]; const config=JSON.parse(fs.readFileSync(path.join(source,'config.json'))); fs.writeFileSync(output,Buffer.from('${gguf().toString('base64')}','base64')); console.log('weights written'); if(config.fixture==='fail')process.exit(2); if(config.fixture==='slow')setInterval(()=>{},1000);`;
  await fs.writeFile(path.join(tools,'convert_hf_to_gguf.py'),script);
  const options={ environment:async () => ({ python:process.execPath,source:tools }) };
  const converter=new ModelConverter(store,runtime,options);
  t.after(async () => { await converter.close(); await fs.rm(dir,{ recursive:true,force:true }); });
  return { dir,source,library,tools,store,runtime,options,converter };
}

test('local model conversion publishes an exclusive GGUF and preserves its source',async t => {
  const { converter,source,library,store }=await fixture(t);
  const started=await converter.start({ source,name:'My-model',format:'q8_0' }); assert.equal(started.active,true);
  await converter.task;
  assert.equal(converter.job.status,'completed'); assert.equal(converter.active,false);
  assert.deepEqual((await scanModels(library)).map(m => m.name),['My-model-Q8_0']);
  assert.equal(await fs.readFile(path.join(source,'model.safetensors'),'utf8'),'fixture weights');
  assert.ok(!((await fs.readdir(library)).some(name => name.startsWith('.forge-convert-'))));
  const reopened=await openStore(path.dirname(store.dataDir),store.dataDir); assert.equal(reopened.state.modelConversion.status,'completed');
  await assert.rejects(() => converter.start({ source,name:'My-model',format:'q8_0' }),/already exists/);
});

test('conversion rejects incomplete downloads, invalid names and unsupported formats before creating a job',async t => {
  const { converter,source,library }=await fixture(t);
  await fs.writeFile(path.join(source,'model.safetensors.index.json'),JSON.stringify({ weight_map:{ tensor:'model-00002-of-00002.safetensors' } }));
  await assert.rejects(() => converter.start({ source }),/shard.*missing/);
  await fs.unlink(path.join(source,'model.safetensors.index.json'));
  for (const name of ['../escape','/absolute','CON','bad/name']) await assert.rejects(() => converter.start({ source,name }),/model name/);
  await assert.rejects(() => converter.start({ source,name:42 }),/text model name/);
  await assert.rejects(() => converter.start({ source,format:'execute arbitrary command' }),/output format/);
  await fs.unlink(path.join(source,'tokenizer.json')); await assert.rejects(() => inspectConversionInput({ source },library),/tokenizer/);
  assert.equal(converter.job,null); assert.deepEqual(await fs.readdir(library),[]);
});

test('conversion refuses disk exhaustion and pre-quantized source weights',async t => {
  const { source,library }=await fixture(t);
  const config=path.join(source,'config.json');
  await fs.writeFile(config,JSON.stringify({ model_type:'llama',quantization_config:{ quant_method:'gptq' } }));
  await assert.rejects(() => inspectConversionInput({ source },library),/unquantized/);
  await fs.writeFile(config,'{"model_type":"llama"}');
  t.mock.method(fs,'statfs',async () => ({ bavail:1,bsize:1 }));
  await assert.rejects(() => inspectConversionInput({ source },library),/free space/);
});

test('Q4 conversion runs a full precision stage followed by quantization',async t => {
  const { store,runtime,source,library,options,tools }=await fixture(t);
  const calls=[];
  await fs.writeFile(path.join(tools,'quantize.cjs'),"const fs=require('node:fs');fs.copyFileSync(process.argv[2],process.argv[3]);console.log('quantized');");
  const converter=new ModelConverter(store,runtime,{ ...options,quantizer:async () => 'fixture-quantizer',run:async (exe,args,opts) => {
    calls.push({ exe,args,env:opts.env });
    await converterCommand(exe==='fixture-quantizer' ? process.execPath : exe,exe==='fixture-quantizer' ? [path.join(tools,'quantize.cjs'),...args] : args,opts);
  } });
  t.after(() => converter.close()); await converter.start({ source,format:'Q4_K_M' }); await converter.task;
  assert.equal(converter.job.status,'completed'); assert.equal(calls.length,2);
  assert.equal(calls[0].args.at(-1),'f16'); assert.equal(calls[1].args[2],'Q4_K_M'); assert.equal(calls[0].env.HF_HUB_OFFLINE,'1');
  assert.ok((await fs.readdir(library)).includes('source-Q4_K_M.gguf'));
});

test('failed conversions clean partial files and leave the model library unchanged',async t => {
  const { converter,source,library }=await fixture(t);
  await fs.writeFile(path.join(source,'config.json'),' {"model_type":"llama","fixture":"fail"}');
  await converter.start({ source }); await converter.task;
  assert.equal(converter.job.status,'error'); assert.match(converter.job.error,/process failed/);
  assert.deepEqual(await fs.readdir(library),[]);
});

test('cancelling conversion stops the actual worker before removing its partial files',async t => {
  const { converter,source,library }=await fixture(t);
  await fs.writeFile(path.join(source,'config.json'),'{"model_type":"llama","fixture":"slow"}');
  await converter.start({ source });
  await waitFor(() => converter.job.logs.some(line => line.includes('weights written')));
  assert.deepEqual(await scanModels(library),[],'staging GGUF must not be loadable');
  await assert.rejects(() => converter.start({ source }),/already running/);
  await converter.cancel(); assert.equal(converter.job.status,'cancelled'); assert.equal(converter.active,false);
  assert.deepEqual(await fs.readdir(library),[]); await fs.access(path.join(source,'model.safetensors'));
});

test('output files added while conversion is running are never overwritten',async t => {
  const { converter,source,library,tools }=await fixture(t);
  await fs.writeFile(path.join(tools,'convert_hf_to_gguf.py'),`const fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(path.join(library,'source-Q8_0.gguf'))},'keep this');fs.writeFileSync(args[args.indexOf('--outfile')+1],Buffer.from('${gguf().toString('base64')}','base64'));`);
  await converter.start({ source }); await converter.task;
  assert.equal(converter.job.status,'error'); assert.match(converter.job.error,/not replaced/);
  assert.equal(await fs.readFile(path.join(library,'source-Q8_0.gguf'),'utf8'),'keep this');
});

test('restart marks unfinished conversions interrupted and removes their staging directory',async t => {
  const { store,runtime,library,options }=await fixture(t);
  const id='12345678-1234-1234-1234-123456789abc';
  store.state.modelConversion={ id,status:'converting',directory:library,logs:[] };
  await fs.mkdir(path.join(library,`.forge-convert-${id}`)); await fs.writeFile(path.join(library,`.forge-convert-${id}`,'partial.gguf'),'partial');
  const converter=new ModelConverter(store,runtime,options); await converter.initialize();
  assert.equal(converter.job.status,'interrupted'); assert.equal(converter.active,false); assert.deepEqual(await fs.readdir(library),[]);
});

test('model conversion APIs enforce resource guards and refresh the model library on completion',async t => {
  const { dir,source,library,runtime,options }=await fixture(t);
  const app=await createApplication({ appRoot:dir,dataDir:path.join(dir,'api-data'),defaultModelDir:library,runtime });
  t.after(() => app.close()); app.features.modelConverter.environment=options.environment;
  const api=async (route,body) => { const response=await fetch(app.origin+route,{ method:body===undefined ? 'GET' : 'POST',headers:{ 'X-Local-Desk-Token':app.token,'Content-Type':'application/json' },...(body===undefined ? {} : { body:JSON.stringify(body) }) }); return { status:response.status,value:await response.json() }; };
  assert.equal((await api('/api/bootstrap')).value.models.length,0);
  runtime.status='ready'; assert.match((await api('/api/model/convert',{ source })).value.error,/Unload/); runtime.status='stopped';
  await fs.writeFile(path.join(source,'config.json'),'{"model_type":"llama","fixture":"slow"}');
  assert.equal((await api('/api/model/convert',{ source })).status,200);
  await waitFor(() => app.features.modelConverter.job.logs.some(line => line.includes('weights written')));
  for (const route of ['/api/model/load','/api/runtime/install','/api/trainer/install','/api/connections/use']) assert.match((await api(route,{})).value.error,/conversion/);
  assert.equal((await api('/api/model/cancel-conversion',{})).value.job.status,'cancelled');
  await fs.writeFile(path.join(source,'config.json'),'{"model_type":"llama"}');
  await api('/api/model/convert',{ source }); await app.features.modelConverter.task;
  assert.equal((await api('/api/bootstrap')).value.models.length,1,'completion invalidates the five-second library cache');
});
