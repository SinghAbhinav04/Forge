import fs from 'node:fs/promises';
import { spawn,execFile } from 'node:child_process';
import { confined } from './files.mjs';

export async function runCommand(root,command,relative='.',{signal,timeoutMs=120000}={}){
  if(typeof command!=='string' || !command.trim() || command.length>2000 || command.includes('\0'))throw new Error('Enter a command of at most 2,000 characters.');
  const cwd=await confined(root,relative);if(!(await fs.stat(cwd)).isDirectory())throw new Error('Choose a project directory.');signal?.throwIfAborted();
  const allowed=new Set(['PATH','HOME','USER','SHELL','LANG','LC_ALL','LC_CTYPE','TMPDIR','TMP','TEMP','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT']);const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toUpperCase())));
  return new Promise((resolve,reject)=>{
    const child=spawn(command,{cwd,env,shell:true,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let output='',truncated=false,timedOut=false,aborted=false,settled=false;const max=64000;
    const collect=chunk=>{const text=String(chunk);const remaining=max-output.length;if(remaining>0)output+=text.slice(0,remaining);if(text.length>remaining)truncated=true;};child.stdout.on('data',collect);child.stderr.on('data',collect);
    const stop=()=>{if(!child.pid)return;if(process.platform==='win32')execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const abort=()=>{aborted=true;stop();};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    const finish=(error,code,exitSignal)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)return reject(error);if(aborted)return reject(signal?.reason || new Error('Command stopped.'));resolve({command,cwd:relative,exitCode:code,signal:exitSignal,output,truncated,timedOut});};
    child.once('error',error=>finish(error));child.once('close',(code,exitSignal)=>finish(null,code,exitSignal));
  });
}
