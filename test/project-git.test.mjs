import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectGitStatus } from '../src/project-git.mjs';
const run=promisify(execFile);

test('project Git status is read-only and confined to the selected repository root',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-git-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await run('git',['init',root]);await fs.writeFile(path.join(root,'note.txt'),'change');await fs.mkdir(path.join(root,'nested'));
 const result=await projectGitStatus(root);assert.equal(result.available,true);assert.ok(result.branch);assert.ok(result.changes.some(line=>line.includes('note.txt')));assert.equal((await projectGitStatus(path.join(root,'nested'))).available,false);assert.equal(await fs.readFile(path.join(root,'note.txt'),'utf8'),'change');
});
