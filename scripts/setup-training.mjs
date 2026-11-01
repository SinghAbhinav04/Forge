import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const index=process.argv.indexOf('--data'); const data=path.resolve(index>=0 ? process.argv[index+1] : '.data');
const venv=path.join(data,'training-env'); const python=path.join(venv,process.platform==='win32' ? 'Scripts/python.exe' : 'bin/python');
const run=(exe,args) => new Promise((resolve,reject) => { const child=spawn(exe,args,{ windowsHide:true,stdio:'inherit' }); child.once('error',reject); child.once('exit',code => code===0 ? resolve() : reject(new Error(`Command failed (${code}).`))); });
await fs.mkdir(data,{ recursive:true });
try { await fs.access(python); } catch { await run(process.platform==='win32' ? 'python' : 'python3',['-m','venv',venv]); }
console.log('Installing the optional CPU training engine into:',venv);
await run(python,['-m','pip','install','torch',...(process.platform==='darwin' ? [] : ['--index-url','https://download.pytorch.org/whl/cpu'])]);
await run(python,['-m','pip','install','transformers>=4.51,<5','peft>=0.15,<1','accelerate>=1,<2','safetensors']);
console.log('Training engine installed. CPU training is ready; CUDA builds can be installed separately in this environment.');
