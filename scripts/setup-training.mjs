import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const index=process.argv.indexOf('--data'); const data=path.resolve(index>=0 ? process.argv[index+1] : '.data');
const deviceIndex=process.argv.indexOf('--device');
const device=deviceIndex<0 ? 'cpu' : process.argv[deviceIndex+1];
if (!['cpu','cuda'].includes(device)) throw new Error('Choose a CPU or NVIDIA CUDA training engine.');
const cuda=device==='cuda';
if (cuda && (!['win32','linux'].includes(process.platform) || process.arch!=='x64')) throw new Error('The CUDA installer supports x64 Windows and Linux.');
const requested=path.join(data,cuda ? 'training-env-cuda' : 'training-env');
await fs.mkdir(requested,{ recursive:true });
// Windows can expose a redirected profile on a different drive. Start Python
// from the physical venv so pip stages and replaces files on that same drive.
const venv=process.platform==='win32' ? await fs.realpath(requested) : requested;
const python=path.join(venv,process.platform==='win32' ? 'Scripts/python.exe' : 'bin/python');
const run=(exe,args) => new Promise((resolve,reject) => { const child=spawn(exe,args,{ windowsHide:true,stdio:'inherit' }); child.once('error',reject); child.once('exit',code => code===0 ? resolve() : reject(new Error(`Command failed (${code}).`))); });
if (cuda) await run('nvidia-smi',['--query-gpu=name,driver_version','--format=csv,noheader']).catch(()=>{throw new Error('Install a working NVIDIA driver before installing the CUDA training engine.');});
try { await fs.access(python); } catch { await run(process.platform==='win32' ? 'python' : 'python3',['-m','venv',venv]); }
const label=cuda ? 'NVIDIA CUDA' : 'CPU';
const indexUrl=`https://download.pytorch.org/whl/${cuda ? 'cu128' : 'cpu'}`;
console.log(`Installing the optional ${label} training engine into:`,venv);
await run(python,['-m','pip','install','torch',...(process.platform==='darwin' ? [] : ['--index-url',indexUrl])]);
await run(python,['-m','pip','install','transformers>=4.51,<5','peft>=0.15,<1','accelerate>=1,<2','safetensors']);
const verify='import torch, transformers, peft, accelerate, safetensors';
const gpuCheck='; assert torch.cuda.is_available(), "PyTorch could not initialize the NVIDIA GPU"; print(torch.cuda.get_device_name(), (torch.ones(1,device="cuda")+1).item())';
await run(python,['-c',verify+(cuda ? gpuCheck : '')]);
if (cuda) await fs.writeFile(path.join(venv,'ready'),'cuda12.8\n');
console.log(`${label} training is ready.`);
