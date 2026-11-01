import fs from 'node:fs/promises';
import { createWriteStream,createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
const request=async url => { const r=await fetch(url,{ headers:{ 'User-Agent':'Forge/0.2' },signal:AbortSignal.timeout(180000) }); if (!r.ok) throw new Error(`Download returned ${r.status}`); return r; };
async function release() { let r=await (await request('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest')).json(); if (!r.assets?.length) { const tag=r.body?.match(/Nightly build:\*\*\s*\[([^\]]+)\]/)?.[1] || r.body?.match(/releases\/tag\/(b\d+)/)?.[1]; if (!tag) throw new Error('No official Whisper prebuilt release found.'); r=await (await request(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${tag}`)).json(); } return r; }
async function download(url,file,expected) { if (!expected) throw new Error('No published checksum. Install a verified Whisper build manually.'); await pipeline(Readable.fromWeb((await request(url)).body),createWriteStream(file)); const h=createHash('sha256'); for await (const c of createReadStream(file)) h.update(c); if (h.digest('hex')!==expected.replace(/^sha256:/,'')) throw new Error('Whisper download checksum mismatch.'); }
async function binary(dir) { for (const e of await fs.readdir(dir,{ withFileTypes:true })) { const file=path.join(dir,e.name); if (e.isFile() && ['whisper-cli','whisper-cli.exe'].includes(e.name)) return file; if (e.isDirectory()) { const found=await binary(file); if (found) return found; } } return null; }
export async function installVoice({ directory,log=console.log }) {
  const r=await release(); const os=process.platform==='win32' ? /win|bin-x64\.zip/ : process.platform==='darwin' ? /macos|darwin/ : /ubuntu|linux/; const arch=process.arch==='arm64' ? /arm64|aarch64/ : /x64|x86_64/;
  const asset=r.assets.find(a => /\.(zip|tar\.gz)$/.test(a.name) && os.test(a.name) && arch.test(a.name) && !/cuda|openblas|blas|coreml|vulkan|sycl|cudart/.test(a.name));
  if (!asset) throw new Error(`No official CPU Whisper binary found for ${process.platform}/${process.arch}. Choose a locally built whisper-cli in Voice settings.`);
  if (!asset.browser_download_url.startsWith('https://github.com/ggml-org/whisper.cpp/releases/download/')) throw new Error('Unexpected Whisper release URL.');
  const root=path.resolve(directory); const target=path.join(root,r.tag_name); await fs.mkdir(target,{ recursive:true }); const archive=path.join(target,asset.name);
  log(`Downloading ${asset.name}`); await download(asset.browser_download_url,archive,asset.digest);
  await new Promise((resolve,reject) => { const child=spawn('tar',['-xf',archive,'-C',target],{ windowsHide:true,stdio:['ignore','ignore','pipe'] }); let error=''; child.stderr.on('data',c => { error+=c; }); child.once('error',reject); child.once('exit',code => code===0 ? resolve() : reject(new Error(error))); });
  const executable=await binary(target); if (!executable) throw new Error('Whisper archive has no CLI executable.'); if (process.platform!=='win32') await fs.chmod(executable,0o755);
  const meta=await (await request('https://huggingface.co/api/models/ggerganov/whisper.cpp?blobs=true')).json(); const info=meta.siblings?.find(f => f.rfilename==='ggml-tiny.en.bin'); const model=path.join(root,'ggml-tiny.en.bin');
  log('Downloading the tiny English Whisper model (about 75 MB)…'); await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',model,info?.lfs?.sha256);
  await fs.writeFile(path.join(root,'current.json'),JSON.stringify({ executable,model },null,2)); log('Local Whisper voice engine installed.'); return { executable,model };
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) { try { if (process.argv.includes('--list')) { const r=await release(); console.log(JSON.stringify({ tag:r.tag_name,assets:r.assets.map(a => ({ name:a.name,size:a.size })) },null,2)); } else await installVoice({ directory:path.resolve('.data/voice-runtime') }); } catch (e) { console.error(e.message); process.exitCode=1; } }
