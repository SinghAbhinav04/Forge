import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

function git(root,args){return new Promise((resolve,reject)=>{const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));execFile('git',['-C',root,'-c','core.fsmonitor=false','-c','core.untrackedCache=false','--no-optional-locks',...args],{env,windowsHide:true,timeout:5000,maxBuffer:1024*1024},(error,stdout)=>error ? reject(error) : resolve(stdout));});}
export async function projectGitStatus(root){
  const workspace=await fs.realpath(root);let top;
  try{top=await fs.realpath((await git(workspace,['rev-parse','--show-toplevel'])).trim());}catch(error){if(error.code==='ENOENT')return {available:false,reason:'Git is not installed.'};return {available:false,reason:'This project is not a Git repository, or Git could not read it.'};}
  if(path.resolve(top)!==path.resolve(workspace))return {available:false,reason:'Open the repository root to inspect Git status.'};
  const output=await git(workspace,['status','--porcelain=v1','--branch','--untracked-files=normal']);const lines=output.split(/\r?\n/);const branch=(lines.shift() || '').replace(/^##\s*/, '');const changes=lines.filter(Boolean);return {available:true,branch,changes:changes.slice(0,200),truncated:changes.length>200};
}
