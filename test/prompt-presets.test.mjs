import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/store.mjs';
import { listPromptPresets,savePromptPreset,removePromptPreset } from '../src/prompt-presets.mjs';

test('custom prompt presets survive restart and cannot remove built-ins',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-presets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=await openStore(root);assert.ok(listPromptPresets(store).some(p=>p.id==='builtin-coding'));const item=await savePromptPreset(store,{name:'Friendly',instructions:'Be friendly.'});assert.equal(item.builtin,false);
 const reopened=await openStore(root,store.dataDir);assert.equal(listPromptPresets(reopened).find(p=>p.id===item.id).instructions,'Be friendly.');await assert.rejects(()=>removePromptPreset(reopened,'builtin-coding'),/not found/);await assert.rejects(()=>savePromptPreset(reopened,{name:'',instructions:'x'}),/name and instructions/);await removePromptPreset(reopened,item.id);assert.ok(!listPromptPresets(await openStore(root,store.dataDir)).some(p=>p.id===item.id));
});
