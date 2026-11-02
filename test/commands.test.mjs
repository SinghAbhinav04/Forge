import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCommand } from '../src/commands.mjs';

test('command runner confines its initial directory and reports actual exit status',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-command-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const result=await runCommand(root,'echo forge-test');assert.equal(result.exitCode,0);assert.match(result.output,/forge-test/);assert.equal(result.cwd,'.');await assert.rejects(()=>runCommand(root,'echo no','..'),/outside|protected/);
});

test('command runner stops a timed-out process',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-command-timeout-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const result=await runCommand(root,'node -e "setTimeout(() => {}, 30000)"','.',{timeoutMs:300});assert.equal(result.timedOut,true);assert.notEqual(result.exitCode,0);
});
