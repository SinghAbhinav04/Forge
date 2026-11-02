import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdleUnloader } from '../src/idle-unload.mjs';

test('idle unload waits after use and never stops a busy or remote model',async()=>{
 let now=0,count=0,blocked=false;const settings={idleUnloadMinutes:1};const runtime={status:'ready',busy:false,remote:null,lastActivity:0};const unloader=new IdleUnloader(runtime,()=>settings,()=>blocked,async()=>{count++;runtime.status='stopped';},()=>now);
 await unloader.tick();now=59000;await unloader.tick();assert.equal(count,0);runtime.busy=true;now=60000;await unloader.tick();runtime.busy=false;now=120000;await unloader.tick();assert.equal(count,0);now=180000;await unloader.tick();assert.equal(count,1);
 runtime.status='ready';runtime.remote={base:'local ollama'};now=300000;await unloader.tick();now=600000;await unloader.tick();assert.equal(count,1);runtime.remote=null;blocked=true;await unloader.tick();blocked=false;await unloader.tick();assert.equal(count,1);settings.idleUnloadMinutes=0;now=999999;await unloader.tick();assert.equal(count,1);
});
