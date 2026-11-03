import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

if(process.platform!=='darwin')throw new Error('This check runs on macOS.');
const arch=process.argv[2] || process.arch;
if(!['arm64','x64'].includes(arch))throw new Error('Choose arm64 or x64.');
const bundle=path.resolve('dist',arch==='arm64'?'mac-arm64':'mac','Forge.app');
await promisify(execFile)('codesign',['--verify','--deep','--strict','--verbose=2',bundle]);
await fs.mkdir(path.resolve('test-artifacts'),{recursive:true});
const root=await fs.mkdtemp(path.resolve('test-artifacts/macos-package-'));
const profile=path.join(root,'profile');
const models=path.join(root,'models');await fs.mkdir(models,{recursive:true});
const store=await openStore(root,path.join(profile,'data'),path.join(root,'workspace'),models);
store.state.settings.runInBackground=false;await store.save();
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await electron.launch({executablePath:path.join(bundle,'Contents/MacOS/Forge'),args:[`--user-data-dir=${profile}`],env,timeout:30000});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.getElementById('hardware-label')?.textContent.includes('GB RAM'),null,{timeout:30000});
  assert.equal(await app.evaluate(()=>process.arch),arch);
  assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
  const diagnostics=await page.evaluate(async()=>{const response=await fetch('/api/diagnostics',{headers:{'X-Local-Desk-Token':sessionStorage.getItem('local-desk-token')}});return response.json();});
  assert.equal(diagnostics.arch,arch);assert.deepEqual(errors,[]);
  console.log(`Packaged macOS ${arch} passed: native window, backend, isolated profile and architecture.`);
}finally{if(app)await app.close();}
